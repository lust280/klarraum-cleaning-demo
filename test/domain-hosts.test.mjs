import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {createDirector,directorConfig} from '../director.mjs';
import {hashPassword} from '../lib/security.mjs';

const password='domain-host-test-password';
const passwordHash=await hashPassword(password);

function raw(port,path,{host,method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{Host:host,...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location||'',cookie:res.headers['set-cookie']?.[0]?.split(';')[0]||'',body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);
    req.end(body===undefined?undefined:JSON.stringify(body));
  });
}

test('klarraumapp.com serves SaaS pages and does not host the calculator or cabinets',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'klarraum-apex-'));
  const config=loadConfig({DATA_DIR:directory,DEMO_ONLY:'true',APP_ORIGIN:'https://klarraumapp.com',ADMIN_PASSWORD_HASH:passwordHash});
  const hosted=createServerApp(config);
  await new Promise(resolve=>hosted.server.listen(0,'127.0.0.1',resolve));
  const port=hosted.server.address().port;
  t.after(async()=>{if(hosted.director)await hosted.director.close();await new Promise(resolve=>hosted.server.close(resolve));await rm(directory,{recursive:true,force:true});});
  const get=(path,host='klarraumapp.com')=>raw(port,path,{host});
  for(const path of ['/','/index.html','/contacts','/plans','/partner.html','/employee.html','/ops.html','/admin.html']){
    const response=await get(path);
    assert.equal(response.status,308,path);
    assert.equal(response.location,'/for-companies.html');
  }
  const director=await get('/director.html');
  assert.equal(director.status,308);
  assert.equal(director.location,'https://platform.klarraumapp.com/director.html');
  const home=await get('/for-companies.html');
  assert.equal(home.status,200);
  assert.match(home.body,/Start your 5-day trial/);
  assert.match(home.body,/href="https:\/\/platform\.klarraumapp\.com\/director\.html"/);
  assert.equal(home.body.includes('href="/director.html"'),false);
  assert.equal((await get('/pricing.html')).status,200);
  assert.match((await get('/pricing.html')).body,/€89/);
  assert.equal((await get('/trial-activate.html')).status,200);
  assert.equal((await get('/platform-privacy.html')).status,200);
  assert.equal((await get('/platform-terms.html')).status,200);
  assert.equal((await get('/cookies.html')).status,200);
  assert.equal((await get('/platform-impressum.html')).status,200);
  const onrender=await get('/partner.html','klarraum-demo.onrender.com');
  assert.equal(onrender.status,308);
  assert.equal(onrender.location,'/for-companies.html');
  const login=await raw(port,'/api/director/login',{host:'klarraumapp.com',method:'POST',headers:{Origin:'https://klarraumapp.com','Content-Type':'application/json'},body:{password}});
  assert.equal(login.status,200);
  const auth={Cookie:login.cookie,'X-CSRF-Token':JSON.parse(login.body).csrf,Origin:'https://klarraumapp.com','Content-Type':'application/json'};
  const created=await raw(port,'/api/director/companies',{host:'klarraumapp.com',method:'POST',headers:auth,body:{name:'Apex Preview Co',baseCents:7900,included:3,seatCents:500}});
  assert.equal(created.status,201);
  const payload=JSON.parse(created.body);
  const invite=new URL(payload.inviteUrl);
  const base='/companies/'+payload.company.id+'/';
  assert.ok(invite.pathname.startsWith(base));
  const activated=await raw(port,base+'api/owner-setup',{host:'klarraumapp.com',method:'POST',headers:{Origin:'https://klarraumapp.com','Content-Type':'application/json'},body:{token:new URLSearchParams(invite.hash.slice(1)).get('token'),password}});
  assert.equal(activated.status,200);
  const quote=await get(base);
  assert.equal(quote.status,200);
  assert.match(quote.body,/Get your quote/);
  assert.equal(quote.body.includes('menu-open'),false);
  assert.equal(quote.body.includes('for-companies'),false);
  assert.match((await get(base+'partner.html')).body,/partner\.js/);
  assert.match((await get(base+'ops.html')).body,/Jobs · KlarraumApp/);
  assert.match((await get(base+'employee.html')).body,/My jobs · KlarraumApp/);
  assert.match((await get(base+'impressum.html')).body,/Legal Notice/);
  assert.equal((await get(base+'datenschutz.html')).status,200);
  assert.equal((await get(base+'customer-terms.html')).status,200);
  assert.equal((await get(base+'customer-cookies.html')).status,200);
});

test('a local company server still serves the booking page',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'klarraum-local-company-'));
  const config={...loadConfig({DATA_DIR:directory}),passwordHash};
  const hosted=createServerApp(config);
  await new Promise(resolve=>hosted.server.listen(0,'127.0.0.1',resolve));
  const port=hosted.server.address().port;
  config.origin=`http://127.0.0.1:${port}`;
  t.after(async()=>{await new Promise(resolve=>hosted.server.close(resolve));await rm(directory,{recursive:true,force:true});});
  const home=await raw(port,'/',{host:`127.0.0.1:${port}`});
  assert.equal(home.status,200);
  assert.match(home.body,/Get your quote/);
  assert.equal(home.body.includes('menu-open'),false);
  assert.match((await raw(port,'/partner.html',{host:`127.0.0.1:${port}`})).body,/partner\.js/);
});

