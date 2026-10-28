import {createServer,request as httpRequest} from 'node:http';
import {readFileSync,mkdirSync,existsSync,chmodSync,writeFileSync,unlinkSync,createReadStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pipeline} from 'node:stream/promises';
import {createPlatformBackup} from './lib/platform-backup.mjs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {PlatformFinance, forecast, financeCsv} from './lib/platform-finance.mjs';
import {sendTrialVerification} from './lib/trial-mail.mjs';
import {DirectorStore} from './lib/director-store.mjs';
import {loadConfig} from './lib/config.mjs';
import {digest,randomToken,verifyPassword,hashPassword,hashHostedPassword,validPasswordHash,RateLimiter} from './lib/security.mjs';
import {planFor,planEstimate,requestedPlanForWorkers,storageState} from './lib/plans.mjs';
import {companyInquiryEnv,companyInquiryReadiness,inquiryBlockers} from './lib/company-inquiry.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
const fail=(status,message)=>{const error=new Error(message);error.status=status;throw error;};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
export function directorConfig(env=process.env) {
  const origin=env.DIRECTOR_ORIGIN||'http://director.localhost:3100';
  const parsed=new URL(origin),domain=env.COMPANY_BASE_DOMAIN||'companies.localhost';
  if(parsed.origin!==origin||!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('Invalid DIRECTOR_ORIGIN.');
  if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)||parsed.hostname===domain||parsed.hostname.endsWith('.'+domain))throw new Error('Use a distinct director hostname and company base domain.');
  if(parsed.protocol!=='https:'&&!(parsed.hostname.endsWith('.localhost')&&domain.endsWith('.localhost')))throw new Error('Public director requires HTTPS.');
  const passwordHash=env.DIRECTOR_PASSWORD_HASH||(env.DIRECTOR_PASSWORD?hashHostedPassword(env.DIRECTOR_PASSWORD,env.APP_SECRET):'');
  if(!validPasswordHash(passwordHash))throw new Error('Set DIRECTOR_PASSWORD_HASH, or set DIRECTOR_PASSWORD with a separate 32+ character APP_SECRET.');
  const maxRunning=Number(env.MAX_COMPANY_PROCESSES||20);
  if(!Number.isSafeInteger(maxRunning)||maxRunning<1||maxRunning>20)throw new Error('MAX_COMPANY_PROCESSES must be 1–20.');
  return {origin,domain:domain.toLowerCase(),passwordHash,dataDir:resolve(env.DIRECTOR_DATA_DIR||'./director-data'),maxRunning,mountedDemo:env.PLATFORM_DEMO_MODE==='true',pathPreview:env.PLATFORM_PATH_PREVIEW==='true',production:env.NODE_ENV==='production',trialMail:{key:env.PLATFORM_RESEND_API_KEY||env.RESEND_API_KEY||'',from:env.PLATFORM_MAIL_FROM||env.MAIL_FROM||''}};
}
export function createDirector(config) {
  mkdirSync(config.dataDir,{recursive:true,mode:0o700});
  const marker=join(config.dataDir,'.platform-running'),markerToken=randomToken();
  writeFileSync(marker,markerToken,{flag:'wx',mode:0o600});
  let store,finance;const registry=join(config.dataDir,'director.sqlite');
  try{store=new DirectorStore(registry);finance=new PlatformFinance(store);chmodSync(registry,0o600);store.bindAuth(digest(config.passwordHash));}catch(error){store?.close();unlinkSync(marker);throw error;}
  let closing,maintenance=false;
  const requests=new Set();
  const limiter=new RateLimiter(),children=new Map(),url=new URL(config.origin),secure=url.protocol==='https:';
  const cookieName=secure?'__Host-klarraum_director':'klarraum_director';
  const cookie=(token,age)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
  const tenantOrigin=id=>(config.mountedDemo||config.pathPreview)?`${config.origin}/companies/${id}`:`${url.protocol}//${id}.${config.domain}${url.port?':'+url.port:''}`;
  const companyDir=id=>join(config.dataDir,'companies',id);
  function publicCompany(row) {
    let workers={active:0,invited:0,disabled:0},storage='not initialized',storageBytes=0;
    const path=join(companyDir(row.id),'klarraum.sqlite');
    if(existsSync(path)) {
      let db;
      try {
        db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA busy_timeout=1000');
        const counts=db.prepare('SELECT SUM(CASE WHEN active=1 AND password_hash IS NOT NULL THEN 1 ELSE 0 END) AS active,SUM(CASE WHEN active=1 AND password_hash IS NULL THEN 1 ELSE 0 END) AS invited,SUM(CASE WHEN active=0 THEN 1 ELSE 0 END) AS disabled FROM employees').get();
        workers=Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v||0]));
        const hasTable=name=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
        storageBytes=(hasTable('job_photos')?db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM job_photos').get().bytes:0)+(hasTable('media')?db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM media').get().bytes:0);
        storage='readable';
      }catch{workers=null;storage='unavailable';}finally{db?.close();}
    }
    const plan=planFor(row.plan_key)||planFor('custom');
    const inquiry=companyInquiryReadiness(row,config.trialMail,{passwordHash:row.password_hash||''});
    const inquiries=(config.mountedDemo||config.pathPreview)?'demo':inquiry.accepting?'accepting':inquiry.preference==='off'?'paused':'setup';
    return {id:row.id,name:row.name,status:row.status,payment:row.payment,baseCents:row.base_cents,included:row.included,seatCents:row.seat_cents,planKey:plan.key,planName:plan.name,storageLimitBytes:plan.storageBytes,storageBytes,storageState:storageState(plan.storageBytes,storageBytes),version:row.version,activated:Boolean(row.password_hash),origin:tenantOrigin(row.id),workers,storage,timeZone:row.time_zone||'Europe/Berlin',currency:row.currency||'USD',createdAt:row.created_at,initializedAt:row.initialized_at||null,trialEndsAt:row.trial_ends_at||null,paymentDueAt:row.payment_due_at||null,lastPaidAt:row.last_paid_at||null,unreadSupport:store.supportCounts().get(row.id)||0,estimatedCents:workers?planEstimate(plan,workers.active)??(row.base_cents+Math.max(0,workers.active-row.included)*row.seat_cents):null,inquiries};
  }
  async function body(req,limit=8192) {
    if((req.headers['content-type']||'').split(';')[0]!=='application/json')fail(415,'JSON required.');
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)fail(413,'Request too large.');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail(400,'Invalid JSON.');}
  }
  function checkedLine(value,max,{multiline=false}={}) {
    if(value==null)value='';
    if(typeof value!=='string'||value.length>max)fail(400,'Invalid inquiry settings.');
    const cleaned=value.trim();
    if(cleaned.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(cleaned)||(!multiline&&/[\r\n]/.test(cleaned)))fail(400,'Invalid inquiry settings.');
    return cleaned;
  }
  function checkedInquiryProfile(input) {
    if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Invalid inquiry settings.');
    if(!['auto','on','off'].includes(input.inquiries))fail(400,'Choose automatic, on, or off for inquiries.');
    if(typeof input.legalReviewed!=='boolean')fail(400,'Confirm whether the legal text has been reviewed.');
    const contactEmail=checkedLine(input.contactEmail,254).toLowerCase();
    if(contactEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))fail(400,'Enter a valid contact email.');
    const phone=checkedLine(input.phone,40);
    if(phone&&(!/^[+\d\s()/.\-]+$/.test(phone)||phone.replace(/\D/g,'').length<7))fail(400,'Enter a valid phone number or leave it blank.');
    const postcodes=checkedLine(input.postcodes,200);
    if(postcodes){
      const parts=postcodes.split(',').map(item=>item.trim()).filter(Boolean);
      if(!parts.length||parts.length>40||parts.some(item=>!/^[A-Za-z0-9]{2,10}$/.test(item)))fail(400,'Enter postcode prefixes separated by commas, for example 90,91.');
    }
    return {contactEmail,phone,owner:checkedLine(input.owner,120),address:checkedLine(input.address,300,{multiline:true}),priceNote:checkedLine(input.priceNote,500,{multiline:true}),privacyDetails:checkedLine(input.privacyDetails,8000,{multiline:true}),additionalLegal:checkedLine(input.additionalLegal,2000,{multiline:true}),postcodes:postcodes?postcodes.split(',').map(item=>item.trim()).filter(Boolean).join(','):'',legalReviewed:input.legalReviewed,inquiries:input.inquiries};
  }
  function inquiryView(row) {
    const demo=Boolean(config.mountedDemo||config.pathPreview);
    const ready=companyInquiryReadiness(row,config.trialMail,{passwordHash:row.password_hash||''});
    const accepting=!demo&&ready.accepting;
    return {contactEmail:row.contact_email||'',phone:row.contact_phone||'',owner:row.legal_owner||'',address:row.legal_address||'',priceNote:row.price_note||'',privacyDetails:row.privacy_details||'',additionalLegal:row.legal_extra||'',postcodes:row.service_postcodes||'',legalReviewed:Number(row.legal_reviewed)===1,inquiries:ready.preference,accepting,mailConfigured:ready.mailReady,missing:ready.missing,mailMissing:ready.mailMissing,blockers:accepting?'':inquiryBlockers(ready,{demo}),demo};
  }
  function session(req,write=false) {
    const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if(!token||! /^[\w-]{43}$/.test(token))fail(401,'Sign in to the director account.');
    const result=store.db.prepare('SELECT * FROM director_sessions WHERE hash=? AND expires>?').get(digest(token),Date.now());
    if(!result)fail(401,'Session expired.');
    if(write&&req.headers['x-csrf-token']!==result.csrf)fail(403,'Invalid security token.');return {...result,hash:digest(token)};
  }
  function ownerSession(req,id,write=false) {
    const name=config.mountedDemo?'klarraum_company_'+id+'_session':secure?'__Host-klarraum_session':'klarraum_session';
    const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
    if(!token||!/^[\w-]{43}$/.test(token))fail(401,'Sign in as the company owner.');
    const path=join(companyDir(id),'klarraum.sqlite');if(!existsSync(path))fail(503,'Company storage is not ready.');
    let db;
    try {db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA busy_timeout=1000');const result=db.prepare('SELECT csrf,expires_at FROM sessions WHERE token_hash=?').get(digest(token));if(!result||result.expires_at<=Date.now())fail(401,'Session expired. Sign in again.');if(write&&req.headers['x-csrf-token']!==result.csrf)fail(403,'Invalid security token.');return result;} finally {db?.close();}
  }
  function checked(input,update=false) {
    if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>80||/[\x00-\x1f\x7f]/.test(input.name))fail(400,'Company name: 1–80 characters.');
    for(const key of ['baseCents','included','seatCents'])if(!Number.isSafeInteger(input[key])||input[key]<0||input[key]>(key==='included'?100000:10000000))fail(400,'Invalid tariff. Use whole cents and whole seats.');
    if(input.planKey!==undefined&&!planFor(input.planKey))fail(400,'Invalid plan.');
    if(update&&(!['active','suspended'].includes(input.status)||!['trial','paid','overdue'].includes(input.payment)||!Number.isSafeInteger(input.version)))fail(400,'Invalid status/version.');
    const date=value=>{if(value===null||value===undefined||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail(400,'Use a valid payment date.');const at=Date.parse(value+'T00:00:00Z');if(!Number.isSafeInteger(at))fail(400,'Use a valid payment date.');return at;};
    return {...input,name:input.name.trim(),paymentDueAt:update?date(input.paymentDueAt):null,lastPaidAt:update?date(input.lastPaidAt):null};
  }
  function checkedApplication(input) {
    if(!input||typeof input!=='object')fail(400,'Invalid application.');
    const text=(key,max,required=true)=>{const value=input[key]??'';if(typeof value!=='string'||(required&&!value.trim())||value.length>max||/[\x00-\x1f\x7f]/.test(value))fail(400,'Invalid application field.');return value.trim();};
    const companyName=text('companyName',80),ownerName=text('ownerName',80),email=text('email',254).toLowerCase(),phone=text('phone',40,false),country=text('country',80,false),note=text('note',1000,false);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Enter a valid business email.');
    if(!['en','de','ru'].includes(input.language))fail(400,'Invalid language.');
    if(!Number.isSafeInteger(input.workers)||input.workers<0||input.workers>100000)fail(400,'Invalid worker count.');
    if(input.consent!==true)fail(400,'Consent is required.');
    if(config.mountedDemo&&!email.endsWith('.invalid'))fail(400,'This public demo accepts fictional test applications only. Use an email ending in .invalid.');
    const recommended=requestedPlanForWorkers(input.workers),plan=planFor(input.planKey)||recommended;
    if((recommended.key==='custom'&&plan.key!=='custom')||(recommended.key!=='custom'&&plan.key!==recommended.key))fail(400,'Choose the plan that matches the team size. Use Custom for 21+ workers.');
    return {companyName,ownerName,email,phone,country,language:input.language,workers:input.workers,planKey:plan.key,note,consentVersion:'2026-10-27'};
  }
  function checkedTrial(input) {
    if(!input||typeof input!=='object')fail(400,'Invalid trial registration.');
    const text=(key,max)=>{const value=input[key];if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))fail(400,'Invalid trial registration field.');return value.trim();};
    const companyName=text('companyName',80),ownerName=text('ownerName',80),email=text('email',254).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Enter a valid business email.');
    if(!['en','de','ru'].includes(input.language))fail(400,'Invalid language.');
    if(input.consent!==true)fail(400,'Consent is required.');
    if(config.mountedDemo&&!email.endsWith('.invalid'))fail(400,'This public demo accepts fictional test registrations only. Use an email ending in .invalid.');
    const plan=planFor(input.planKey||'solo');if(!plan||plan.key==='custom')fail(400,'Choose a standard plan or request assisted setup.');
    return {companyName,ownerName,email,language:input.language,planKey:plan.key,consentVersion:'2026-10-27'};
  }
  function publicApplication(row) {return {id:row.id,companyName:row.company_name,ownerName:row.owner_name,email:row.email,phone:row.phone,country:row.country,language:row.language,workers:row.workers,planKey:row.plan_key||'custom',note:row.note,status:row.status,foundingOffer:Boolean(row.founding_offer),companyId:row.company_id,createdAt:row.created_at,updatedAt:row.updated_at,version:row.version};}
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
    const pathPreview=config.mountedDemo||config.pathPreview;
    const {env:inquiryEnv}=companyInquiryEnv(row,config.trialMail,{demo:pathPreview,passwordHash:row.password_hash||''});
    const companyConfig=loadConfig({NODE_ENV:config.production?'production':'development',APP_ORIGIN:pathPreview?config.origin:tenantOrigin(row.id),DATA_DIR:companyDir(row.id),ADMIN_PASSWORD_HASH:row.password_hash,APP_SECRET:row.secret,BUSINESS_NAME:row.name,BUSINESS_TIME_ZONE:row.time_zone||'Europe/Berlin',BUSINESS_CURRENCY:row.currency||'USD',DEMO_ONLY:pathPreview?'true':'false',PERSISTENT_STORAGE_CONFIRMED:config.production?'true':'false',...inquiryEnv});
    if(config.mailTransport)companyConfig.mail={...companyConfig.mail,transport:config.mailTransport};
    companyConfig.directorDisabled=true;
    if(pathPreview)companyConfig.basePath='/companies/'+row.id;
    const child=fork(join(root,'scripts/company-runner.mjs'),[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,NODE_ENV:'production'}});
    item={child,stopping:false,ready:null};children.set(row.id,item);
    item.ready=new Promise((resolveReady,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(new Error('Company start timed out.'));},15000);timer.unref();
      child.once('message',message=>{if(!Number.isInteger(message?.port)){child.kill();return;}clearTimeout(timer);store.db.prepare('UPDATE companies SET initialized_at=COALESCE(initialized_at,?) WHERE id=?').run(Date.now(),row.id);resolveReady(message.port);});
      child.once('error',()=>{clearTimeout(timer);reject(new Error('Company start failed.'));});
      child.once('exit',()=>{clearTimeout(timer);if(children.get(row.id)===item)children.delete(row.id);reject(new Error('Company stopped.'));});
    });child.send(companyConfig);return item.ready;
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      if(maintenance)fail(503,'Backup maintenance in progress. Retry shortly.');
      requests.add(res);res.once('finish',()=>requests.delete(res));res.once('close',()=>requests.delete(res));
      const host=req.headers.host?.toLowerCase(),route=new URL(req.url,config.origin),method=req.method;
      if(!host||req.url.startsWith('http'))fail(400,'Invalid request.');
      if(config.mountedDemo&&host!==url.host)fail(404,'Unknown host.');
      if(method!=='GET'&&method!=='HEAD') {
        const expected=host===url.host?config.origin:`${url.protocol}//${host}`;
        if(req.headers.origin!==expected)fail(403,'Invalid origin.');
      }
      const staticFile=(file,type,directory='director-public')=>{
        const source=readFileSync(join(root,directory,file));
        let value=type.startsWith('text/html')?source.toString('utf8').replaceAll('Klarraum','KlarraumApp'):source;
        if(file==='platform.html'){
          value=value
            .replace('<meta name="robots" content="noindex,nofollow">','<meta name="robots" content="index,follow"><meta name="description" content="KlarraumApp is operations software for cleaning businesses: customer bookings, team scheduling, jobs and reports."><link rel="canonical" href="https://klarraumapp.com/">');
        }
        res.writeHead(200,{'Content-Type':type});res.end(method==='HEAD'?undefined:value);
      };
      const mounted=(config.mountedDemo||config.pathPreview)&&/^\/companies\/([a-f0-9-]{36})(\/.*)?$/.exec(route.pathname);
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
        if(route.pathname==='/api/platform-plan'&&method==='GET') {
          ownerSession(req,id);const company=publicCompany(row);
          return json(res,200,{companyName:company.name,planKey:company.planKey,planName:company.planName,monthlyCents:company.estimatedCents,activeWorkers:company.workers?.active??null,includedWorkers:company.included,storageBytes:company.storageBytes,storageLimitBytes:company.storageLimitBytes,storageState:company.storageState,currency:company.currency});
        }
        if(route.pathname==='/api/platform-inquiries'&&(method==='GET'||method==='PUT')) {
          ownerSession(req,id,method==='PUT');
          if(method==='GET')return json(res,200,inquiryView(store.company(id)));
          const input=checkedInquiryProfile(await body(req,32768));
          const current=store.company(id);
          const preview={...current,contact_email:input.contactEmail,contact_phone:input.phone,legal_owner:input.owner,legal_address:input.address,price_note:input.priceNote,privacy_details:input.privacyDetails,legal_extra:input.additionalLegal,service_postcodes:input.postcodes,legal_reviewed:input.legalReviewed?1:0,inquiries_enabled:input.inquiries==='on'?1:input.inquiries==='off'?0:null};
          const ready=companyInquiryReadiness(preview,config.trialMail,{passwordHash:current.password_hash||''});
          const demo=Boolean(config.mountedDemo||config.pathPreview);
          if(input.inquiries==='on'&&(demo||!ready.ready))fail(400,inquiryBlockers({...ready,preference:'on'},{demo}));
          store.setInquiryProfile(id,input);await stop(id);return json(res,200,inquiryView(store.company(id)));
        }
        if(route.pathname==='/api/platform-support') {
          ownerSession(req,id,method!=='GET'&&method!=='HEAD');
          if(method==='GET'){const unread=store.supportUnread(id,'director');store.markSupportRead(id,'director');return json(res,200,{items:store.support(id),unread});}
          if(method==='POST'){const input=await body(req),message=typeof input?.message==='string'?input.message.trim():'';if(!message||message.length>4000)fail(400,'Support message must be 1–4000 characters.');return json(res,201,{item:store.addSupport(id,'company',message)});}
          fail(405,'Method not allowed.');
        }
        const port=await start(row);
        if(store.company(id)?.status!=='active')fail(423,'Company access suspended.');
        const headers={...req.headers};delete headers['x-forwarded-for'];delete headers['x-forwarded-host'];delete headers['x-forwarded-proto'];
        const proxy=httpRequest({hostname:'127.0.0.1',port,path:req.url,method,headers},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});
        proxy.on('error',()=>{if(!res.headersSent)json(res,502,{error:'Company unavailable. Retry shortly.'});else res.destroy();});
        req.on('aborted',()=>proxy.destroy());req.pipe(proxy);return;
      }
      if(route.pathname==='/api/platform/status'&&method==='GET')return json(res,200,{demo:Boolean(config.mountedDemo)});
      if(route.pathname==='/api/platform/trials'&&method==='POST') {
        if(!limiter.allow('trial:'+req.socket.remoteAddress,3,3600000,Date.now()))fail(429,'Too many trial registrations. Try again later.');
        const input=checkedTrial(await body(req));
        if(!config.mountedDemo&&!config.trialEmailSender&&(!config.trialMail?.key||!config.trialMail?.from))fail(503,'Trial email delivery is not configured.');
        const created=store.createTrialSignup(input),activationUrl=config.origin+'/trial-activate.html#token='+created.token;
        try {if(config.mountedDemo){}else if(config.trialEmailSender)await config.trialEmailSender({...input,url:activationUrl});else await sendTrialVerification(config.trialMail,{...input,url:activationUrl});}
        catch(error){store.removeTrialSignup(created.row.id);throw error;}
        store.event(null,'trial_verification_sent',{trialId:created.row.id,companyName:input.companyName});
        return json(res,202,{ok:true,demoActivationUrl:config.mountedDemo?activationUrl:undefined});
      }
      if(route.pathname==='/api/platform/trials/activate'&&method==='POST') {
        const input=await body(req);if(typeof input?.token!=='string'||!/^[\w-]{43}$/.test(input.token))fail(400,'Invalid trial verification link.');
        let passwordHash;try{passwordHash=await hashPassword(input.password);}catch{fail(400,'Password must have 14–256 characters.');}
        const signup=store.trialByToken(input.token),plan=planFor(signup?.plan_key||'solo');const tariff={name:signup?.company_name,baseCents:plan.baseCents,included:plan.included,seatCents:plan.seatCents};const created=store.activateTrial(input.token,passwordHash,checked(tariff));
        return json(res,201,{ok:true,company:publicCompany(created.row),foundingOffer:created.foundingOffer,loginUrl:tenantOrigin(created.row.id)+'/admin.html'});
      }
      if(route.pathname==='/api/platform/applications'&&method==='POST') {
        if(!limiter.allow('application:'+req.socket.remoteAddress,5,3600000,Date.now()))fail(429,'Too many applications. Try again later.');
        const application=store.submitApplication(checkedApplication(await body(req)));return json(res,201,{applicationId:application.id,status:application.status});
      }
      if(route.pathname==='/api/director/login'&&method==='POST') {
        if(!limiter.allow('login:'+req.socket.remoteAddress,8,900000,Date.now()))fail(429,'Too many attempts. Try later.');
        const input=await body(req);if(!await verifyPassword(input.password,config.passwordHash))fail(401,'Invalid credentials.');
        const token=randomToken(),csrf=randomToken();store.db.prepare('DELETE FROM director_sessions WHERE expires<=?').run(Date.now());
        store.db.prepare('INSERT INTO director_sessions VALUES(?,?,?)').run(digest(token),csrf,Date.now()+8*3600000);res.setHeader('Set-Cookie',cookie(token,28800));return json(res,200,{csrf});
      }
      if(route.pathname.startsWith('/api/director/')) {
        const auth=session(req,!['GET','HEAD'].includes(method));
        if(route.pathname==='/api/director/backups/status'&&method==='GET'){
          const value=store.db.prepare("SELECT value FROM director_meta WHERE key='last_backup'").get();
          return json(res,200,{lastPrepared:value?JSON.parse(value.value):null,offsiteVerified:false,automatic:false});
        }
        if(route.pathname==='/api/director/backups/download'&&method==='POST'){
          if(!limiter.allow('backup',3,900000,Date.now()))fail(429,'Too many backup requests. Try later.');
          const input=await body(req);
          if(typeof input.password!=='string'||input.password.length<16||input.password.length>256)fail(400,'Backup password must contain 16–256 characters.');
          if(maintenance)fail(409,'A backup is already running.');
          maintenance=true;let temporary;
          try{
            const until=Date.now()+15000;
            while([...requests].some(item=>item!==res)){if(Date.now()>until)fail(503,'Active requests did not finish. Retry backup later.');await new Promise(r=>setTimeout(r,25));}
            if(config.quiesce)await config.quiesce(res);
            await Promise.all([...children.keys()].map(stop));
            temporary=await mkdtemp(join(tmpdir(),'klarraum-backup-download-'));
            const path=join(temporary,'platform.klrb');
            const result=await createPlatformBackup({dataDir:config.dataDir,legacyDataDir:config.legacyDataDir||null,runtime:{mode:config.mountedDemo?'mounted-demo':'standalone',origin:config.origin,domain:config.domain,directorPasswordHash:config.passwordHash,legacy:config.legacyRuntime||null},password:input.password,destination:path,quiesced:true});
            store.db.prepare("INSERT INTO director_meta VALUES('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(result));
            store.event(null,'backup_prepared',{createdAt:result.createdAt,companies:result.companies,size:result.size});
            maintenance=false;
            res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':result.size,'Content-Disposition':'attachment; filename="klarraum-platform-'+result.createdAt.slice(0,10)+'.klrb"'});
            await pipeline(createReadStream(path),res);return;
          }finally{maintenance=false;if(temporary)await rm(temporary,{recursive:true,force:true});}
        }
        const financePath=route.pathname.slice('/api/director/'.length);
        if(financePath==='finance/report'&&method==='GET')return json(res,200,finance.report(route.searchParams.get('month')));
        if(financePath==='finance/forecast'&&method==='POST')return json(res,200,forecast(await body(req)));
        if(financePath==='finance/entries'&&method==='POST')return json(res,201,finance.add(await body(req),req.headers['idempotency-key']));
        const voidMatch=/^finance\/entries\/([a-f0-9-]{36})\/void$/.exec(financePath);
        if(voidMatch&&method==='POST')return json(res,200,finance.void(voidMatch[1],(await body(req)).reason));
        if(financePath==='finance/snapshots'&&method==='GET')return json(res,200,{items:finance.snapshots(route.searchParams.get('month'))});
        if(financePath==='finance/snapshots'&&method==='POST')return json(res,201,finance.snapshot((await body(req)).month));
        const snapshotMatch=/^finance\/snapshots\/([a-f0-9-]{36})$/.exec(financePath);
        if(snapshotMatch&&method==='GET'){
          const report=finance.getSnapshot(snapshotMatch[1]);
          if(route.searchParams.get('format')==='csv'){res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="platform-'+report.month+'.csv"'});return res.end(financeCsv(report));}
          return json(res,200,report);
        }
        if(route.pathname==='/api/director/session'&&method==='GET')return json(res,200,{csrf:auth.csrf});
        if(route.pathname==='/api/director/logout'&&method==='POST'){store.db.prepare('DELETE FROM director_sessions WHERE hash=?').run(auth.hash);res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});}
        if(route.pathname==='/api/director/companies'&&method==='GET')return json(res,200,{items:store.list().map(publicCompany)});
        if(route.pathname==='/api/director/companies'&&method==='POST') {
          const created=store.create(checked(await body(req)));
          return json(res,201,{company:publicCompany(created.row),inviteUrl:tenantOrigin(created.row.id)+'/owner-setup.html#token='+created.token});
        }
        const trialMatch=/^\/api\/director\/companies\/([a-f0-9-]{36})\/trial\/extend$/.exec(route.pathname);
        if(trialMatch&&method==='POST')return json(res,200,publicCompany(store.extendTrial(trialMatch[1])));
        if(route.pathname==='/api/director/applications'&&method==='GET')return json(res,200,{items:store.applications().map(publicApplication)});
        const applicationMatch=/^\/api\/director\/applications\/([a-f0-9-]{36})(?:\/(approve|status))?$/.exec(route.pathname);
        if(applicationMatch) {
          const application=store.application(applicationMatch[1]);if(!application)fail(404,'Application not found.');
          if(applicationMatch[2]==='approve'&&method==='POST') {
            const input=await body(req),plan=planFor(application.plan_key)||requestedPlanForWorkers(application.workers);if(plan.key==='custom')fail(400,'Custom plan must be agreed before approval.');if(!Number.isSafeInteger(input.version))fail(400,'Invalid application version.');
            const created=store.approveApplication(application.id,{...checked({name:input.name||application.company_name,baseCents:plan.baseCents,included:plan.included,seatCents:plan.seatCents}),planKey:plan.key,version:input.version});
            return json(res,201,{application:publicApplication(created.application),company:publicCompany(created.row),inviteUrl:tenantOrigin(created.row.id)+'/owner-setup.html#token='+created.token});
          }
          if(applicationMatch[2]==='status'&&method==='PUT') {
            const input=await body(req);if(!Number.isSafeInteger(input.version))fail(400,'Invalid application version.');
            return json(res,200,publicApplication(store.setApplicationStatus(application.id,input)));
          }
        }
        const match=/^\/api\/director\/companies\/([a-f0-9-]{36})(?:\/(invite|events|support))?$/.exec(route.pathname);
        if(match) {
          const row=store.company(match[1]);if(!row)fail(404,'Company not found.');
          if(!match[2]&&method==='PUT') {store.update(row.id,checked(await body(req),true));if(store.company(row.id).status==='suspended')await stop(row.id);return json(res,200,publicCompany(store.company(row.id)));}
          if(match[2]==='invite'&&method==='POST'){if(row.password_hash)fail(409,'Owner already activated. Password recovery requires the operator procedure.');const token=store.invite(row.id);return json(res,200,{inviteUrl:tenantOrigin(row.id)+'/owner-setup.html#token='+token});}
          if(match[2]==='events'&&method==='GET')return json(res,200,{items:store.db.prepare('SELECT action,details,created_at FROM director_events WHERE company_id=? ORDER BY id DESC LIMIT 100').all(row.id)});
          if(match[2]==='support'&&method==='GET'){store.markSupportRead(row.id,'company');return json(res,200,{items:store.support(row.id)});}
          if(match[2]==='support'&&method==='POST'){const input=await body(req),message=typeof input?.message==='string'?input.message.trim():'';if(!message||message.length>4000)fail(400,'Support message must be 1–4000 characters.');return json(res,201,{item:store.addSupport(row.id,'director',message)});}
        }
        fail(404,'Not found.');
      }
      if(!['GET','HEAD'].includes(method))fail(405,'Method not allowed.');
      if(route.pathname==='/healthz')return json(res,200,{ok:true});
      const files={'/':['index.html','text/html; charset=utf-8'],'/director.html':['index.html','text/html; charset=utf-8'],'/for-companies.html':['platform.html','text/html; charset=utf-8'],'/pricing.html':['pricing.html','text/html; charset=utf-8'],'/platform-privacy.html':['platform-privacy.html','text/html; charset=utf-8'],'/platform-terms.html':['platform-terms.html','text/html; charset=utf-8'],'/cookies.html':['cookies.html','text/html; charset=utf-8'],'/trial-activate.html':['trial-activate.html','text/html; charset=utf-8'],'/platform.css':['platform.css','text/css; charset=utf-8'],'/platform.js':['platform.js','text/javascript; charset=utf-8'],'/trial-activate.js':['trial-activate.js','text/javascript; charset=utf-8'],'/director.js':['director.js','text/javascript; charset=utf-8'],'/director.css':['director.css','text/css; charset=utf-8'],'/director-applications.js':['applications.js','text/javascript; charset=utf-8'],'/director-backup.js':['backup.js','text/javascript; charset=utf-8'],'/director-finance.js':['finance.js','text/javascript; charset=utf-8'],'/director-i18n.js':['i18n.js','text/javascript; charset=utf-8']};
      if(files[route.pathname])return staticFile(...files[route.pathname]);
      const customerPreviewFiles={'/customer-preview.html':['index.html','text/html; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/booking.css':['booking.css','text/css; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/pricing.js':['pricing.js','text/javascript; charset=utf-8'],'/site.js':['site.js','text/javascript; charset=utf-8'],'/i18n.js':['i18n.js','text/javascript; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml'],'/impressum.html':['impressum.html','text/html; charset=utf-8'],'/datenschutz.html':['datenschutz.html','text/html; charset=utf-8'],'/customer-terms.html':['customer-terms.html','text/html; charset=utf-8'],'/customer-cookies.html':['customer-cookies.html','text/html; charset=utf-8']};
      if(customerPreviewFiles[route.pathname])return staticFile(...customerPreviewFiles[route.pathname],'public');fail(404,'Not found.');
    }catch(error){if(!res.headersSent)json(res,error.status||503,{error:error.status?error.message:'Service unavailable. Check operator logs and storage.'});else res.destroy();}
  });
  server.headersTimeout=15000;server.requestTimeout=20000;
  return {server,store,tenantOrigin,companyDir,get maintenance(){return maintenance;},close(){return closing ||= (async()=>{await Promise.all([...children.keys()].map(stop));await new Promise(r=>server.close(r));store.close();if(existsSync(marker)&&readFileSync(marker,'utf8')===markerToken)unlinkSync(marker);})();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const director=createDirector(directorConfig());director.server.listen(Number(process.env.PORT||3100),'0.0.0.0',()=>console.log('Klarraum director started.'));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>director.close().then(()=>process.exit(0)));
}
