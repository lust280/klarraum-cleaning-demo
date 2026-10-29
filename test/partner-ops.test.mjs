import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';

const password='test-only-partner-ops-password';
const passwordHash=await hashPassword(password);

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'klarraum-ops-'));
 let clock=Date.UTC(2026,9,25,10);
 const notifications=[];
 const config={...loadConfig({DATA_DIR:dir}),passwordHash,live:true,
  business:{name:'Fresh Clean',owner:'Test owner',address:'Berlin',email:'owner@example.invalid',postcodes:['10']},
  mail:{key:'test-only',from:'desk@example.invalid',to:'owner@example.invalid'}};
 const {server,app}=createServerApp(config,{now:()=>clock,fetcher:async(url,init)=>{notifications.push({url,...init});return {ok:true};}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 config.origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await app.drain();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 async function request(path,{method='GET',body,headers={}}={}){
  const response=await fetch(config.origin+path,{method,headers:{Origin:config.origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data,headers:response.headers};
 }
 async function token(){const response=await request('/api/form-token');clock+=2100;return response.data.token;}
 async function submit(changes={}){
  return request('/api/inquiries',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:{name:'Anna Weber',email:'anna@example.invalid',phone:'+4915123456789',postcode:'10115',address:'Lindenstraße 12, Berlin',date:'2026-11-02',preferredTime:'09:00',message:'Key under the mat',service:'home',area:70,frequency:'once',windows:false,privacy:true,website:'',token:await token(),...changes}});
 }
 async function login(){const response=await request('/api/admin/login',{method:'POST',body:{password}});assert.equal(response.status,200);return {Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':response.data.csrf};}
 const post=(path,body,headers,method='POST')=>request(path,{method,body,headers:{...headers,'Idempotency-Key':randomUUID()}});
 return {request,submit,login,post,app,config,notifications,advance:ms=>{clock+=ms;}};
}
async function worker(f,owner,email){
 const invitation=await f.post('/api/admin/employees',{name:email.startsWith('mia')?'Mia Klein':'Anna Koch',email,region:'Berlin'},owner);
 assert.equal(invitation.status,201);
 const token=new URL(invitation.data.inviteUrl).hash.slice('#invite='.length);
 const accepted=await f.request('/api/employee/accept-invite',{method:'POST',body:{token,password}});
 assert.equal(accepted.status,200);
 return {id:invitation.data.employee.id,headers:{Cookie:accepted.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':accepted.data.csrf}};
}
function noDistance(value){
 const json=JSON.stringify(value);
 assert.equal(json.includes('"km"'),false);
 assert.equal(json.includes('distance'),false);
 assert.equal(json.includes('latitude'),false);
 assert.equal(json.includes('longitude'),false);
 assert.equal(json.includes('gps'),false);
 for(const worker of value.workers||[])assert.deepEqual(Object.keys(worker).sort(),['availability','id','name']);
}

test('a client request appears in Jobs as New, then follows the status chain with one worker',async t=>{
 const f=await fixture(t);
 const saved=await f.submit();assert.equal(saved.status,201);assert.equal(saved.data.price,126);
 const owner=await f.login();
 const listed=await f.request('/api/admin/ops/jobs?range=today&status=new',{headers:owner});
 assert.equal(listed.data.total,1);
 const item=listed.data.items[0];
 assert.equal(item.status,'new');assert.equal(item.areaM2,70);assert.equal(item.priceCents,12600);assert.equal(item.currency,'EUR');
 assert.equal(item.address,'Lindenstraße 12, Berlin');assert.equal(item.time,'09:00');assert.equal(item.worker,null);
 noDistance(item);
 const today=await f.request('/api/admin/ops/today',{headers:owner});
 assert.equal(today.data.counts.newRequests,1);assert.equal(today.data.attention[0].id,item.id);
 const early=await f.post(`/api/admin/ops/jobs/${item.id}/assign`,{employeeId:randomUUID(),version:item.version,employeeIds:[randomUUID()]},owner);
 assert.equal(early.status,400);
 const blocked=await f.post(`/api/admin/ops/jobs/${item.id}/assign`,{employeeId:randomUUID(),version:item.version},owner);
 assert.equal(blocked.status,409);
 const accepted=await f.post(`/api/admin/ops/jobs/${item.id}/accept`,{version:item.version},owner);
 assert.equal(accepted.status,200);assert.equal(accepted.data.status,'accepted');
 const first=await worker(f,owner,'anna.koch@example.invalid'),second=await worker(f,owner,'mia.klein@example.invalid');
 const slot=await f.request(`/api/admin/ops/availability?date=2026-11-02&time=09:00&minutes=120`,{headers:owner});
 assert.equal(slot.data.workers.every(person=>person.availability==='free'),true);noDistance(slot.data);
 const assigned=await f.post(`/api/admin/ops/jobs/${item.id}/assign`,{employeeId:first.id,version:accepted.data.version},owner);
 assert.equal(assigned.status,200);assert.equal(assigned.data.status,'assigned');assert.equal(assigned.data.worker.id,first.id);assert.equal(assigned.data.worker.availability,'free');
 const mine=await f.request('/api/employee/jobs',{headers:first.headers});
 assert.equal(mine.data.items.some(job=>job.id===assigned.data.jobId),true);
 const replaced=await f.post(`/api/admin/ops/jobs/${item.id}/assign`,{employeeId:second.id,version:assigned.data.version},owner);
 assert.equal(replaced.status,200);assert.equal(replaced.data.worker.id,second.id);
 assert.equal((await f.request('/api/employee/jobs',{headers:first.headers})).data.items.some(job=>job.id===assigned.data.jobId),false);
 assert.equal((await f.request('/api/employee/jobs',{headers:second.headers})).data.items.some(job=>job.id===assigned.data.jobId),true);
 const overlap=await f.post('/api/admin/ops/jobs',{service:'office',areaM2:40,date:'2026-11-02',time:'09:00',address:'Elmstraße 4, Berlin',customer:'Office client',phone:'+491511110000',notes:'',employeeId:null},owner);
 assert.equal(overlap.status,201);assert.equal(overlap.data.status,'accepted');assert.equal(overlap.data.priceCents,40*150);
 const busy=overlap.data.workers.find(person=>person.id===second.id);
 assert.equal(busy.availability,'busy');assert.equal(busy.availability==='free',false);noDistance(overlap.data);
 const currentJob=(await f.request('/api/employee/jobs/'+replaced.data.jobId,{headers:second.headers})).data;
 const started=await f.request(`/api/employee/jobs/${replaced.data.jobId}/actions`,{method:'POST',headers:{...second.headers,'Idempotency-Key':randomUUID()},body:{action:'start',version:currentJob.version}});
 assert.equal(started.status,200);
 const progress=await f.request('/api/admin/ops/jobs/'+item.id,{headers:owner});
 assert.equal(progress.data.status,'in_progress');
 const finished=await f.request(`/api/employee/jobs/${replaced.data.jobId}/actions`,{method:'POST',headers:{...second.headers,'Idempotency-Key':randomUUID()},body:{action:'finish',version:started.data.version,done:[true],report:'Balcony skipped.',onsiteMethod:'cash'}});
 assert.equal(finished.status,200);
 const done=await f.request('/api/admin/ops/jobs/'+item.id,{headers:owner});
 assert.equal(done.data.status,'done');assert.equal(done.data.report.onsiteMethod,'cash');assert.equal(done.data.report.note,'Balcony skipped.');
 const priced=await f.request('/api/admin/settings',{method:'PUT',headers:owner,body:{rates:{home:2.2,office:1.5,deep:3.5},discounts:{once:1,weekly:0.9,fortnightly:0.95},minimum:60,windows:40}});
 assert.equal(priced.status,200);
 const manual=await f.post('/api/admin/ops/jobs',{service:'home',areaM2:70,date:'2026-11-03',time:'14:00',address:'Birkenweg 3, Berlin',customer:'Lena Berg',phone:'+491519998887',notes:'',employeeId:null},owner);
 assert.equal(manual.status,201);assert.equal(manual.data.priceCents,15400);assert.equal(manual.data.rateCents,220);
});

test('partner Confirm accepts a new request through the ops status chain',async t=>{
 const f=await fixture(t);
 const saved=await f.submit();
 assert.equal(saved.status,201);
 const owner=await f.login();
 const item=(await f.request('/api/admin/ops/jobs?status=new',{headers:owner})).data.items[0];
 const google=await f.request('/api/partner/auth/google',{method:'POST',body:{}});
 assert.equal(google.status,200);
 const headers={Cookie:google.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':google.data.workspace.csrf};
 const confirmed=await f.post('/api/partner/jobs/confirm',{id:item.id},headers);
 assert.equal(confirmed.status,200);
 assert.equal(confirmed.data.job.id,item.id);
 assert.equal(confirmed.data.job.status,'accepted');
 assert.equal(confirmed.data.job.step,1);
 const sarah=confirmed.data.job.workers.find(worker=>worker.name==='Sarah Jenkins');
 assert.ok(sarah);
 const assigned=await f.post(`/api/partner/jobs/${item.id}/assign`,{employeeId:sarah.id,version:confirmed.data.job.version},headers);
 assert.equal(assigned.status,200);
 assert.equal(assigned.data.job.status,'assigned');
 assert.equal(assigned.data.job.worker.id,sarah.id);
 const ops=await f.request('/api/admin/ops/jobs/'+item.id,{headers:owner});
 assert.equal(ops.data.status,'assigned');
 assert.equal(ops.data.worker.name,'Sarah Jenkins');
 assert.equal(ops.data.jobId,assigned.data.job.jobId);
});

test('partner Start and Done move the live status map',async t=>{
 const f=await fixture(t),owner=await f.login(),person=await worker(f,owner,'anna.koch@example.invalid');
 const created=await f.post('/api/admin/ops/jobs',{service:'home',areaM2:50,date:'2026-11-08',time:'09:00',address:'Gartenstraße 5, Berlin',customer:'Nora Feld',phone:'+491510001112',notes:'',employeeId:person.id},owner);
 assert.equal(created.status,201);
 assert.deepEqual(created.data.chain,['new','accepted','assigned','in_progress','done']);
 assert.equal(created.data.status,'assigned');assert.equal(created.data.step,2);
 assert.equal((await f.post(`/api/admin/ops/jobs/${created.data.id}/start`,{version:created.data.version-1},owner)).status,409);
 assert.equal((await f.post(`/api/admin/ops/jobs/${created.data.id}/done`,{version:created.data.version},owner)).status,409);
 const started=await f.post(`/api/admin/ops/jobs/${created.data.id}/start`,{version:created.data.version},owner);
 assert.equal(started.status,200);assert.equal(started.data.status,'in_progress');assert.equal(started.data.step,3);
 const workerView=await f.request('/api/employee/jobs/'+created.data.jobId,{headers:person.headers});
 assert.equal(workerView.data.state,'working');
 const done=await f.post(`/api/admin/ops/jobs/${created.data.id}/done`,{version:started.data.version},owner);
 assert.equal(done.status,200);assert.equal(done.data.status,'done');assert.equal(done.data.step,4);assert.equal(done.data.report.note,'Marked done.');
 const listed=await f.request('/api/admin/ops/jobs?status=done',{headers:owner});
 assert.equal(listed.data.items.some(item=>item.id===created.data.id&&item.status==='done'),true);
});

test('decline keeps a single path, cancel removes the job from the worker, and photos stop at 6',async t=>{
 const f=await fixture(t),owner=await f.login();
 const saved=await f.submit({date:'2026-11-04',preferredTime:'11:00',email:'lena@example.invalid'});
 assert.equal(saved.status,201);
 const job=(await f.request('/api/admin/ops/jobs?status=new',{headers:owner})).data.items[0];
 const declined=await f.post(`/api/admin/ops/jobs/${job.id}/decline`,{version:job.version,reason:'outside_area',message:'We do not cover that street yet.'},owner);
 assert.equal(declined.status,200);assert.equal(declined.data.status,'declined');assert.equal(declined.data.emailQueued,true);
 await f.app.tick();
 const mail=f.notifications.map(item=>JSON.parse(item.body)).find(item=>item.to?.[0]==='lena@example.invalid'&&/No charge/.test(item.text||''));
 assert.ok(mail);assert.match(mail.text,/No charge/);assert.equal(mail.text.includes('checkout.stripe.com'),false);
 const person=await worker(f,owner,'anna.koch@example.invalid');
 const created=await f.post('/api/admin/ops/jobs',{service:'deep',areaM2:60,date:'2026-11-05',time:'08:00',address:'Hauptstraße 8, Berlin',customer:'Paul Sommer',phone:'+491517770000',notes:'',employeeId:person.id},owner);
 assert.equal(created.status,201);assert.equal(created.data.status,'assigned');assert.equal(created.data.worker.id,person.id);
 const cancelled=await f.post(`/api/admin/ops/jobs/${created.data.id}/cancel`,{version:created.data.version,notifyCustomer:false},owner);
 assert.equal(cancelled.status,200);assert.equal(cancelled.data.status,'cancelled');
 assert.equal((await f.request('/api/employee/jobs',{headers:person.headers})).data.total,0);
 const photoJob=await f.post('/api/admin/ops/jobs',{service:'home',areaM2:30,date:'2026-11-06',time:'10:00',address:'Parkweg 2, Berlin',customer:'Eva Lind',phone:'',notes:'',employeeId:person.id},owner);
 assert.equal(photoJob.status,201);
 const started=await f.request(`/api/employee/jobs/${photoJob.data.jobId}/actions`,{method:'POST',headers:{...person.headers,'Idempotency-Key':randomUUID()},body:{action:'start',version:1}});
 assert.equal(started.status,200);
 const sharp=(await import('sharp')).default;
 const image=await sharp({create:{width:40,height:40,channels:3,background:'#dddddd'}}).png().toBuffer();
 const upload=()=>fetch(f.config.origin+`/api/employee/jobs/${photoJob.data.jobId}/photos`,{method:'POST',headers:{Origin:f.config.origin,...person.headers,'Content-Type':'image/png'},body:image});
 for(let index=0;index<6;index++)assert.equal((await upload()).status,201);
 const overflow=await upload();assert.equal(overflow.status,409);assert.match(await overflow.text(),/6/);
 const detail=await f.request('/api/admin/ops/jobs/'+photoJob.data.id,{headers:owner});
 assert.equal(detail.data.photos.length,6);assert.equal(detail.data.photoLimit,6);assert.equal(detail.data.status,'in_progress');
 const pages=await Promise.all(['public/ops.html','public/ops.js','public/ops.css'].map(file=>readFile(new URL('../'+file,import.meta.url),'utf8')));
 const source=pages.join('\n');
 assert.equal(source.includes('sqft'),false);
 assert.equal(source.includes('checkout.stripe.com'),false);
 assert.equal(source.includes('Main Street'),false);
 assert.equal(/\d(?:\.\d)?\s*km/.test(source),false);
});
