import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';
import {Store} from '../lib/store.mjs';

const password='test-only-password-which-is-not-used-in-production';
const passwordHash=await hashPassword(password);
async function fixture(t,options={}) {
 const dir=await mkdtemp(join(tmpdir(),'klarraum-test-'));
 let clock=Date.UTC(2026,9,25,10);
 const notifications=[];
 const config={...loadConfig({DATA_DIR:dir}),passwordHash,live:true,
  business:{name:'Test company',owner:'Test owner',address:'Test address',email:'owner@example.invalid',postcodes:['90','91']},
  mail:{key:'test-only',from:'test@example.invalid',to:'owner@example.invalid'},...options.config};
 const appOptions={now:()=>clock,fetcher:async(url,init)=>{notifications.push({url,...init});return {ok:!options.mailFailure};}};
 const {server,app}=createServerApp(config,appOptions);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 config.origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await app.drain();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 async function request(path,{method='GET',body,headers={}}={}){
  const response=await fetch(config.origin+path,{method,headers:{Origin:config.origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data,headers:response.headers};
 }
 async function token(){const response=await request('/api/form-token');clock+=2100;return response.data.token;}
 async function submit(changes={},key=randomUUID()){
  return request('/api/inquiries',{method:'POST',headers:{'Idempotency-Key':key},body:{name:'Test customer',email:'customer@example.invalid',phone:'',postcode:'90402',address:'',date:'2026-11-02',message:'Test inquiry',service:'home',area:70,frequency:'once',windows:false,privacy:true,website:'',token:await token(),...changes}});
 }
 async function login(){const response=await request('/api/admin/login',{method:'POST',body:{password}});assert.equal(response.status,200);return {'Cookie':response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':response.data.csrf};}
 return {request,submit,token,login,app,config,notifications,advance:ms=>{clock+=ms;}};
}

test('save, calculate on server, notify without contact data, and deduplicate retries',async t=>{
 const f=await fixture(t);const key=randomUUID();
 const response=await f.submit({price:0,preferredTime:'10:30'},key);assert.equal(response.status,201);assert.equal(response.data.price,126);
 await f.app.drain();assert.equal(f.notifications.length,1);
 const mail=JSON.parse(f.notifications[0].body);assert.ok(!mail.text.includes('customer@example.invalid'));
 const repeat=await f.submit({price:0,preferredTime:'10:30'},key);assert.equal(repeat.status,200);assert.equal(repeat.data.id,response.data.id);
 const changed=await f.submit({name:'Different'},key);assert.equal(changed.status,409);
 const headers=await f.login();const list=await f.request('/api/admin/inquiries',{headers});
 assert.equal(list.data.total,1);assert.equal(list.data.items[0].notification,'sent');assert.equal(list.data.items[0].email,'customer@example.invalid');assert.equal(list.data.items[0].preferredTime,'10:30');
 assert.equal(list.headers.get('cache-control'),'no-store');
});

test('validate personal data, area, service region, date, privacy, honeypot and form token',async t=>{
 const f=await fixture(t);
 for(const invalid of [{name:''},{email:'',phone:''},{email:'bad'},{email:'a@b.c\nBcc: x@y.z'},{phone:'abc'},{postcode:'12345'},{postcode:'9040'},{date:'2026-02-30'},{date:'2025-01-01'},{date:'2030-01-01'},{preferredTime:'25:00'},{area:1001},{area:20.5},{service:'__proto__'},{windows:'true'},{privacy:false},{message:'x'.repeat(2001)},{website:'spam'},{token:'forged'}]){
  const response=await f.submit(invalid);assert.equal(response.status,400,JSON.stringify(invalid));
 }
 const body={token:(await f.request('/api/form-token')).data.token};
 assert.equal((await f.request('/api/inquiries',{method:'POST',body})).status,400);
 assert.equal((await f.request('/api/admin/inquiries')).status,401);
});

test('limit inquiry creation without allowing spoofed forwarded IPs',async t=>{
 const f=await fixture(t);
 for(let i=0;i<5;i++)assert.equal((await f.submit()).status,201);
 assert.equal((await f.submit()).status,429);
 const response=await f.request('/api/inquiries',{method:'POST',headers:{'X-Forwarded-For':'different-ip'},body:{}});
 assert.notEqual(response.status,201);
});

test('authentication, CSRF, cross-origin rejection, status, deletion, logout and expiry',async t=>{
 const f=await fixture(t);const saved=await f.submit();const id=saved.data.id;
 assert.equal((await f.request('/api/admin/login',{method:'POST',body:{password:'incorrect'}})).status,401);
 const headers=await f.login();
 assert.equal((await f.request('/api/admin/inquiries/'+id,{method:'PATCH',headers:{Cookie:headers.Cookie},body:{status:'completed'}})).status,403);
 assert.equal((await f.request('/api/admin/inquiries/'+id,{method:'PATCH',headers:{...headers,Origin:'https://evil.invalid'},body:{status:'completed'}})).status,403);
 assert.equal((await f.request('/api/admin/inquiries/'+id,{method:'PATCH',headers,body:{status:'confirmed'}})).status,200);
 const filtered=await f.request('/api/admin/inquiries?status=confirmed',{headers});assert.equal(filtered.data.total,1);
 assert.equal((await f.request('/api/admin/inquiries/'+id,{method:'DELETE',headers})).status,200);
 assert.equal((await f.request('/api/admin/inquiries',{headers})).data.total,0);
 assert.equal((await f.request('/api/admin/logout',{method:'POST',headers})).status,200);
 assert.equal((await f.request('/api/admin/session',{headers})).status,401);
 const next=await f.login();f.advance(8*3600000+1);assert.equal((await f.request('/api/admin/session',{headers:next})).status,401);
});

test('login brute force is rate limited',async t=>{
 const f=await fixture(t);
 for(let i=0;i<5;i++)assert.equal((await f.request('/api/admin/login',{method:'POST',body:{password:'wrong'}})).status,401);
 assert.equal((await f.request('/api/admin/login',{method:'POST',body:{password}})).status,429);
});

test('owner can save a custom-domain request without activating it prematurely',async t=>{
 const f=await fixture(t),headers=await f.login();
 const initial=await f.request('/api/admin/company-preferences',{headers});assert.equal(initial.status,200);assert.equal(initial.data.customDomain,'');assert.equal(initial.data.domainStatus,'not-requested');
 const saved=await f.request('/api/admin/company-preferences',{method:'PUT',headers,body:{timeZone:'America/New_York',currency:'USD',customDomain:'BrightClean.Example.COM'}});
 assert.equal(saved.status,200);assert.equal(saved.data.customDomain,'brightclean.example.com');assert.equal(saved.data.domainStatus,'pending-hosting');
 assert.equal((await f.request('/api/admin/company-preferences',{headers})).data.customDomain,'brightclean.example.com');
 assert.equal((await f.request('/api/admin/company-preferences',{method:'PUT',headers,body:{timeZone:'America/New_York',currency:'USD',customDomain:'https://not-a-domain.example/path'}})).status,400);
 assert.equal((await f.request('/api/admin/company-preferences',{method:'PUT',headers,body:{timeZone:'America/New_York',currency:'USD',customDomain:'klarraumapp.com'}})).status,400);
});

test('pricing updates are validated and historical quotes stay unchanged',async t=>{
 const f=await fixture(t);await f.submit();const headers=await f.login();
 const current=(await f.request('/api/admin/settings',{headers})).data.pricing;
 assert.equal((await f.request('/api/admin/settings',{method:'PUT',headers,body:{...current,minimum:-10}})).status,400);
 assert.equal((await f.request('/api/admin/settings',{method:'PUT',headers,body:{...current,rates:{home:2,office:2,deep:4}}})).status,200);
 assert.equal((await f.submit()).data.price,140);
 const list=await f.request('/api/admin/inquiries',{headers});assert.deepEqual(list.data.items.map(x=>x.price).sort((a,b)=>a-b),[126,140]);
});

test('mail failure preserves inquiry and exposes retry state to owner',async t=>{
 const f=await fixture(t,{mailFailure:true});const saved=await f.submit();assert.equal(saved.status,201);
 await f.app.drain();const headers=await f.login();
 const list=await f.request('/api/admin/inquiries',{headers});assert.equal(list.data.items[0].notification,'failed');assert.equal(list.data.total,1);
 assert.equal((await f.request(`/api/admin/inquiries/${saved.data.id}/retry-mail`,{method:'POST',headers})).status,200);
 await f.app.drain();assert.equal(f.notifications.length,2);
});

test('preview rejects real submissions and protects server files',async t=>{
 const f=await fixture(t,{config:{live:false}});
 assert.equal((await f.request('/api/config')).data.live,false);
 assert.equal((await f.request('/api/inquiries',{method:'POST',body:{}})).status,503);
 assert.equal((await f.request('/healthz')).data.ok,true);
 assert.equal((await f.request('/server.mjs')).status,404);
 assert.equal((await f.request('/.env')).status,404);
 assert.equal((await f.request('/admin.html')).status,200);
 assert.ok((await f.request('/')).headers.get('content-security-policy').includes("frame-ancestors 'none'"));
});

test('persistent storage, retention, consistent backup and restoration',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'klarraum-backup-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'db.sqlite'),backup=join(dir,'backup.sqlite');let store=new Store(file);
 const row=store.add(randomUUID(),'fingerprint',{name:'Test',price:60},Date.now());
 await store.backup(backup);store.close();
 store=new Store(file);assert.equal(store.get(row.id).id,row.id);store.close();
 const restored=new Store(backup);assert.equal(restored.get(row.id).id,row.id);
 restored.cleanup(Date.now()+91*86400000,90);assert.equal(restored.list('',0).total,0);restored.close();
});

test('production refuses unsafe and incomplete configuration',()=>{
 assert.throws(()=>loadConfig({NODE_ENV:'production'}));
 assert.throws(()=>loadConfig({NODE_ENV:'production',APP_ORIGIN:'https://example.invalid',ADMIN_PASSWORD_HASH:passwordHash,APP_SECRET:'short'}));
 assert.throws(()=>loadConfig({ENABLE_INQUIRIES:'true',ADMIN_PASSWORD_HASH:passwordHash}));
 assert.throws(()=>loadConfig({RETENTION_DAYS:'0'}));
});

test('reject malformed, null, oversized and cross-origin submissions',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/api/inquiries',{method:'POST',body:null})).status,400);
 assert.equal((await f.request('/api/inquiries',{method:'POST',body:{},headers:{Origin:'https://evil.invalid'}})).status,403);
 assert.equal((await f.request('/api/inquiries',{method:'POST',body:{message:'x'.repeat(20000)}})).status,413);
 const response=await fetch(f.config.origin+'/api/inquiries',{method:'POST',headers:{Origin:f.config.origin,'Content-Type':'application/json'},body:'{invalid'});
 assert.equal(response.status,400);
 assert.equal((await f.submit({token:'1.'+'a'.repeat(43)+'.'+'é'.repeat(43)})).status,400);
});

test('password/secret rotation invalidates stored owner sessions',async t=>{
 const f=await fixture(t);const headers=await f.login();assert.equal((await f.request('/api/admin/session',{headers})).status,200);
 f.app.store.bindAuth('changed-credential-fingerprint');
 assert.equal((await f.request('/api/admin/session',{headers})).status,401);
});

test('Render free demo uses its assigned origin, generated credentials and blocks live collection',async()=>{
 const {verifyPassword}=await import('../lib/security.mjs');
 const env={NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://klarraum-example.onrender.com',APP_SECRET:'test-only-secret-at-least-32-characters',ADMIN_PASSWORD:'test-only-hosted-password-at-least-14',DEMO_ONLY:'true',ENABLE_INQUIRIES:'false'};
 const first=loadConfig(env),second=loadConfig(env);
 assert.equal(first.origin,env.RENDER_EXTERNAL_URL);assert.equal(first.live,false);
 assert.equal(first.passwordHash,second.passwordHash);assert.ok(await verifyPassword(env.ADMIN_PASSWORD,first.passwordHash));
 assert.notEqual(loadConfig({...env,APP_SECRET:env.APP_SECRET+'-rotated'}).passwordHash,first.passwordHash);
 assert.throws(()=>loadConfig({...env,ADMIN_PASSWORD:'short'}));
 assert.throws(()=>loadConfig({...env,ENABLE_INQUIRIES:'true'}));
});

test('server demo connects form to owner dashboard without accepting personal fields or sending mail',async t=>{
 const f=await fixture(t,{config:{live:false,demoMode:true}});
 const key=randomUUID();const body={service:'home',area:80,frequency:'once',windows:false,privacy:true,website:'',token:await f.token()};
 const headers={'Idempotency-Key':key};
 const saved=await f.request('/api/demo/inquiries',{method:'POST',headers,body});assert.equal(saved.status,201);assert.equal(saved.data.demo,true);
 assert.equal((await f.request('/api/demo/inquiries',{method:'POST',headers,body})).status,200);
 assert.equal((await f.request('/api/demo/inquiries',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:{...body,name:'Actual person'}})).status,400);
 assert.equal((await f.request('/api/inquiries',{method:'POST',headers,body})).status,503);
 await f.app.drain();assert.equal(f.notifications.length,0);
 const auth=await f.login();const list=await f.request('/api/admin/inquiries',{headers:auth});assert.equal(list.data.total,1);
 const item=list.data.items[0];assert.equal(item.name,'Demo customer');assert.equal(item.email,'demo@example.invalid');assert.equal(item.area,80);assert.equal(item.demo,true);assert.equal(item.notification,'demo');
 assert.equal((await f.request(`/api/admin/inquiries/${item.id}/retry-mail`,{method:'POST',headers:auth})).status,400);
 assert.equal((await f.request(`/api/admin/inquiries/${item.id}`,{method:'DELETE',headers:auth})).status,200);
});

test('owner can edit brand and service settings, reject stale edits and block unavailable services',async t=>{
 const f=await fixture(t);const headers=await f.login();
 assert.equal((await f.request('/api/admin/site')).status,401);
 const original=(await f.request('/api/admin/site',{headers})).data;
 const content=structuredClone(original.content);content.company.name='Nordlicht Reinigung';content.company.theme='navy';content.hero.title='Mehr Zeit für Sie.';
 content.services.office.enabled=false;content.services.home.title='Hauspflege';content.windowsEnabled=false;
 assert.equal((await f.request('/api/admin/site',{method:'PUT',headers:{Cookie:headers.Cookie},body:{version:original.version,content}})).status,403);
 const saved=await f.request('/api/admin/site',{method:'PUT',headers,body:{version:original.version,content}});assert.equal(saved.status,200);
 assert.equal(saved.data.version,original.version+1);
 const publicConfig=(await f.request('/api/config')).data;assert.equal(publicConfig.site.company.name,'Nordlicht Reinigung');assert.equal(publicConfig.business.name,'Test company');
 assert.equal((await f.request('/api/admin/site',{method:'PUT',headers,body:{version:original.version,content}})).status,409);
 assert.equal((await f.submit({service:'office'})).status,400);assert.equal((await f.submit({windows:true})).status,400);
 const invalid=structuredClone(content);for(const item of Object.values(invalid.services))item.enabled=false;
 assert.equal((await f.request('/api/admin/site',{method:'PUT',headers,body:{version:saved.data.version,content:invalid}})).status,400);
 for(const value of [{...content,company:{...content.company,email:'javascript:bad'}},{...content,company:{...content.company,theme:'url(https://bad.invalid)'}},{...content,hero:{...content.hero,title:'x'.repeat(101)}}]){
  assert.equal((await f.request('/api/admin/site',{method:'PUT',headers,body:{version:saved.data.version,content:value}})).status,400);
 }
 const created=await f.submit();assert.equal(created.status,201);const listed=(await f.request('/api/admin/inquiries',{headers})).data.items[0];assert.equal(listed.serviceTitle,'Hauspflege');
 const bookingSettings=structuredClone(saved.data.content);bookingSettings.booking={enabled:true,dateEnabled:false,timeEnabled:false};
 const bookingSaved=await f.request('/api/admin/site',{method:'PUT',headers,body:{version:saved.data.version,content:bookingSettings}});assert.equal(bookingSaved.status,200);
 const dateFree=await f.submit({date:'2026-11-02',preferredTime:'10:00'});assert.equal(dateFree.status,201);
 const dateFreeRow=(await f.request('/api/admin/inquiries',{headers})).data.items.find(item=>item.id===dateFree.data.id);assert.equal(dateFreeRow.date,'');assert.equal(dateFreeRow.preferredTime,'');
 const paused=structuredClone(bookingSaved.data.content);paused.booking.enabled=false;
 const pausedSaved=await f.request('/api/admin/site',{method:'PUT',headers,body:{version:bookingSaved.data.version,content:paused}});assert.equal(pausedSaved.status,200);
 assert.equal((await f.submit()).status,503);
});

test('private notes, status totals and settings persist without changing stored inquiry details',async t=>{
 const f=await fixture(t);const id=(await f.submit()).data.id;const headers=await f.login();
 assert.equal((await f.request(`/api/admin/inquiries/${id}/note`,{method:'PUT',body:{note:'private'}})).status,401);
 assert.equal((await f.request(`/api/admin/inquiries/${id}/note`,{method:'PUT',headers,body:{note:'x'.repeat(2001)}})).status,400);
 assert.equal((await f.request(`/api/admin/inquiries/${id}/note`,{method:'PUT',headers,body:{note:'Rückruf am Dienstag <script>test</script>'}})).status,200);
 const listed=(await f.request('/api/admin/inquiries',{headers})).data;assert.equal(listed.items[0].note,'Rückruf am Dienstag <script>test</script>');
 assert.equal((await f.request('/api/admin/summary',{headers})).data.new,1);
 await f.request(`/api/admin/inquiries/${id}`,{method:'PATCH',headers,body:{status:'contacted'}});
 const summary=(await f.request('/api/admin/summary',{headers})).data;assert.equal(summary.new,0);assert.equal(summary.contacted,1);assert.equal(summary.total,1);
 await f.request(`/api/admin/inquiries/${id}`,{method:'DELETE',headers});assert.equal((await f.request('/api/admin/summary',{headers})).data.total,0);
 assert.equal(f.app.store.db.prepare('SELECT COUNT(*) AS n FROM inquiry_notes').get().n,0);
 const settings=f.app.store.site();const content=structuredClone(settings.content);content.company.name='Persistent brand';f.app.store.setSite(settings.version,content);
 const reopened=new Store(f.config.dbPath);assert.equal(reopened.site().content.company.name,'Persistent brand');reopened.close();
});

test('image upload validates authorization and format, strips metadata, protects references and supports deletion',async t=>{
 const sharp=(await import('sharp')).default;const f=await fixture(t);const headers=await f.login();
 const input=await sharp({create:{width:900,height:300,channels:3,background:'#165444'}}).jpeg().withExif({IFD0:{Artist:'Private test metadata'}}).toBuffer();
 async function upload(data=input,type='image/jpeg',auth=headers,kind='logo'){
  const response=await fetch(f.config.origin+'/api/admin/media?kind='+kind,{method:'POST',headers:{Origin:f.config.origin,...auth,'Content-Type':type},body:data});return {status:response.status,data:await response.json()};
 }
 assert.equal((await upload(input,'image/jpeg',{})).status,401);
 assert.equal((await upload(input,'image/jpeg',{Cookie:headers.Cookie})).status,403);
 assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),'image/svg+xml')).status,415);
 assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),'image/png')).status,400);
 assert.equal((await upload(Buffer.alloc(5*1024*1024+1),'image/png')).status,413);
 const saved=await upload();assert.equal(saved.status,201);assert.ok(saved.data.width<=600);
 const publicResponse=await fetch(f.config.origin+`/media/${saved.data.id}.webp`);assert.equal(publicResponse.status,200);assert.equal(publicResponse.headers.get('content-type'),'image/webp');
 const meta=await sharp(Buffer.from(await publicResponse.arrayBuffer())).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);assert.ok(meta.width<=600);
 const site=(await f.request('/api/admin/site',{headers})).data;site.content.media={logo:saved.data.id,hero:null,gallery:[]};site.content.testimonials=[{name:'Approved test author',text:'Test-only review fixture'}];
 assert.equal((await f.request('/api/admin/site',{method:'PUT',headers,body:site})).status,200);
 assert.equal((await f.request(`/api/admin/media/${saved.data.id}`,{method:'DELETE',headers})).status,409);
 const current=(await f.request('/api/admin/site',{headers})).data;current.content.media.logo=null;
 assert.equal((await f.request('/api/admin/site',{method:'PUT',headers,body:current})).status,200);
 assert.equal((await f.request(`/api/admin/media/${saved.data.id}`,{method:'DELETE',headers})).status,200);
 assert.equal((await fetch(f.config.origin+`/media/${saved.data.id}.webp`)).status,404);
 const missing=(await f.request('/api/admin/site',{headers})).data;missing.content.media.logo=saved.data.id;
 assert.equal((await f.request('/api/admin/site',{method:'PUT',headers,body:missing})).status,400);
});