test('company UUID host and path preview serve the calculator and cabinets',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'klarraum-company-host-'));
  const previewDir=await mkdtemp(join(tmpdir(),'klarraum-company-preview-'));
  const director=createDirector(directorConfig({DIRECTOR_PASSWORD_HASH:passwordHash,DIRECTOR_DATA_DIR:directory,DIRECTOR_ORIGIN:'http://director.localhost:3100',COMPANY_BASE_DOMAIN:'companies.localhost'}));
  const preview=createDirector(directorConfig({DIRECTOR_PASSWORD_HASH:passwordHash,DIRECTOR_DATA_DIR:previewDir,DIRECTOR_ORIGIN:'http://director.localhost:3100',COMPANY_BASE_DOMAIN:'companies.localhost',PLATFORM_PATH_PREVIEW:'true'}));
  await new Promise(resolve=>director.server.listen(0,'127.0.0.1',resolve));
  await new Promise(resolve=>preview.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await director.close();await preview.close();await rm(directory,{recursive:true,force:true});await rm(previewDir,{recursive:true,force:true});});
  async function openCompany(app,port){
    const directorHost='director.localhost:3100';
    const login=await raw(port,'/api/director/login',{host:directorHost,method:'POST',headers:{Origin:'http://'+directorHost,'Content-Type':'application/json'},body:{password}});
    assert.equal(login.status,200);
    const auth={Cookie:login.cookie,'X-CSRF-Token':JSON.parse(login.body).csrf,Origin:'http://'+directorHost,'Content-Type':'application/json'};
    const created=await raw(port,'/api/director/companies',{host:directorHost,method:'POST',headers:auth,body:{name:'Hosted Cleaning',baseCents:7900,included:3,seatCents:500}});
    assert.equal(created.status,201);
    const payload=JSON.parse(created.body);
    const invite=new URL(payload.inviteUrl);
    const token=new URLSearchParams(invite.hash.slice(1)).get('token');
    const setupPath=invite.pathname.replace(/owner-setup\.html$/,'api/owner-setup');
    const setup=await raw(port,setupPath,{host:invite.host,method:'POST',headers:{Origin:invite.origin,'Content-Type':'application/json'},body:{token,password}});
    assert.equal(setup.status,200);
    return {id:payload.company.id,host:invite.host,directorHost};
  }
  const company=await openCompany(director,director.server.address().port);
  assert.match(company.host,/^[a-f0-9-]+\.companies\.localhost:3100$/);
  const port=director.server.address().port;
  const site=path=>raw(port,path,{host:company.host});
  assert.match((await site('/')).body,/Get your quote/);
  assert.match((await site('/partner.html')).body,/partner\.js/);
  assert.match((await site('/ops.html')).body,/Jobs · KlarraumApp/);
  assert.match((await site('/employee.html')).body,/My jobs · KlarraumApp/);
  assert.match((await site('/impressum.html')).body,/Legal Notice/);
  assert.equal((await site('/customer-terms.html')).status,200);
  assert.equal((await raw(port,'/partner.html',{host:company.directorHost})).status,404);
  const shell=await raw(port,'/',{host:company.directorHost});
  assert.match(shell.body,/Your cleaning business website and ops in one place/);
  assert.equal(shell.body.includes('Get your quote'),false);
  assert.match((await raw(port,'/director.html',{host:company.directorHost})).body,/Director/);
  assert.match((await raw(port,'/pricing.html',{host:company.directorHost})).body,/href="\/director\.html"/);
  const bare=await raw(port,'/',{host:'companies.localhost:3100'});
  assert.equal(bare.status,404);
  assert.match(bare.body,/Unknown company/);

  const shown=await openCompany(preview,preview.server.address().port);
  const previewPort=preview.server.address().port;
  const base=`/companies/${shown.id}/`;
  assert.equal((await raw(previewPort,`/companies/${shown.id}`,{host:shown.directorHost})).status,302);
  assert.match((await raw(previewPort,base,{host:shown.directorHost})).body,/Get your quote/);
  assert.match((await raw(previewPort,base+'partner.html',{host:shown.directorHost})).body,/partner\.js/);
  assert.match((await raw(previewPort,base+'ops.html',{host:shown.directorHost})).body,/Jobs · KlarraumApp/);
  assert.match((await raw(previewPort,base+'employee.html',{host:shown.directorHost})).body,/My jobs · KlarraumApp/);
  assert.match((await raw(previewPort,base+'impressum.html',{host:shown.directorHost})).body,/Legal Notice/);
  assert.equal((await raw(previewPort,'/partner.html',{host:shown.directorHost})).status,404);
});
