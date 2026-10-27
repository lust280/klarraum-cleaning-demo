import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDirector,directorConfig} from '../director.mjs';
import {hashPassword} from '../lib/security.mjs';
const password='director-test-password-only',passwordHash=await hashPassword(password);
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'klarraum-director-'));
 const deliveries=[],config={...directorConfig({DIRECTOR_PASSWORD_HASH:passwordHash,DIRECTOR_DATA_DIR:directory}),trialEmailSender:async message=>deliveries.push(message)};
 const d=createDirector(config);await new Promise(r=>d.server.listen(0,'127.0.0.1',r));
 const port=d.server.address().port;
 async function request(path,{host='director.localhost:3100',body,method=body?'POST':'GET',headers={}}={}){
  return new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{Host:host,Origin:'http://'+host,'Content-Type':'application/json',...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const raw=Buffer.concat(chunks),text=raw.toString();resolve({raw,status:res.statusCode,data:res.headers['content-type']?.includes('application/json')?JSON.parse(text):text,headers:res.headers});});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
 }
 t.after(async()=>{await d.close();await rm(directory,{recursive:true,force:true});});
 const login=await request('/api/director/login',{body:{password}});assert.equal(login.status,200);
 const auth={Cookie:login.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':login.data.csrf};
 const post=(path,body,method='POST')=>request('/api/director/'+path,{body,method,headers:auth});
 const get=path=>request('/api/director/'+path,{headers:auth});
 const create=async name=>{const r=await post('companies',{name,baseCents:7900,included:3,seatCents:500});assert.equal(r.status,201);return r.data;};
 const activate=async item=>{const u=new URL(item.inviteUrl);const r=await request('/api/owner-setup',{host:u.host,body:{token:new URLSearchParams(u.hash.slice(1)).get('token'),password}});assert.equal(r.status,200);return u.host;};
 const owner=async host=>{const r=await request('/api/admin/login',{host,body:{password}});assert.equal(r.status,200);return {Cookie:r.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':r.data.csrf};};
 return {d,directory,request,post,get,create,activate,owner,auth,deliveries};
}
test('director authentication is separate; CSRF, origin, host and path checks protect registry',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/api/director/companies')).status,401);
 assert.equal((await f.request('/api/director/companies',{body:{},headers:{Cookie:f.auth.Cookie}})).status,403);
 assert.equal((await f.request('/api/director/companies',{body:{},headers:{...f.auth,Origin:'http://evil.test'}})).status,403);
 assert.equal((await f.request('/api/director/companies',{host:'evil.test',headers:f.auth})).status,404);
 assert.equal((await f.post('companies',{name:'../escape',baseCents:-1,included:0,seatCents:0})).status,400);
 const list=await f.get('companies');assert.deepEqual(list.data.items,[]);
 assert.equal((await stat(join(f.directory,'director.sqlite'))).mode&0o777,0o600);
});
test('production platform configuration requires an HTTPS director and limits active company processes',()=>{
 const production=directorConfig({NODE_ENV:'production',DIRECTOR_ORIGIN:'https://platform.example.com',COMPANY_BASE_DOMAIN:'companies.example.com',DIRECTOR_PASSWORD_HASH:passwordHash,DIRECTOR_DATA_DIR:'/tmp/klarraum-production-config',MAX_COMPANY_PROCESSES:'5'});
 assert.equal(production.production,true);assert.equal(production.mountedDemo,false);assert.equal(production.maxRunning,5);
 assert.throws(()=>directorConfig({NODE_ENV:'production',DIRECTOR_ORIGIN:'http://platform.example.com',COMPANY_BASE_DOMAIN:'companies.example.com',DIRECTOR_PASSWORD_HASH:passwordHash}),/requires HTTPS/);
 assert.throws(()=>directorConfig({DIRECTOR_PASSWORD_HASH:passwordHash,MAX_COMPANY_PROCESSES:'21'}),/MAX_COMPANY_PROCESSES/);
});
test('public company applications require review before a separate 15-day trial company is created',async t=>{
 const f=await fixture(t),application={companyName:'North Star Cleaning',ownerName:'Sam Owner',email:'sam@example.test',phone:'+49 100',country:'Germany',language:'en',workers:8,planKey:'growth',note:'Need team planning.',consent:true};
 assert.equal((await f.request('/api/platform/applications',{body:{...application,email:'not-an-email'}})).status,400);
 const submitted=await f.request('/api/platform/applications',{body:application});assert.equal(submitted.status,201);assert.equal((await f.request('/api/director/applications')).status,401);
 let listed=await f.get('applications');assert.equal(listed.data.items.length,1);const item=listed.data.items[0];assert.equal(item.status,'new');assert.equal(item.email,application.email);
 const reviewing=await f.post('applications/'+item.id+'/status',{status:'reviewing',version:item.version},'PUT');assert.equal(reviewing.status,200);assert.equal(reviewing.data.status,'reviewing');
 const approved=await f.post('applications/'+item.id+'/approve',{name:'North Star Cleaning',version:reviewing.data.version});assert.equal(approved.status,201);assert.ok(approved.data.inviteUrl.includes('/owner-setup.html#token='));assert.equal(approved.data.application.foundingOffer,true);assert.equal(approved.data.company.payment,'trial');assert.equal(approved.data.company.planKey,'growth');assert.equal(approved.data.company.baseCents,14900);assert.equal(approved.data.company.included,12);assert.ok(approved.data.company.trialEndsAt>Date.now()+14*24*3600000);
 assert.equal((await f.post('applications/'+item.id+'/approve',{name:'North Star Cleaning',baseCents:0,included:0,seatCents:0,version:reviewing.data.version})).status,409);
 const host=await f.activate(approved.data),owner=await f.owner(host);assert.equal((await f.request('/api/director/applications',{headers:owner})).status,401);assert.equal((await f.request('/api/admin/session',{host,headers:owner})).status,200);
});
test('self-service trial creates no company before email confirmation and activates only once',async t=>{
 const f=await fixture(t),registration={companyName:'Instant Trial',ownerName:'Trial Owner',email:'trial@example.test',language:'en',planKey:'team',consent:true};
 assert.equal((await f.request('/api/platform/trials',{body:{...registration,email:'bad'}})).status,400);
 const requested=await f.request('/api/platform/trials',{body:registration});assert.equal(requested.status,202);assert.equal(f.deliveries.length,1);assert.match(f.deliveries[0].url,/trial-activate\.html#token=/);assert.equal((await f.get('companies')).data.items.length,0);
 const token=new URL(f.deliveries[0].url).hash.slice(7);assert.equal((await f.request('/api/platform/trials/activate',{body:{token,password:'short'}})).status,400);
 const activated=await f.request('/api/platform/trials/activate',{body:{token,password:'a safe trial owner password'}});assert.equal(activated.status,201);assert.equal(activated.data.company.payment,'trial');assert.equal(activated.data.company.planKey,'team');assert.equal(activated.data.company.baseCents,8900);assert.ok(activated.data.company.trialEndsAt>Date.now()+14*24*3600000);assert.equal(activated.data.foundingOffer,true);assert.equal((await f.request('/api/platform/trials/activate',{body:{token,password:'another safe owner password'}})).status,400);
 const host=new URL(activated.data.loginUrl).host,login=await f.request('/api/admin/login',{host,body:{password:'a safe trial owner password'}});assert.equal(login.status,200);const owner={Cookie:login.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':login.data.csrf};assert.equal((await f.request('/api/admin/session',{host,headers:owner})).status,200);const plan=await f.request('/api/platform-plan',{host,headers:owner});assert.equal(plan.status,200);assert.equal(plan.data.planKey,'team');assert.equal(plan.data.storageLimitBytes,50*1024**3);
 const company=(await f.get('companies')).data.items[0];assert.equal((await f.post('companies/'+company.id+'/trial/extend',{})).status,200);
});
test('two independent companies isolate owners, workers, activation links and director access',async t=>{
 const f=await fixture(t),a=await f.create('Alpha'),b=await f.create('Beta');
 assert.ok(!JSON.stringify(a.company).includes('secret'));assert.equal(a.company.estimatedCents,7900);
 const hostA=await f.activate(a),hostB=await f.activate(b);
 assert.equal((await f.request('/api/owner-setup',{host:hostA,body:{token:new URL(a.inviteUrl).hash.slice(7),password}})).status,400);
 const ownerA=await f.owner(hostA),ownerB=await f.owner(hostB);
 assert.equal((await f.request('/director.html',{host:hostA})).status,404);
 assert.equal((await f.request('/api/director/companies',{headers:ownerA})).status,401);
 assert.equal((await f.request('/api/admin/employees',{host:hostB,headers:ownerA})).status,401);
 assert.equal((await f.request('/api/admin/employees',{host:hostA,headers:f.auth})).status,401);
 for(let i=0;i<4;i++) {
  const r=await f.request('/api/admin/employees',{host:hostA,headers:ownerA,body:{name:'Worker '+i,email:`worker${i}@example.invalid`,region:'Demo'}});assert.equal(r.status,201);
  const token=new URL(r.data.inviteUrl).hash.slice(8);
  assert.equal((await f.request('/api/employee/accept-invite',{host:hostB,body:{token,password}})).status,400);
  assert.equal((await f.request('/api/employee/accept-invite',{host:hostA,body:{token,password}})).status,200);
 }
 assert.equal((await f.request('/api/admin/employees',{host:hostB,headers:ownerB})).data.total,0);
 let items=(await f.get('companies')).data.items;
 assert.equal(items.find(c=>c.id===a.company.id).workers.active,4);
 assert.equal(items.find(c=>c.id===a.company.id).estimatedCents,8400);
 assert.equal(items.find(c=>c.id===b.company.id).workers.active,0);
 const current=items.find(c=>c.id===a.company.id);
 const change={...current,status:'suspended',payment:'overdue'};
 assert.equal((await f.post('companies/'+current.id,change,'PUT')).status,200);
 assert.equal((await f.request('/api/admin/employees',{host:hostA,headers:ownerA})).status,423);
 assert.equal((await f.request('/api/admin/employees',{host:hostB,headers:ownerB})).status,200);
 assert.equal((await f.post('companies/'+current.id,change,'PUT')).status,409);
 const suspended=(await f.get('companies')).data.items.find(c=>c.id===current.id);
 assert.equal((await f.post('companies/'+current.id,{...suspended,status:'active'},'PUT')).status,200);
 const restored=await f.owner(hostA);
 assert.equal((await f.request('/api/admin/employees',{host:hostA,headers:restored})).data.total,4);
 const events=await f.get('companies/'+current.id+'/events');assert.ok(events.data.items.some(e=>e.action==='owner_activated'));
 assert.ok(!JSON.stringify(events.data).includes('password_hash'));
});
test('company owner and director exchange private support messages without cross-company access',async t=>{
 const f=await fixture(t),a=await f.create('Support Alpha'),b=await f.create('Support Beta');
 const hostA=await f.activate(a),hostB=await f.activate(b),ownerA=await f.owner(hostA),ownerB=await f.owner(hostB);
 assert.equal((await f.request('/api/platform-support',{host:hostA})).status,401);
 assert.equal((await f.request('/api/platform-support',{host:hostA,headers:{Cookie:ownerA.Cookie},body:{message:'Missing CSRF'}})).status,403);
 const sent=await f.request('/api/platform-support',{host:hostA,headers:ownerA,body:{message:'Please help with a fictional setup.'}});assert.equal(sent.status,201);assert.equal(sent.data.item.sender,'company');
 let company=(await f.get('companies')).data.items.find(item=>item.id===a.company.id);assert.equal(company.unreadSupport,1);
 const thread=await f.get('companies/'+a.company.id+'/support');assert.equal(thread.status,200);assert.deepEqual(thread.data.items.map(item=>item.sender),['company']);
 company=(await f.get('companies')).data.items.find(item=>item.id===a.company.id);assert.equal(company.unreadSupport,0);
 const reply=await f.post('companies/'+a.company.id+'/support',{message:'This is a fictional reply.'});assert.equal(reply.status,201);assert.equal(reply.data.item.sender,'director');
 const ownerThread=await f.request('/api/platform-support',{host:hostA,headers:ownerA});assert.equal(ownerThread.status,200);assert.equal(ownerThread.data.unread,1);assert.deepEqual(ownerThread.data.items.map(item=>item.sender),['company','director']);assert.ok(ownerThread.data.items[1].read_at);
 const afterRead=await f.request('/api/platform-support',{host:hostA,headers:ownerA});assert.equal(afterRead.data.unread,0);
 assert.equal((await f.request('/api/platform-support',{host:hostB,headers:ownerB})).data.items.length,0);
});
test('reissuing owner invitation invalidates previous link and cannot reset activated owner',async t=>{
 const f=await fixture(t),item=await f.create('Invitation test');
 const replacement=await f.post('companies/'+item.company.id+'/invite',{});assert.equal(replacement.status,200);
 const u=new URL(item.inviteUrl);
 assert.equal((await f.request('/api/owner-setup',{host:u.host,body:{token:new URLSearchParams(u.hash.slice(1)).get('token'),password}})).status,400);
 await f.activate({inviteUrl:replacement.data.inviteUrl});
 assert.equal((await f.post('companies/'+item.company.id+'/invite',{})).status,409);
});
test('seat estimate separates invited and disabled employees and uses integer cents',async t=>{
 const f=await fixture(t),item=await f.create('Seat counting');const host=await f.activate(item),owner=await f.owner(host);
 const invited=await f.request('/api/admin/employees',{host,headers:owner,body:{name:'Invited only',email:'invited@example.invalid',region:'Demo'}});assert.equal(invited.status,201);
 let company=(await f.get('companies')).data.items[0];assert.deepEqual(company.workers,{active:0,invited:1,disabled:0});assert.equal(company.estimatedCents,7900);
 const input={name:'Invited only',region:'Demo',active:false};
 assert.equal((await f.request('/api/admin/employees/'+invited.data.employee.id,{host,headers:owner,method:'PATCH',body:input})).status,200);
 company=(await f.get('companies')).data.items[0];assert.deepEqual(company.workers,{active:0,invited:0,disabled:1});
 assert.equal((await f.post('companies/'+company.id,{...company,baseCents:7900.5},'PUT')).status,400);
 assert.equal((await f.post('logout',{})).status,200);
 assert.equal((await f.get('companies')).status,401);
});
test('mounted free demo serves a live director and two path-scoped companies without sharing owner sessions',async t=>{
 const {createServerApp}=await import('../server.mjs');const {loadConfig}=await import('../lib/config.mjs');
 const directory=await mkdtemp(join(tmpdir(),'klarraum-mounted-test-'));
 const config={...loadConfig({DATA_DIR:directory,DEMO_ONLY:'true'}),passwordHash};const hosted=createServerApp(config);
 await new Promise(r=>hosted.server.listen(0,'127.0.0.1',r));config.origin='http://127.0.0.1:'+hosted.server.address().port;
 t.after(async()=>{if(hosted.director)await hosted.director.close();await new Promise(r=>hosted.server.close(r));await rm(directory,{recursive:true,force:true});});
 async function request(path,{body,headers={},method=body?'POST':'GET'}={}){const r=await fetch(config.origin+path,{method,headers:{Origin:config.origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text,cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};}
 assert.equal((await request('/director.html')).status,200);assert.match((await request('/for-companies.html')).data,/Start your 15-day trial/);assert.equal((await request('/platform.js')).status,200);assert.equal((await request('/trial-activate.html')).status,200);assert.equal((await request('/platform-privacy.html')).status,200);assert.equal((await request('/api/platform/applications',{body:{companyName:'Fictional Demo',ownerName:'Test Owner',email:'owner@example.invalid',phone:'',country:'',language:'en',workers:2,note:'',consent:true}})).status,201);assert.equal((await request('/api/platform/trials',{body:{companyName:'Fictional Trial',ownerName:'Test Owner',email:'owner@example.invalid',language:'en',consent:true}})).status,202);assert.equal((await request('/api/platform/trials',{body:{companyName:'Real address blocked',ownerName:'Test Owner',email:'owner@example.com',language:'en',consent:true}})).status,400);assert.equal((await request('/api/director/companies')).status,401);
 const login=await request('/api/director/login',{body:{password}});assert.equal(login.status,200);const director={Cookie:login.cookie,'X-CSRF-Token':login.data.csrf};const companies=[];
 for(const name of ['Mounted A','Mounted B']){
  const created=await request('/api/director/companies',{body:{name,baseCents:7900,included:3,seatCents:500},headers:director});assert.equal(created.status,201);
  const u=new URL(created.data.inviteUrl),base='/companies/'+created.data.company.id+'/';assert.ok(u.pathname.startsWith(base));
  assert.equal((await request(base+'api/owner-setup',{body:{token:new URLSearchParams(u.hash.slice(1)).get('token'),password}})).status,200);
  const owner=await request(base+'api/admin/login',{body:{password}});assert.equal(owner.status,200);assert.ok(owner.headers.get('set-cookie').includes('Path='+base));
  assert.equal((await request(base+'api/config')).data.site.company.name,name);
  assert.equal((await request(base+'api/admin/customers',{headers:{Cookie:owner.cookie}})).status,200);
  companies.push({base,cookie:owner.cookie});
 }
 assert.equal((await request(companies[1].base+'api/admin/employees',{headers:{Cookie:companies[0].cookie}})).status,401);
 assert.equal((await request('/api/admin/session',{headers:{Cookie:companies[0].cookie}})).status,401);
 assert.equal((await request('/api/director/companies',{headers:{Cookie:companies[0].cookie}})).status,401);
 assert.equal((await request('/api/director/companies',{headers:director})).data.items.length,2);
});
test('finance endpoints require director role, preserve snapshot export and do not infer revenue from paid flags',async t=>{
 const f=await fixture(t),company=await f.create('Finance test');
 assert.equal((await f.request('/api/director/finance/report?month=2026-10')).status,401);
 assert.equal((await f.get('finance/report?month=2026-10')).data.incomeCents,0);
 const current=(await f.get('companies')).data.items[0];await f.post('companies/'+current.id,{...current,payment:'paid'},'PUT');
 assert.equal((await f.get('finance/report?month=2026-10')).data.incomeCents,0);
 const entry={type:'expense',category:'hosting',amountCents:2900,date:'2026-10-26',companyId:null,note:'Fictional test expense'};
 assert.equal((await f.request('/api/director/finance/entries',{body:entry,headers:{Cookie:f.auth.Cookie}})).status,403);
 const headers={...f.auth,'Idempotency-Key':randomUUID()};
 assert.equal((await f.request('/api/director/finance/entries',{body:entry,headers})).status,201);
 assert.equal((await f.request('/api/director/finance/entries',{body:entry,headers})).status,201);
 const saved=await f.post('finance/snapshots',{month:'2026-10'});assert.equal(saved.status,201);assert.equal(saved.data.expenseCents,2900);
 const csv=await f.get('finance/snapshots/'+saved.data.id+'?format=csv');assert.equal(csv.status,200);assert.ok(csv.data.includes('Fictional test expense'));
 const host=await f.activate(company),owner=await f.owner(host);assert.equal((await f.request('/api/director/finance/report?month=2026-10',{headers:owner})).status,401);
});
test('director can download an encrypted consistent backup while company owners cannot; original company resumes',async t=>{
 const {writeFile}=await import('node:fs/promises');const {inspectPlatformBackup,restorePlatformBackup}=await import('../lib/platform-backup.mjs');
 const f=await fixture(t),company=await f.create('Backup company'),host=await f.activate(company),owner=await f.owner(host);
 const backupPassword='test-backup-download-password';
 assert.equal((await f.request('/api/director/backups/status',{headers:owner})).status,401);
 assert.equal((await f.request('/api/director/backups/download',{body:{password:backupPassword},headers:{Cookie:f.auth.Cookie}})).status,403);
 assert.equal((await f.get('backups/status')).data.automatic,false);
 const download=await f.post('backups/download',{password:backupPassword});assert.equal(download.status,200);assert.equal(download.raw.subarray(0,8).toString(),'KLRPLAT1');
 const path=join(f.directory,'download.klrb');await writeFile(path,download.raw);const checked=await inspectPlatformBackup({source:path,password:backupPassword});assert.equal(checked.companies,1);
 const restored=await restorePlatformBackup({source:path,password:backupPassword,target:join(f.directory,'recovery')});assert.equal(restored.sessionsRevoked,true);
 assert.equal((await f.request('/api/admin/employees',{host,headers:owner})).status,200);assert.equal((await f.get('backups/status')).data.lastPrepared.companies,1);assert.equal(f.d.maintenance,false);
});
test('graceful hosted shutdown releases the platform marker and allows restart on persistent storage',async t=>{
 const {fork}=await import('node:child_process');const {once}=await import('node:events');const {access}=await import('node:fs/promises');
 const dir=await mkdtemp(join(tmpdir(),'platform-restart-'));let child;
 t.after(async()=>{if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await rm(dir,{recursive:true,force:true});});
 for(let i=0;i<2;i++){
  child=fork(new URL('../server.mjs',import.meta.url),[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,DATA_DIR:dir,DEMO_ONLY:'true',ADMIN_PASSWORD_HASH:passwordHash,APP_ORIGIN:'http://director.localhost:3100',PORT:'0'}});
  const [message]=await once(child,'message');
  const status=await new Promise((resolve,reject)=>{const r=httpRequest({hostname:'127.0.0.1',port:message.port,path:'/director.html',headers:{Host:'director.localhost:3100'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end();});assert.equal(status,200);
  await access(join(dir,'director','.platform-running'));
  const exited=once(child,'exit');child.kill('SIGTERM');await exited;
  await assert.rejects(access(join(dir,'director','.platform-running')));
 }
});
