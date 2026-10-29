import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';
import {initialize} from '../scripts/setup.mjs';
import {berlinInstant,recurrenceDates} from '../lib/scheduling.mjs';
const password='test-only-planning-password',passwordHash=await hashPassword(password);
async function fixture(t,changes={}){
 const directory=await mkdtemp(join(tmpdir(),'klarraum-planning-'));let clock=Date.UTC(2026,9,25,10);const sent=[];let failMail=false;
 const config={...loadConfig({DATA_DIR:directory}),passwordHash,...changes};
 const {server,app}=createServerApp(config,{now:()=>clock,fetcher:async(url,options)=>{sent.push({url,...options});return {ok:!failMail};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));config.origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await app.drain();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
 async function request(path,{body,method=body?'POST':'GET',headers={}}={}){const r=await fetch(config.origin+path,{method,headers:{Origin:config.origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),headers:r.headers};}
 const login=await request('/api/admin/login',{body:{password}});const owner={Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.data.csrf};
 const post=(path,body,key=randomUUID(),method='POST')=>request('/api/admin/'+path,{body,method,headers:{...owner,'Idempotency-Key':key}});
 const get=path=>request('/api/admin/'+path,{headers:owner});
 async function worker(email='worker@example.invalid'){
  const invitation=await post('employees',{name:'Test worker',email,region:'Nürnberg'});assert.equal(invitation.status,201);
  const token=new URL(invitation.data.inviteUrl).hash.slice(8);const accepted=await request('/api/employee/accept-invite',{body:{token,password}});assert.equal(accepted.status,200);
  return {id:invitation.data.employee.id,headers:{Cookie:accepted.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':accepted.data.csrf}};
 }
 const job=employeeId=>({employeeId,title:'Test cleaning',address:'Example 1',customer:'Fictional customer',contact:'',region:'Nürnberg',date:'2026-10-26',time:'09:00',plannedMinutes:120,instructions:'Test only',checklist:['Floor'],inquiryId:null});
 return {directory,app,config,owner,get,post,request,worker,job,sent,setFailure:v=>{failMail=v;},advance:ms=>{clock+=ms;}};
}
test('calendar time conversion rejects DST gaps and ambiguities; monthly recurrence keeps anchor day',()=>{
 assert.equal(new Date(berlinInstant('2026-03-29','09:00')).toISOString(),'2026-03-29T07:00:00.000Z');
 assert.equal(new Date(berlinInstant('2026-10-25','09:00')).toISOString(),'2026-10-25T08:00:00.000Z');
 assert.throws(()=>berlinInstant('2026-03-29','02:30'));assert.throws(()=>berlinInstant('2026-10-25','02:30'));
 assert.deepEqual(recurrenceDates('2026-01-31','2026-04-30','monthly'),['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
 assert.deepEqual(recurrenceDates('2028-01-31','2028-03-31','monthly'),['2028-01-31','2028-02-29','2028-03-31']);
 assert.throws(()=>recurrenceDates('2026-01-01','2029-01-01','weekly'));assert.throws(()=>recurrenceDates('2026-02-30','2026-03-30','weekly'));
});
test('customer/property versioning and snapshots preserve job history; worker cannot access CRM',async t=>{
 const f=await fixture(t,{demoMode:true}),w=await f.worker();
 const key=randomUUID(),body={name:'Fictional client',email:'client@example.invalid',phone:'',notes:'Test',active:true};
 const customer=await f.post('customers',body,key);assert.equal(customer.status,201);assert.equal((await f.post('customers',body,key)).data.id,customer.data.id);
 assert.equal((await f.post('customers',{...body,email:'real@example.com'})).status,400);
 const p=await f.post('properties',{customerId:customer.data.id,name:'Fictional office',address:'Old example address',region:'Nürnberg',instructions:'Old instructions',active:true});assert.equal(p.status,201);
 const saved=await f.post('jobs',{...f.job(w.id),propertyId:p.data.id});assert.equal(saved.status,201);assert.equal(saved.data.address,'Old example address');assert.equal(saved.data.customer,'Fictional client');
 const change={...p.data,customerId:customer.data.id,active:true,address:'New example address'};assert.equal((await f.post('properties/'+p.data.id,change,randomUUID(),'PUT')).status,200);assert.equal((await f.post('properties/'+p.data.id,change,randomUUID(),'PUT')).status,409);
 const old=await f.get('jobs/'+saved.data.id);assert.equal(old.data.address,'Old example address');assert.equal(old.data.instructions,'Old instructions');
 const next=await f.post('jobs',{...f.job(w.id),propertyId:p.data.id,date:'2026-10-27'});assert.equal(next.data.address,'New example address');
 assert.equal((await f.get('properties/'+p.data.id+'/history')).data.total,2);
 assert.equal((await f.request('/api/admin/customers',{headers:w.headers})).status,401);
 assert.equal((await f.request('/api/admin/calendar?from=2026-10-01&to=2026-10-31',{headers:w.headers})).status,401);
 assert.equal((await f.request('/api/admin/customers',{body,headers:{Cookie:f.owner.Cookie}})).status,403);
});
test('finite series deduplicates, reports overlaps, moves one occurrence and preserves started work on cancellation',async t=>{
 const f=await fixture(t),w=await f.worker(),input={...f.job(w.id),frequency:'weekly',endDate:'2026-11-16'},key=randomUUID();
 const response=await f.post('series',input,key);assert.equal(response.status,201);assert.equal(response.data.items.length,4);
 assert.equal((await f.post('series',input,key)).data.id,response.data.id);assert.equal((await f.get('jobs')).data.total,4);
 const first=response.data.items[0],second=response.data.items[1];
 const overlap=await f.post('jobs',{...f.job(w.id),time:'10:00'});assert.equal(overlap.data.scheduleWarnings[0].id,first.id);
 const adjacent=await f.post('jobs',{...f.job(w.id),time:'12:00'});assert.equal(adjacent.data.scheduleWarnings.length,0);
 const edited=await f.post('jobs/'+second.id,{...f.job(w.id),date:'2026-11-03',version:second.version},randomUUID(),'PUT');assert.equal(edited.status,200);assert.equal((await f.get('jobs/'+first.id)).data.scheduled_date,'2026-10-26');
 const start=await f.request('/api/employee/jobs/'+first.id+'/actions',{body:{action:'start',version:1},headers:{...w.headers,'Idempotency-Key':randomUUID()}});assert.equal(start.status,200);
 const cancelKey=randomUUID(),cancel={from:'2026-10-25',reason:'Test series ending',version:1};
 const cancelled=await f.post('series/'+response.data.id+'/cancel-future',cancel,cancelKey);assert.equal(cancelled.status,200);assert.equal(cancelled.data.cancelled,3);
 assert.equal((await f.post('series/'+response.data.id+'/cancel-future',cancel,cancelKey)).data.cancelled,3);
 assert.equal((await f.get('jobs/'+first.id)).data.state,'working');assert.equal((await f.get('jobs/'+second.id)).data.state,'cancelled');
 const calendar=await f.get('calendar?from=2026-10-26&to=2026-11-16');assert.equal(calendar.status,200);assert.ok(calendar.data.items.find(j=>j.id===first.id).conflicts.length);
 assert.equal((await f.get('calendar?from=2026-01-01&to=2027-01-01')).status,400);
});
test('recurrence across a DST gap rolls back the entire series instead of silently moving time',async t=>{
 const f=await fixture(t),w=await f.worker();const result=await f.post('series',{...f.job(w.id),date:'2026-03-22',time:'02:30',frequency:'weekly',endDate:'2026-04-05'});assert.equal(result.status,400);assert.equal((await f.get('jobs')).data.total,0);assert.equal((await f.get('series')).data.total,0);
});
test('notifications are employee-scoped, retry with provider idempotency and omit customer data',async t=>{
 const f=await fixture(t,{employeeEmail:true,mail:{key:'test-only',from:'test@example.invalid',to:'owner@example.invalid'}}),a=await f.worker(),b=await f.worker('other@example.invalid');
 const job=await f.post('jobs',{...f.job(a.id),address:'Private example address'});await f.app.tick();assert.equal(f.sent.length,1);
 const message=JSON.parse(f.sent[0].body);assert.deepEqual(message.to,['worker@example.invalid']);assert.ok(!JSON.stringify(message).includes('Private example address'));assert.ok(!JSON.stringify(message).includes('Fictional customer'));
 const inbox=await f.request('/api/employee/notifications',{headers:a.headers});assert.equal(inbox.data.unread,1);assert.equal((await f.request('/api/employee/notifications',{headers:b.headers})).data.total,0);
 assert.equal((await f.request('/api/employee/notifications/'+inbox.data.items[0].id+'/read',{method:'POST',headers:b.headers})).status,404);
 f.setFailure(true);const second=await f.post('jobs',{...f.job(a.id),date:'2026-10-28'});await f.app.tick();assert.equal(f.sent.length,2);f.advance(61000);f.setFailure(false);await f.app.tick();assert.equal(f.sent.length,3);assert.equal(f.sent[1].headers['Idempotency-Key'],f.sent[2].headers['Idempotency-Key']);
 assert.equal((await f.get('system-status')).data.employeeEmailEnabled,true);
 f.advance(21*3600000);await f.app.tick();assert.equal(f.sent.length,4);assert.equal(JSON.parse(f.sent[3].body).subject,'Erinnerung an Ihren Einsatz');
});
test('demo never sends staff email; reassignment revokes access and suppresses pending old recipients',async t=>{
 const f=await fixture(t,{demoMode:true,employeeEmail:true,mail:{key:'test',from:'test@example.invalid',to:'owner@example.invalid'}}),a=await f.worker(),b=await f.worker('other@example.invalid');
 const saved=await f.post('jobs',f.job(a.id));const edited=await f.post('jobs/'+saved.data.id,{...f.job(b.id),version:1},randomUUID(),'PUT');assert.equal(edited.status,200);
 await f.app.tick();assert.equal(f.sent.length,0);assert.equal((await f.request('/api/employee/jobs/'+saved.data.id,{headers:a.headers})).status,404);
 const inbox=await f.request('/api/employee/notifications',{headers:b.headers});assert.equal(inbox.data.total,1);assert.equal(inbox.data.items[0].mail_status,'demo');
});
test('new installation creates private distinct secrets, refuses overwrite and releases exclude runtime data',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'klarraum-installer-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=await initialize({directory:dir,origin:'https://example.invalid',password});const first=await readFile(file,'utf8');assert.ok(!first.includes(password));assert.match(first,/ADMIN_PASSWORD_HASH=scrypt:/);assert.match(first,/ENABLE_INQUIRIES=false/);
 await assert.rejects(()=>initialize({directory:dir,origin:'https://example.invalid',password}),{code:'EEXIST'});assert.equal(await readFile(file,'utf8'),first);
 const other=join(dir,'other');await initialize({directory:other,origin:'https://example.invalid',password});assert.notEqual((await readFile(join(other,'.env.local'),'utf8')).match(/APP_SECRET=(.*)/)[1],first.match(/APP_SECRET=(.*)/)[1]);
 await assert.rejects(()=>initialize({directory:join(dir,'unsafe'),origin:'http://public.example',password}));
 const releaseDir=join(dir,'releases');execFileSync(process.execPath,['scripts/package.mjs'],{cwd:process.cwd(),env:{...process.env,RELEASE_DIR:releaseDir},stdio:'pipe'});
 const archive=(await readdir(releaseDir)).find(n=>n.endsWith('.tar.gz'));assert.ok(archive);const files=execFileSync('tar',['-tzf',join(releaseDir,archive)],{encoding:'utf8'}).split('\n');assert.ok(files.some(n=>n.endsWith('/lib/planning.mjs')));assert.ok(!files.some(n=>/\/data\/|\/node_modules\/|\/\.git\/|\/\.env\.local$|\.sqlite/.test(n)));
});
test('backup/restore and legacy schema migration preserve CRM, series, payments and both photo sets',async t=>{
 const f=await fixture(t),w=await f.worker();
 const c=await f.post('customers',{name:'Test customer',email:'',phone:'',notes:'',active:true});const p=await f.post('properties',{customerId:c.data.id,name:'Test object',address:'Example',region:'Nürnberg',instructions:'',active:true});
 const s=await f.post('series',{...f.job(w.id),propertyId:p.data.id,frequency:'weekly',endDate:'2026-11-02'});assert.equal(s.status,201);
 const payment=await f.post('payments',{jobId:s.data.items[0].id,kind:'payment',amountCents:5000,date:'2026-10-25',method:'cash',reference:'TEST',note:''});assert.equal(payment.status,201);
 // Include both kinds of photos in the actual restore command (synthetic bytes only).
 const publicId=randomUUID(),privateId=randomUUID();f.app.store.db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?)').run(publicId,'logo',1,1,4,Date.now());
 f.app.store.db.prepare('INSERT INTO job_photos(id,job_id,employee_id,width,height,size,created_at) VALUES(?,?,?,?,?,?,?)').run(privateId,s.data.items[0].id,w.id,1,1,4,Date.now());
 for(const [folder,id] of [['uploads',publicId],['job-photos',privateId]]){await mkdir(join(f.directory,folder),{recursive:true});await writeFile(join(f.directory,folder,id+'.webp'),'test');}
 execFileSync(process.execPath,['scripts/backup.mjs'],{env:{...process.env,DATA_DIR:f.directory},stdio:'pipe'});
 const backup=(await readdir(join(f.directory,'backups'))).find(n=>n.endsWith('.sqlite')),target=join(f.directory,'restored');
 execFileSync(process.execPath,['scripts/restore.mjs','--source',join(f.directory,'backups',backup),'--target',target],{stdio:'pipe'});
 assert.equal(await readFile(join(target,'uploads',publicId+'.webp'),'utf8'),'test');assert.equal(await readFile(join(target,'job-photos',privateId+'.webp'),'utf8'),'test');
 const config={...f.config,dbPath:join(target,'klarraum.sqlite')};const restored=createServerApp(config);assert.equal(restored.app.store.db.prepare('SELECT COUNT(*) AS n FROM job_series').get().n,1);assert.equal(restored.app.store.db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,1);assert.equal(restored.app.store.db.prepare('SELECT name FROM properties').get().name,'Test object');restored.app.close();
 assert.throws(()=>execFileSync(process.execPath,['scripts/restore.mjs','--source',join(f.directory,'backups',backup),'--target',target],{stdio:'pipe'}));
 const legacy=join(f.directory,'legacy');await mkdir(legacy);const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(legacy,'klarraum.sqlite'));db.exec("CREATE TABLE jobs(id TEXT PRIMARY KEY,inquiry_id TEXT,employee_id TEXT NOT NULL,title TEXT NOT NULL,address TEXT NOT NULL,customer TEXT NOT NULL,contact TEXT NOT NULL,region TEXT NOT NULL,scheduled_date TEXT NOT NULL,scheduled_time TEXT NOT NULL,planned_minutes INTEGER NOT NULL,instructions TEXT NOT NULL,checklist TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'assigned',report TEXT NOT NULL DEFAULT '',review_note TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL); INSERT INTO jobs VALUES('legacy-job',NULL,'legacy-worker','Old task','Old address','','','Nürnberg','2026-10-01','09:00',60,'','[]','closed','','',1,1);");db.close();
 const upgraded=createServerApp({...f.config,dbPath:join(legacy,'klarraum.sqlite')});assert.equal(upgraded.app.store.db.prepare("SELECT address,property_id FROM jobs WHERE id='legacy-job'").get().address,'Old address');upgraded.app.close();
});
test('customer appointment reminder waits until it is due and omits the street address',async t=>{
 const f=await fixture(t,{mail:{key:'test-only',from:'desk@example.invalid',to:'owner@example.invalid'}}),w=await f.worker();
 const created=await f.post('jobs',{...f.job(w.id),contact:'guest@example.invalid',address:'Hidden Lane 4',date:'2026-11-02',time:'09:00'});
 assert.equal(created.status,201);
 await f.app.tick();assert.equal(f.sent.length,0);
 f.advance(8*86400000);await f.app.tick();assert.equal(f.sent.length,1);
 const body=JSON.parse(f.sent[0].body);assert.deepEqual(body.to,['guest@example.invalid']);assert.equal(body.text.includes('Hidden Lane 4'),false);assert.match(body.text,/2026-11-02 09:00/);
});
test('worker records signature, tip and on-site payment, and can decline an assigned job',async t=>{
 const f=await fixture(t),w=await f.worker();
 const created=await f.post('jobs',f.job(w.id));assert.equal(created.status,201);
 const later=await f.post('jobs',{...f.job(w.id),date:'2026-10-27',time:'11:00',title:'Later visit'});assert.equal(later.status,201);
 const declined=await f.request('/api/employee/jobs/'+later.data.id+'/actions',{body:{action:'unavailable',version:later.data.version,reason:'Sick today'},headers:{...w.headers,'Idempotency-Key':randomUUID()}});
 assert.equal(declined.status,200);assert.equal(declined.data.state,'accepted');assert.equal(declined.data.review_note,'Sick today');assert.equal((await f.request('/api/employee/jobs/'+later.data.id,{headers:w.headers})).status,404);
 const started=await f.request('/api/employee/jobs/'+created.data.id+'/actions',{body:{action:'start',version:created.data.version},headers:{...w.headers,'Idempotency-Key':randomUUID()}});assert.equal(started.status,200);
 const still=await f.request('/api/employee/jobs/'+created.data.id+'/actions',{body:{action:'unavailable',version:started.data.version,reason:'Too late now'},headers:{...w.headers,'Idempotency-Key':randomUUID()}});assert.equal(still.status,409);
 const signature='data:image/png;base64,'+'A'.repeat(80);
 const finished=await f.request('/api/employee/jobs/'+created.data.id+'/actions',{body:{action:'finish',version:started.data.version,done:[true],report:'Done',signature,tipCents:1000,onsiteMethod:'cash'},headers:{...w.headers,'Idempotency-Key':randomUUID()}});
 assert.equal(finished.status,200);assert.equal(finished.data.state,'submitted');assert.equal(finished.data.tip_cents,1000);assert.equal(finished.data.onsite_method,'cash');assert.equal(finished.data.signature,signature);
 const extra=await f.post('jobs',{...f.job(w.id),date:'2026-10-28',time:'15:00',title:'Card visit'});
 const startedExtra=await f.request('/api/employee/jobs/'+extra.data.id+'/actions',{body:{action:'start',version:extra.data.version},headers:{...w.headers,'Idempotency-Key':randomUUID()}});
 const rejected=await f.request('/api/employee/jobs/'+extra.data.id+'/actions',{body:{action:'finish',version:startedExtra.data.version,done:[true],report:'Done',onsiteMethod:'stripe'},headers:{...w.headers,'Idempotency-Key':randomUUID()}});
 assert.equal(rejected.status,400);
});