test('media rejects decompression-sized images and backup includes image files',async t=>{
 const sharp=(await import('sharp')).default;const {execFileSync}=await import('node:child_process');const {readdir,readFile}=await import('node:fs/promises');
 const f=await fixture(t);const headers=await f.login();
 const large=await sharp({create:{width:4100,height:3000,channels:3,background:'white'}}).png().toBuffer();
 const upload=data=>fetch(f.config.origin+'/api/admin/media?kind=gallery',{method:'POST',headers:{Origin:f.config.origin,...headers,'Content-Type':'image/png'},body:data});
 assert.equal((await upload(large)).status,400);
 const image=await sharp({create:{width:64,height:64,channels:4,background:{r:0,g:100,b:80,alpha:0.5}}}).png().toBuffer();
 const response=await upload(image);assert.equal(response.status,201);const item=await response.json();
 const dataDir=(await import('node:path')).dirname(f.config.dbPath);const backupDir=join(dataDir,'backups');
 execFileSync(process.execPath,['scripts/backup.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:dataDir,BACKUP_DIR:backupDir},stdio:'pipe'});
 const files=await readdir(backupDir);const name=files.find(name=>name.endsWith('.sqlite'));assert.ok(name);
 assert.ok((await readFile(join(backupDir,name+'.media',item.id+'.webp'))).length>0);
 const snapshot=new Store(join(backupDir,name));assert.equal(snapshot.listMedia().length,1);snapshot.close();
});

async function addWorker(f,owner,index=1){
 const created=await f.request('/api/admin/employees',{method:'POST',headers:owner,body:{name:'Test Worker '+index,email:`worker${index}@example.invalid`,region:index===1?'Nürnberg':'Berlin'}});assert.equal(created.status,201);
 const token=new URLSearchParams(new URL(created.data.inviteUrl).hash.slice(1)).get('invite');
 const accepted=await f.request('/api/employee/accept-invite',{method:'POST',body:{token,password:'test-only-employee-password'}});assert.equal(accepted.status,200);
 return {employee:created.data.employee,token,headers:{Cookie:accepted.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':accepted.data.csrf}};
}
async function addJob(f,owner,employeeId,changes={}){
 const body={employeeId,title:'Test cleaning task',address:'Fictional street 1',customer:'Test customer',contact:'test@example.invalid',region:'Nürnberg',date:'2026-11-01',time:'09:00',plannedMinutes:120,instructions:'Test only',checklist:['Kitchen','Bathroom'],...changes};
 const response=await f.request('/api/admin/jobs',{method:'POST',headers:{...owner,'Idempotency-Key':randomUUID()},body});assert.equal(response.status,201);return response.data;
}
async function work(f,worker,job,action,extra={},key=randomUUID()){
 return f.request(`/api/employee/jobs/${job.id}/actions`,{method:'POST',headers:{...worker.headers,'Idempotency-Key':key},body:{action,version:job.version,...extra}});
}

test('employee invitations are single-use; roles and job access are isolated',async t=>{
 const f=await fixture(t),owner=await f.login(),a=await addWorker(f,owner,1),b=await addWorker(f,owner,2),job=await addJob(f,owner,a.employee.id);
 assert.equal((await f.request('/api/employee/accept-invite',{method:'POST',body:{token:a.token,password:'another-test-password'}})).status,400);
 assert.equal((await f.request('/api/admin/jobs',{headers:a.headers})).status,401);
 assert.equal((await f.request('/api/employee/jobs',{headers:owner})).status,401);
 assert.equal((await f.request('/api/employee/jobs',{headers:b.headers})).data.total,0);
 assert.equal((await f.request('/api/employee/jobs/'+job.id,{headers:b.headers})).status,404);
 assert.equal((await work(f,b,job,'start')).status,404);
 assert.equal((await f.request('/api/employee/jobs/'+job.id+'/actions',{method:'POST',headers:{Cookie:a.headers.Cookie,'Idempotency-Key':randomUUID()},body:{action:'start',version:job.version}})).status,403);
 assert.equal((await f.request('/api/admin/jobs',{headers:owner})).data.total,1);
 const list=(await f.request('/api/admin/employees',{headers:owner})).data;assert.equal(list.total,2);assert.equal(list.items[0].password_hash,undefined);assert.equal(list.items[0].invite_hash,undefined);
});

test('server tracks work and breaks once, requires report for incomplete checklist and records corrections',async t=>{
 const f=await fixture(t),owner=await f.login(),worker=await addWorker(f,owner);let job=await addJob(f,owner,worker.employee.id);const initial=structuredClone(job),key=randomUUID();
 let response=await work(f,worker,job,'start',{},key);assert.equal(response.status,200);job=response.data;assert.equal(job.state,'working');
 assert.equal((await work(f,worker,initial,'start',{},key)).status,200);
 f.advance(60000);response=await work(f,worker,job,'pause');assert.equal(response.status,200);job=response.data;assert.equal(job.workedMilliseconds,60000);assert.equal(job.intervals.length,1);
 f.advance(60000);job=(await work(f,worker,job,'resume')).data;f.advance(120000);
 assert.equal((await work(f,worker,job,'finish',{done:[true,false],report:''})).status,400);
 let current=(await f.request('/api/employee/jobs/'+job.id,{headers:worker.headers})).data;assert.equal(current.state,'working');assert.equal(current.intervals[1].ended_at,null);
 response=await work(f,worker,job,'finish',{done:[true,false],report:'Bathroom inaccessible in this test'});assert.equal(response.status,200);job=response.data;assert.equal(job.state,'submitted');assert.equal(job.workedMilliseconds,180000);
 const corrected=await f.request(`/api/admin/jobs/${job.id}/corrections`,{method:'POST',headers:{...owner,'Idempotency-Key':randomUUID()},body:{version:job.version,minutes:-1,reason:'Correction agreed with employee'}});assert.equal(corrected.status,200);job=corrected.data;assert.equal(job.workedMilliseconds,120000);assert.equal(job.rawMilliseconds,180000);assert.equal(job.corrections.length,1);
 const approved=await f.request(`/api/admin/jobs/${job.id}/actions`,{method:'POST',headers:{...owner,'Idempotency-Key':randomUUID()},body:{version:job.version,action:'approve',reason:''}});assert.equal(approved.status,200);job=approved.data;assert.equal(job.state,'closed');assert.ok(job.events.some(event=>event.action==='time_correction'));
 assert.equal((await work(f,worker,job,'resume')).status,409);
});

test('one active job per worker; deactivation stops time and invalidates access',async t=>{
 const f=await fixture(t),owner=await f.login(),worker=await addWorker(f,owner),a=await addJob(f,owner,worker.employee.id),b=await addJob(f,owner,worker.employee.id);
 assert.equal((await work(f,worker,a,'start')).status,200);assert.equal((await work(f,worker,b,'start')).status,409);f.advance(30000);
 assert.equal((await f.request('/api/admin/employees/'+worker.employee.id,{method:'PATCH',headers:owner,body:{active:false}})).status,200);
 assert.equal((await f.request('/api/employee/session',{headers:worker.headers})).status,401);
 const stored=(await f.request('/api/admin/jobs/'+a.id,{headers:owner})).data;assert.equal(stored.state,'paused');assert.equal(stored.workedMilliseconds,30000);f.advance(60000);
 assert.equal((await f.request('/api/admin/jobs/'+a.id,{headers:owner})).data.workedMilliseconds,30000);
 assert.equal((await f.request('/api/employee/login',{method:'POST',body:{email:worker.employee.email,password:'test-only-employee-password'}})).status,401);
});

test('employee listing supports more than fifty people and invite expiry is enforced',async t=>{
 const f=await fixture(t),owner=await f.login();
 for(let i=0;i<55;i++){const response=await f.request('/api/admin/employees',{method:'POST',headers:owner,body:{name:'Staff '+String(i).padStart(2,'0'),email:`staff${i}@example.invalid`,region:i<30?'Berlin':'Nürnberg'}});assert.equal(response.status,201);}
 const first=(await f.request('/api/admin/employees',{headers:owner})).data,second=(await f.request('/api/admin/employees?offset=50',{headers:owner})).data;assert.equal(first.total,55);assert.equal(first.items.length,50);assert.equal(second.items.length,5);
 assert.equal((await f.request('/api/admin/employees?search=Berlin',{headers:owner})).data.total,30);
 const invite=await f.request('/api/admin/employees/'+first.items[0].id+'/invite',{method:'POST',headers:owner});const token=new URLSearchParams(new URL(invite.data.inviteUrl).hash.slice(1)).get('invite');f.advance(49*3600000);
 assert.equal((await f.request('/api/employee/accept-invite',{method:'POST',body:{token,password:'test-only-long-password'}})).status,400);
});

test('work photos stay private to owner and assigned worker and are included in backups',async t=>{
 const sharp=(await import('sharp')).default,{execFileSync}=await import('node:child_process'),{readdir,readFile}=await import('node:fs/promises');
 const f=await fixture(t),owner=await f.login(),worker=await addWorker(f,owner,1),other=await addWorker(f,owner,2);let job=await addJob(f,owner,worker.employee.id);
 job=(await work(f,worker,job,'start')).data;const image=await sharp({create:{width:60,height:40,channels:3,background:'white'}}).png().toBuffer();
 const upload=auth=>fetch(f.config.origin+`/api/employee/jobs/${job.id}/photos`,{method:'POST',headers:{Origin:f.config.origin,...auth,'Content-Type':'image/png'},body:image});
 assert.equal((await upload(other.headers)).status,404);const response=await upload(worker.headers);assert.equal(response.status,201);const photo=await response.json();
 const photoUrl=f.config.origin+photo.url;
 assert.equal((await fetch(photoUrl)).status,401);assert.equal((await fetch(photoUrl,{headers:other.headers})).status,404);
 const ownResponse=await fetch(photoUrl,{headers:worker.headers});assert.equal(ownResponse.status,200);assert.equal(ownResponse.headers.get('cache-control'),'private, no-store');
 assert.equal((await fetch(photoUrl,{headers:owner})).status,200);assert.equal((await fetch(f.config.origin+`/media/${photo.id}.webp`)).status,404);
 const dataDir=(await import('node:path')).dirname(f.config.dbPath),backupDir=join(dataDir,'backups');execFileSync(process.execPath,['scripts/backup.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATA_DIR:dataDir,BACKUP_DIR:backupDir},stdio:'pipe'});
 const name=(await readdir(backupDir)).find(name=>name.endsWith('.sqlite'));assert.ok((await readFile(join(backupDir,name+'.jobs',photo.id+'.webp'))).length>0);
 job=(await work(f,worker,job,'finish',{done:[true,true],report:'Complete test'})).data;assert.equal(job.photos.length,1);
 assert.equal((await f.request(`/api/employee/jobs/${job.id}/photos/${photo.id}`,{method:'DELETE',headers:worker.headers})).status,409);
});

test('owner can change an unstarted plan and assignee, while stale or started plan edits are rejected',async t=>{
 const f=await fixture(t),owner=await f.login(),a=await addWorker(f,owner,1),b=await addWorker(f,owner,2),job=await addJob(f,owner,a.employee.id);
 const changes={version:job.version,employeeId:b.employee.id,title:'Updated visit',address:'New fictional address',customer:'Test',contact:'',region:'Berlin',date:'2026-11-02',time:'10:00',plannedMinutes:180,instructions:'Updated instructions',checklist:['New task']};
 const result=await f.request('/api/admin/jobs/'+job.id,{method:'PUT',headers:{...owner,'Idempotency-Key':randomUUID()},body:changes});assert.equal(result.status,200);assert.equal(result.data.employee_id,b.employee.id);
 assert.equal((await f.request('/api/employee/jobs/'+job.id,{headers:a.headers})).status,404);
 assert.equal((await f.request('/api/admin/jobs/'+job.id,{method:'PUT',headers:{...owner,'Idempotency-Key':randomUUID()},body:changes})).status,409);
 const started=(await work(f,b,result.data,'start')).data;assert.equal(started.state,'working');
 assert.equal((await f.request('/api/admin/jobs/'+job.id,{method:'PUT',headers:{...owner,'Idempotency-Key':randomUUID()},body:{...changes,version:started.version}})).status,409);
});

test('employee password changes revoke old sessions and owner reset revokes the new credentials',async t=>{
 const f=await fixture(t),owner=await f.login(),worker=await addWorker(f,owner);
 const result=await f.request('/api/employee/change-password',{method:'POST',headers:worker.headers,body:{currentPassword:'test-only-employee-password',newPassword:'changed-test-only-employee-password'}});assert.equal(result.status,200);
 assert.equal((await f.request('/api/employee/session',{headers:worker.headers})).status,401);
 const auth={Cookie:result.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':result.data.csrf};
 assert.equal((await f.request('/api/employee/session',{headers:auth})).status,200);
 assert.equal((await f.request('/api/employee/login',{method:'POST',body:{email:worker.employee.email,password:'test-only-employee-password'}})).status,401);
 const reset=await f.request('/api/admin/employees/'+worker.employee.id+'/invite',{method:'POST',headers:owner});assert.equal(reset.status,200);
 assert.equal((await f.request('/api/employee/session',{headers:auth})).status,401);
 assert.equal((await f.request('/api/employee/login',{method:'POST',body:{email:worker.employee.email,password:'changed-test-only-employee-password'}})).status,401);
});

test('employee cannot use the owner plan-edit operation through the employee endpoint',async t=>{
 const f=await fixture(t),owner=await f.login(),a=await addWorker(f,owner,1),b=await addWorker(f,owner,2),job=await addJob(f,owner,a.employee.id);
 const response=await f.request('/api/employee/jobs/'+job.id,{method:'PUT',headers:{...a.headers,'Idempotency-Key':randomUUID()},body:{version:job.version,employeeId:b.employee.id,title:'Unauthorized change',address:'Bad change',customer:'',contact:'',region:'Berlin',date:'2026-11-01',time:'12:00',plannedMinutes:15,instructions:'',checklist:[]}});
 assert.equal(response.status,404);const actual=(await f.request('/api/admin/jobs/'+job.id,{headers:owner})).data;assert.equal(actual.employee_id,a.employee.id);assert.equal(actual.version,job.version);
});

test('monthly payments count only explicit actual entries, preserve void history and freeze archive revisions',async t=>{
 const f=await fixture(t),owner=await f.login(),worker=await addWorker(f,owner),job=await addJob(f,owner,worker.employee.id,{date:'2026-10-25'});
 const before=await f.request('/api/admin/reports?month=2026-10',{headers:owner});assert.equal(before.status,200);assert.equal(before.data.summary.receivedCents,0);
 const key=randomUUID(),payment={jobId:job.id,kind:'payment',amountCents:12345,date:'2026-10-25',method:'bank',reference:'RE-TEST-1',note:'Test only'};
 const saved=await f.request('/api/admin/payments',{method:'POST',headers:{...owner,'Idempotency-Key':key},body:payment});assert.equal(saved.status,201);
 assert.equal((await f.request('/api/admin/payments',{method:'POST',headers:{...owner,'Idempotency-Key':key},body:payment})).status,200);
 assert.equal((await f.request('/api/admin/payments',{method:'POST',headers:{...owner,'Idempotency-Key':key},body:{...payment,amountCents:100}})).status,409);
 const refunds=await f.request('/api/admin/payments',{method:'POST',headers:{...owner,'Idempotency-Key':randomUUID()},body:{...payment,kind:'refund',amountCents:2345}});assert.equal(refunds.status,201);
 const report=(await f.request('/api/admin/reports?month=2026-10',{headers:owner})).data;assert.equal(report.summary.receivedCents,12345);assert.equal(report.summary.refundedCents,2345);assert.equal(report.summary.netReceivedCents,10000);assert.equal(report.payments.length,2);
 const archiveKey=randomUUID();const snapshot=await f.request('/api/admin/reports/archives',{method:'POST',headers:{...owner,'Idempotency-Key':archiveKey},body:{month:'2026-10'}});assert.equal(snapshot.status,201);assert.equal(snapshot.data.revision,1);
 assert.equal((await f.request('/api/admin/reports/archives',{method:'POST',headers:{...owner,'Idempotency-Key':archiveKey},body:{month:'2026-10'}})).data.id,snapshot.data.id);
 assert.equal((await f.request(`/api/admin/payments/${saved.data.id}/void`,{method:'POST',headers:owner,body:{reason:'Incorrect example entry'}})).status,200);
 const current=(await f.request('/api/admin/reports?month=2026-10',{headers:owner})).data;assert.equal(current.summary.receivedCents,0);assert.equal(current.summary.voidedPayments,1);assert.equal(current.payments.length,2);
 const frozen=(await f.request('/api/admin/reports/archives/'+snapshot.data.id,{headers:owner})).data;assert.equal(frozen.report.summary.netReceivedCents,10000);
 const {createHash}=await import('node:crypto');assert.equal(frozen.sha256,createHash('sha256').update(JSON.stringify(frozen.report)).digest('hex'));
 const second=await f.request('/api/admin/reports/archives',{method:'POST',headers:{...owner,'Idempotency-Key':randomUUID()},body:{month:'2026-10'}});assert.equal(second.data.revision,2);
 assert.equal((await f.request('/api/admin/reports?month=2026-10',{headers:worker.headers})).status,401);
 assert.equal((await f.request('/api/admin/payments',{method:'POST',headers:{...worker.headers,'Idempotency-Key':randomUUID()},body:payment})).status,401);
 for(const invalid of [{amountCents:0},{amountCents:1.5},{date:'2026-02-30'},{date:'2027-01-01'},{method:'unsupported'}])assert.equal((await f.request('/api/admin/payments',{method:'POST',headers:{...owner,'Idempotency-Key':randomUUID()},body:{...payment,...invalid}})).status,400);
});

test('month periods use Berlin DST, split cross-month work and apply corrections by selected work date',async t=>{
 const {monthBounds}=await import('../lib/reporting.mjs');
 assert.equal((monthBounds('2026-03').end-monthBounds('2026-03').start)/3600000,743);
 assert.equal((monthBounds('2026-10').end-monthBounds('2026-10').start)/3600000,745);
 const f=await fixture(t),owner=await f.login(),worker=await addWorker(f,owner),job=await addJob(f,owner,worker.employee.id,{date:'2026-09-30'});
 f.app.store.db.prepare('INSERT INTO work_intervals VALUES(?,?,?,?,?)').run(randomUUID(),job.id,worker.employee.id,Date.parse('2026-09-30T21:30:00Z'),Date.parse('2026-09-30T22:30:00Z'));
 f.app.store.db.prepare('INSERT INTO time_corrections(id,job_id,minutes,reason,created_at,effective_date) VALUES(?,?,?,?,?,?)').run(randomUUID(),job.id,10,'Test correction',Date.parse('2026-10-20T10:00:00Z'),'2026-09-30');
 const september=(await f.request('/api/admin/reports?month=2026-09',{headers:owner})).data,october=(await f.request('/api/admin/reports?month=2026-10',{headers:owner})).data;
 assert.equal(september.summary.loggedMilliseconds,1800000);assert.equal(october.summary.loggedMilliseconds,1800000);assert.equal(september.summary.correctionMinutes,10);assert.equal(october.summary.correctionMinutes,0);
 assert.equal(september.employees[0].correctedMilliseconds,2400000);
 assert.equal((await f.request('/api/admin/reports?month=2026-13',{headers:owner})).status,400);
});

test('CSV exports neutralize spreadsheet formulas and euro parsing avoids float rounding',async()=>{
 const {csvReport,parseEuro}=await import('../public/report-export.js');assert.equal(parseEuro('123,45'),12345);assert.equal(parseEuro('0.01'),1);assert.throws(()=>parseEuro('1.005'));assert.throws(()=>parseEuro('-5'));assert.throws(()=>parseEuro('1e5'));
 const csv=csvReport({jobs:[{title:'=HYPERLINK("bad")',employeeName:' +CMD',scheduled_date:'2026-10-25',scheduled_time:'09:00',region:'Test',state:'closed',report:'line1\nline2'}]},'jobs');assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes("' +CMD"));assert.ok(csv.includes('line1\nline2'));
});
