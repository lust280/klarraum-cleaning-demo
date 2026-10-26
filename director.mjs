import {createServer,request as httpRequest} from 'node:http';
import {readFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {DirectorStore} from './lib/director-store.mjs';
import {loadConfig} from './lib/config.mjs';
import {digest,randomToken,verifyPassword,hashPassword,validPasswordHash,RateLimiter} from './lib/security.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
const fail=(status,message)=>{const error=new Error(message);error.status=status;throw error;};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
export function directorConfig(env=process.env) {
  const origin=env.DIRECTOR_ORIGIN||'http://director.localhost:3100';
  const parsed=new URL(origin),domain=env.COMPANY_BASE_DOMAIN||'companies.localhost';
  if(parsed.origin!==origin||!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('Invalid DIRECTOR_ORIGIN.');
  if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)||parsed.hostname===domain||parsed.hostname.endsWith('.'+domain))throw new Error('Use a distinct director hostname and company base domain.');
  if(parsed.protocol!=='https:'&&!(parsed.hostname.endsWith('.localhost')&&domain.endsWith('.localhost')))throw new Error('Public director requires HTTPS.');
  if(!validPasswordHash(env.DIRECTOR_PASSWORD_HASH))throw new Error('Set DIRECTOR_PASSWORD_HASH using npm run admin:hash.');
  return {origin,domain:domain.toLowerCase(),passwordHash:env.DIRECTOR_PASSWORD_HASH,dataDir:resolve(env.DIRECTOR_DATA_DIR||'./director-data'),maxRunning:20};
}
export function createDirector(config) {
  mkdirSync(config.dataDir,{recursive:true,mode:0o700});
  const registry=join(config.dataDir,'director.sqlite'),store=new DirectorStore(registry);
  chmodSync(registry,0o600);store.bindAuth(digest(config.passwordHash));
  let closing;
  const limiter=new RateLimiter(),children=new Map(),url=new URL(config.origin),secure=url.protocol==='https:';
  const cookieName=secure?'__Host-klarraum_director':'klarraum_director';
  const cookie=(token,age)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
  const tenantOrigin=id=>config.mountedDemo?`${config.origin}/companies/${id}`:`${url.protocol}//${id}.${config.domain}${url.port?':'+url.port:''}`;
  const companyDir=id=>join(config.dataDir,'companies',id);
  function publicCompany(row) {
    let workers={active:0,invited:0,disabled:0},storage='not initialized';
    const path=join(companyDir(row.id),'klarraum.sqlite');
    if(existsSync(path)) {
      let db;
      try {
        db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA busy_timeout=1000');
        const counts=db.prepare('SELECT SUM(CASE WHEN active=1 AND password_hash IS NOT NULL THEN 1 ELSE 0 END) AS active,SUM(CASE WHEN active=1 AND password_hash IS NULL THEN 1 ELSE 0 END) AS invited,SUM(CASE WHEN active=0 THEN 1 ELSE 0 END) AS disabled FROM employees').get();
        workers=Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v||0]));storage='readable';
      }catch{workers=null;storage='unavailable';}finally{db?.close();}
    }
    return {id:row.id,name:row.name,status:row.status,payment:row.payment,baseCents:row.base_cents,included:row.included,seatCents:row.seat_cents,version:row.version,activated:Boolean(row.password_hash),origin:tenantOrigin(row.id),workers,storage,estimatedCents:workers?row.base_cents+Math.max(0,workers.active-row.included)*row.seat_cents:null};
  }
  async function body(req) {
    if((req.headers['content-type']||'').split(';')[0]!=='application/json')fail(415,'JSON required.');
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192)fail(413,'Request too large.');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail(400,'Invalid JSON.');}
  }
  function session(req,write=false) {
    const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if(!token||! /^[\w-]{43}$/.test(token))fail(401,'Sign in to the director account.');
    const result=store.db.prepare('SELECT * FROM director_sessions WHERE hash=? AND expires>?').get(digest(token),Date.now());
    if(!result)fail(401,'Session expired.');
    if(write&&req.headers['x-csrf-token']!==result.csrf)fail(403,'Invalid security token.');return {...result,hash:digest(token)};
  }
  function checked(input,update=false) {
    if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>80||/[\x00-\x1f\x7f]/.test(input.name))fail(400,'Company name: 1–80 characters.');
    for(const key of ['baseCents','included','seatCents'])if(!Number.isSafeInteger(input[key])||input[key]<0||input[key]>(key==='included'?100000:10000000))fail(400,'Invalid tariff. Use whole cents and whole seats.');
    if(update&&(!['active','suspended'].includes(input.status)||!['trial','paid','overdue'].includes(input.payment)||!Number.isSafeInteger(input.version)))fail(400,'Invalid status/version.');
    return {...input,name:input.name.trim()};
  }
  async function stop(id) {
    const item=children.get(id);if(!item)return;
    item.stopping=true;
    await new Promise(resolveStop=>{if(item.child.exitCode!==null)return resolveStop();item.child.once('exit',resolveStop);item.child.kill('SIGTERM');const timer=setTimeout(()=>item.child.kill('SIGKILL'),6000);timer.unref();item.child.once('exit',()=>clearTimeout(timer));});
    if(children.get(id)===item)children.delete(id);
  }
  function start(row) {
    let item=children.get(row.id);if(item&&!item.stopping)return item.ready;
    if(item)fail(503,'Company is restarting. Retry shortly.');
    if(children.size>=config.maxRunning)fail(503,'Running company capacity reached. Operator must provision more capacity.');
    mkdirSync(companyDir(row.id),{recursive:true,mode:0o700});
    const companyConfig=loadConfig({APP_ORIGIN:config.mountedDemo?config.origin:tenantOrigin(row.id),DATA_DIR:companyDir(row.id),ADMIN_PASSWORD_HASH:row.password_hash,APP_SECRET:row.secret,BUSINESS_NAME:row.name,DEMO_ONLY:'true'});
    companyConfig.directorDisabled=true;
    if(config.mountedDemo)companyConfig.basePath='/companies/'+row.id;
    const child=fork(join(root,'scripts/company-runner.mjs'),[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,NODE_ENV:'production'}});
    item={child,stopping:false,ready:null};children.set(row.id,item);
    item.ready=new Promise((resolveReady,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(new Error('Company start timed out.'));},15000);timer.unref();
      child.once('message',message=>{if(!Number.isInteger(message?.port)){child.kill();return;}clearTimeout(timer);resolveReady(message.port);});
      child.once('error',()=>{clearTimeout(timer);reject(new Error('Company start failed.'));});
      child.once('exit',()=>{clearTimeout(timer);if(children.get(row.id)===item)children.delete(row.id);reject(new Error('Company stopped.'));});
    });child.send(companyConfig);return item.ready;
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const host=req.headers.host?.toLowerCase(),route=new URL(req.url,config.origin),method=req.method;
      if(!host||req.url.startsWith('http'))fail(400,'Invalid request.');
      if(config.mountedDemo&&host!==url.host)fail(404,'Unknown host.');
      if(method!=='GET'&&method!=='HEAD') {
        const expected=host===url.host?config.origin:`${url.protocol}//${host}`;
        if(req.headers.origin!==expected)fail(403,'Invalid origin.');
      }
      const staticFile=(file,type)=>{res.writeHead(200,{'Content-Type':type});res.end(method==='HEAD'?undefined:readFileSync(join(root,'director-public',file)));};
      const mounted=config.mountedDemo&&/^\/companies\/([a-f0-9-]{36})(\/.*)?$/.exec(route.pathname);
      if(mounted&&!mounted[2]){res.writeHead(302,{Location:route.pathname+'/'});return res.end();}
      if(host!==url.host || mounted) {
        const suffix='.'+config.domain+(url.port?':'+url.port:'');
        if(!mounted&&!host.endsWith(suffix))fail(404,'Unknown company.');
        const id=mounted?mounted[1]:host.slice(0,-suffix.length);
        if(mounted){route.pathname=mounted[2];req.url=route.pathname+route.search;}
        if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))fail(404,'Unknown company.');
        const row=store.company(id);if(!row)fail(404,'Unknown company.');if(row.status!=='active')fail(423,'Company access is suspended. Data has not been deleted.');
        if(route.pathname==='/owner-setup.html'&&['GET','HEAD'].includes(method))return staticFile('owner-setup.html','text/html; charset=utf-8');
        if(route.pathname==='/owner-setup.js'&&['GET','HEAD'].includes(method))return staticFile('owner-setup.js','text/javascript; charset=utf-8');
        if(route.pathname==='/director.css'&&['GET','HEAD'].includes(method))return staticFile('director.css','text/css; charset=utf-8');
        if(route.pathname==='/api/owner-setup'&&method==='POST') {
          if(!limiter.allow('invite:'+id,10,900000,Date.now()))fail(429,'Try again later.');
          const input=await body(req);if(typeof input.token!=='string'||! /^[\w-]{43}$/.test(input.token))fail(400,'Invalid invitation.');
          if(row.invite_hash!==digest(input.token)||row.invite_expires<=Date.now())fail(400,'Invitation expired or already used.');
          let hash;try{hash=await hashPassword(input.password);}catch{fail(400,'Password must have 14–256 characters.');}
          store.activate(id,input.token,hash);await stop(id);return json(res,200,{ok:true});
        }
        if(!row.password_hash)fail(503,'Owner activation is required before this company can be opened.');
        const port=await start(row);
        if(store.company(id)?.status!=='active')fail(423,'Company access suspended.');
        const headers={...req.headers};delete headers['x-forwarded-for'];delete headers['x-forwarded-host'];delete headers['x-forwarded-proto'];
        const proxy=httpRequest({hostname:'127.0.0.1',port,path:req.url,method,headers},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});
        proxy.on('error',()=>{if(!res.headersSent)json(res,502,{error:'Company unavailable. Retry shortly.'});else res.destroy();});
        req.on('aborted',()=>proxy.destroy());req.pipe(proxy);return;
      }
      if(route.pathname==='/api/director/login'&&method==='POST') {
        if(!limiter.allow('login:'+req.socket.remoteAddress,8,900000,Date.now()))fail(429,'Too many attempts. Try later.');
        const input=await body(req);if(!await verifyPassword(input.password,config.passwordHash))fail(401,'Invalid credentials.');
        const token=randomToken(),csrf=randomToken();store.db.prepare('DELETE FROM director_sessions WHERE expires<=?').run(Date.now());
        store.db.prepare('INSERT INTO director_sessions VALUES(?,?,?)').run(digest(token),csrf,Date.now()+8*3600000);res.setHeader('Set-Cookie',cookie(token,28800));return json(res,200,{csrf});
      }
      if(route.pathname.startsWith('/api/director/')) {
        const auth=session(req,!['GET','HEAD'].includes(method));
        if(route.pathname==='/api/director/session'&&method==='GET')return json(res,200,{csrf:auth.csrf});
        if(route.pathname==='/api/director/logout'&&method==='POST'){store.db.prepare('DELETE FROM director_sessions WHERE hash=?').run(auth.hash);res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});}
        if(route.pathname==='/api/director/companies'&&method==='GET')return json(res,200,{items:store.list().map(publicCompany)});
        if(route.pathname==='/api/director/companies'&&method==='POST') {
          const created=store.create(checked(await body(req)));
          return json(res,201,{company:publicCompany(created.row),inviteUrl:tenantOrigin(created.row.id)+'/owner-setup.html#token='+created.token});
        }
        const match=/^\/api\/director\/companies\/([a-f0-9-]{36})(?:\/(invite|events))?$/.exec(route.pathname);
        if(match) {
          const row=store.company(match[1]);if(!row)fail(404,'Company not found.');
          if(!match[2]&&method==='PUT') {store.update(row.id,checked(await body(req),true));if(store.company(row.id).status==='suspended')await stop(row.id);return json(res,200,publicCompany(store.company(row.id)));}
          if(match[2]==='invite'&&method==='POST'){if(row.password_hash)fail(409,'Owner already activated. Password recovery requires the operator procedure.');const token=store.invite(row.id);return json(res,200,{inviteUrl:tenantOrigin(row.id)+'/owner-setup.html#token='+token});}
          if(match[2]==='events'&&method==='GET')return json(res,200,{items:store.db.prepare('SELECT action,details,created_at FROM director_events WHERE company_id=? ORDER BY id DESC LIMIT 100').all(row.id)});
        }
        fail(404,'Not found.');
      }
      if(!['GET','HEAD'].includes(method))fail(405,'Method not allowed.');
      if(route.pathname==='/healthz')return json(res,200,{ok:true});
      const files={'/':['index.html','text/html; charset=utf-8'],'/director.js':['director.js','text/javascript; charset=utf-8'],'/director.css':['director.css','text/css; charset=utf-8']};
      if(files[route.pathname])return staticFile(...files[route.pathname]);fail(404,'Not found.');
    }catch(error){if(!res.headersSent)json(res,error.status||503,{error:error.status?error.message:'Service unavailable. Check operator logs and storage.'});else res.destroy();}
  });
  server.headersTimeout=15000;server.requestTimeout=20000;
  return {server,store,tenantOrigin,companyDir,close(){return closing ||= (async()=>{await Promise.all([...children.keys()].map(stop));await new Promise(r=>server.close(r));store.close();})();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const director=createDirector(directorConfig());director.server.listen(Number(process.env.PORT||3100),'0.0.0.0',()=>console.log('Klarraum director started.'));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>director.close().then(()=>process.exit(0)));
}
