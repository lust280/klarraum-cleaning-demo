import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';

const password='test-only-password-which-is-not-used-in-production';
const passwordHash=await hashPassword(password);
async function fixture(t,options={}){
 const dir=await mkdtemp(join(tmpdir(),'klarraum-worker-'));
 let clock=Date.UTC(2026,9,25,10);
 const notifications=[];
 const config={...loadConfig({DATA_DIR:dir}),passwordHash,live:true,demoMode:true,
  business:{name:'Fresh Clean',owner:'Test owner',address:'Berlin',email:'info@freshandclean.example',phone:'+49 30 123456',postcodes:['10']},
  mail:{key:'test-only',from:'desk@example.invalid',to:'owner@example.invalid'},...options.config};
 const {server,app}=createServerApp(config,{now:()=>clock,fetcher:async(url,init)=>{notifications.push({url,...init});return {ok:true};}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 config.origin=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await app.drain();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 async function request(path,{method='GET',body,headers={}}={}){
  const response=await fetch(config.origin+path,{method,headers:{Origin:config.origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data,headers:response.headers};
 }
 async function login(){const response=await request('/api/admin/login',{method:'POST',body:{password}});assert.equal(response.status,200);return {Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':response.data.csrf};}
 return {request,login,app,config,notifications,advance:ms=>{clock+=ms;}};
}
function tokenFrom(url){return new URL(url).hash.slice(8);}
async function addWorker(f,owner,index,extra={}){
 const created=await f.request('/api/admin/employees',{method:'POST',headers:owner,body:{name:extra.name||'Anna Keller',email:extra.email||`worker${index}@example.invalid`,region:extra.region||'Berlin Mitte',phone:extra.phone}});
 assert.equal(created.status,201);
 return {employee:created.data.employee,token:tokenFrom(created.data.inviteUrl),invite:created.data};
}
async function accept(f,worker){
 const accepted=await f.request('/api/employee/accept-invite',{method:'POST',body:{token:worker.token,password:'test-only-employee-password'}});
 assert.equal(accepted.status,200);
 return {Cookie:accepted.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':accepted.data.csrf};
}
async function addJob(f,owner,employeeId,changes={}){
 const body={employeeId,title:'Home cleaning',address:'12 Linden St, 10115 Berlin',customer:'Anna Weber',contact:'+49 151 0000000',region:'Berlin Mitte',date:'2026-10-25',time:'09:00',plannedMinutes:120,instructions:'Cat at home, keep balcony closed.',checklist:['Kitchen','Bathroom','Living room','Floors'],accessNotes:'Key in lockbox — code 4412\nDoorbell: Weber, 3rd floor',...changes};
 const response=await f.request('/api/admin/jobs',{method:'POST',headers:{...owner,'Idempotency-Key':randomUUID()},body});
 assert.equal(response.status,201,JSON.stringify(response.data));
 return response.data;
}
const act=(f,headers,job,action,extra={})=>f.request(`/api/employee/jobs/${job.id}/actions`,{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:{action,version:job.version,...extra}});

test('worker invite, magic link, Linden job and access removal stay free of prices',async t=>{
 const f=await fixture(t);let owner=await f.login();
 const preview=await f.request('/api/employee/company');assert.equal(preview.status,200);assert.equal(preview.data.name,'Fresh Clean');
 assert.equal((await f.request('/api/employee/google/start',{method:'POST',body:{}})).status,404);
 const declined=await addWorker(f,owner,6,{email:'decline@example.invalid',name:'Declined Worker'});
 assert.equal((await f.request('/api/employee/decline-invite',{method:'POST',body:{token:declined.token}})).status,200);
 assert.equal((await f.request('/api/employee/accept-invite',{method:'POST',body:{token:declined.token,password:'test-only-employee-password'}})).status,400);
 const pending=await addWorker(f,owner,9,{name:'Pending Cleaner',email:'pending@example.invalid'});
 assert.equal((await f.request('/api/employee/accept-invite',{method:'POST',body:{token:pending.token,password:'test-only-employee-password'}})).status,200);
 const still=await addWorker(f,owner,8,{email:'fresh-invite@example.invalid'});
 const expiring=await addWorker(f,owner,7,{email:'expired-invite@example.invalid'});
 f.advance(23*3600000);
 assert.equal((await f.request('/api/employee/accept-invite',{method:'POST',body:{token:still.token,password:'test-only-employee-password'}})).status,200);
 f.advance(2*3600000);
 assert.equal((await f.request('/api/employee/accept-invite',{method:'POST',body:{token:expiring.token,password:'test-only-employee-password'}})).status,400);
 owner=await f.login();
 const workers=(await f.request('/api/admin/employees',{headers:owner})).data.items;
 assert.equal(workers.find(item=>item.email==='decline@example.invalid').active,false);

 const invited=await addWorker(f,owner,1,{phone:'+49 151 234 5678'});
 const invite=await f.request('/api/employee/invite?token='+invited.token);assert.equal(invite.data.valid,true);assert.equal(invite.data.company,'Fresh Clean');assert.equal(invite.data.role,'Cleaner');
 const mailed=await f.request('/api/employee/invite/email',{method:'POST',body:{token:invited.token}});
 assert.equal(mailed.status,200);assert.match(mailed.data.previewUrl,/magic=/);
 const magic=new URL(mailed.data.previewUrl).hash.split('=')[1];
 const session=await f.request('/api/employee/magic',{method:'POST',body:{token:magic}});
 assert.equal(session.status,200);assert.equal(session.data.employee.language,'en');assert.match(session.data.today,/^\d{4}-\d{2}-\d{2}$/);
 assert.equal((await f.request('/api/employee/magic',{method:'POST',body:{token:magic}})).status,400);
 const headers={Cookie:session.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.data.csrf};
 const lang=await f.request('/api/employee/profile',{method:'PATCH',headers,body:{language:'de'}});assert.equal(lang.status,200);assert.equal(lang.data.employee.language,'de');
 await f.request('/api/employee/profile',{method:'PATCH',headers,body:{language:'en'}});

 const other=await addWorker(f,owner,2,{name:'Other Worker',email:'other@example.invalid'});
 const otherHeaders=await accept(f,other);
 let job=await addJob(f,owner,invited.employee.id);
 assert.equal(job.area_m2,70);assert.equal(job.access_notes.includes('4412'),true);
 let seen=await f.request('/api/employee/jobs/'+job.id,{headers});
 assert.equal(seen.status,200);assert.equal(seen.data.area_m2,70);assert.equal(seen.data.price,undefined);assert.equal(seen.data.quote,undefined);assert.equal(JSON.stringify(seen.data).includes('154'),false);
 assert.equal((await f.request('/api/employee/jobs',{headers})).data.total,1);
 const edited=await f.request('/api/admin/jobs/'+job.id,{method:'PUT',headers:{...owner,'Idempotency-Key':randomUUID()},body:{version:job.version,employeeId:invited.employee.id,title:'Home cleaning updated',address:job.address,customer:job.customer,contact:job.contact,region:job.region,date:job.scheduled_date,time:job.scheduled_time,plannedMinutes:job.planned_minutes,instructions:'Keys at reception',checklist:job.checklist.map(item=>item.text)}});
 assert.equal(edited.status,200);job=edited.data;assert.equal((await f.request('/api/employee/jobs/'+job.id,{headers})).data.title,'Home cleaning updated');
 const moved=await f.request('/api/admin/jobs/'+job.id,{method:'PUT',headers:{...owner,'Idempotency-Key':randomUUID()},body:{version:job.version,employeeId:other.employee.id,title:job.title,address:job.address,customer:job.customer,contact:job.contact,region:job.region,date:job.scheduled_date,time:job.scheduled_time,plannedMinutes:job.planned_minutes,instructions:job.instructions,checklist:job.checklist.map(item=>item.text)}});
 assert.equal(moved.status,200);assert.equal((await f.request('/api/employee/jobs/'+job.id,{headers})).status,404);
 assert.equal((await f.request('/api/employee/jobs/'+moved.data.id,{headers:otherHeaders})).data.employee_id,other.employee.id);
 const cancelled=await f.request('/api/admin/jobs/'+moved.data.id+'/actions',{method:'POST',headers:{...owner,'Idempotency-Key':randomUUID()},body:{version:moved.data.version,action:'cancel',reason:'Customer cancelled'}});
 assert.equal(cancelled.status,200);assert.equal((await f.request('/api/employee/jobs',{headers:otherHeaders})).data.items.some(item=>item.id===moved.data.id),false);

 let live=await addJob(f,owner,invited.employee.id,{title:'Office',address:'5 Market Square',date:'2026-10-25',time:'11:30',plannedMinutes:90,checklist:['Desks']});
 assert.equal(live.area_m2,null);
 let started=await act(f,headers,live,'start');assert.equal(started.status,200);live=started.data;assert.equal(live.state,'working');
 assert.equal((await f.request('/api/admin/inbox',{headers:owner})).data.workersOut,1);
 const sharp=(await import('sharp')).default;const image=await sharp({create:{width:40,height:30,channels:3,background:'white'}}).png().toBuffer();
 for(let i=0;i<6;i++)assert.equal((await fetch(f.config.origin+`/api/employee/jobs/${live.id}/photos`,{method:'POST',headers:{Origin:f.config.origin,...headers,'Content-Type':'image/png'},body:image})).status,201);
 assert.equal((await fetch(f.config.origin+`/api/employee/jobs/${live.id}/photos`,{method:'POST',headers:{Origin:f.config.origin,...headers,'Content-Type':'image/png'},body:image})).status,409);
 const signature='data:image/png;base64,'+'A'.repeat(80);
 const finished=await act(f,headers,live,'finish',{done:[true],report:'',signature,paidOnSite:true,onsiteMethod:'cash',onsiteAmountCents:9700});
 assert.equal(finished.status,200);assert.equal(finished.data.state,'submitted');assert.equal(finished.data.payment_status,'paid_on_site');assert.equal(finished.data.onsite_amount_cents,9700);assert.equal(finished.data.photos.length,6);assert.equal(JSON.stringify(finished.data).includes('154'),false);

 let missed=await addJob(f,owner,invited.employee.id,{title:'Apartment',address:'88 River Rd',date:'2026-10-26',time:'14:00',plannedMinutes:60,checklist:['Floors']});
 const away=await act(f,headers,missed,'unavailable',{reason:'',notify:true});
 assert.equal(away.status,200);assert.equal(away.data.state,'accepted');assert.equal(away.data.review_note,"Can't make it");
 assert.equal((await f.request('/api/employee/jobs',{headers})).data.items.some(item=>item.id===missed.id),false);
 assert.equal((await f.request('/api/employee/jobs/'+missed.id,{headers})).status,404);
 const freed=await f.request('/api/admin/jobs/'+missed.id,{method:'PUT',headers:{...owner,'Idempotency-Key':randomUUID()},body:{version:away.data.version,employeeId:other.employee.id,title:missed.title,address:missed.address,customer:missed.customer,contact:missed.contact,region:missed.region,date:missed.scheduled_date,time:missed.scheduled_time,plannedMinutes:missed.planned_minutes,instructions:missed.instructions,checklist:['Floors']}});
 assert.equal(freed.status,200);assert.equal(freed.data.state,'assigned');assert.equal(freed.data.employee_id,other.employee.id);
 assert.equal((await f.request('/api/employee/jobs/'+missed.id,{headers:otherHeaders})).status,200);
 const inbox=(await f.request('/api/admin/inbox',{headers:owner})).data;
 assert.ok(inbox.items.some(item=>item.kind==='invite_declined'));
 assert.ok(inbox.items.some(item=>item.kind==='job_completed'));
 assert.ok(inbox.items.some(item=>item.kind==='worker_unavailable'));

 assert.equal((await f.request('/api/admin/employees/'+invited.employee.id,{method:'PATCH',headers:owner,body:{active:false}})).status,200);
 const removed=await f.request('/api/employee/session',{headers});assert.equal(removed.status,401);assert.equal(removed.data.code,'access_removed');
 assert.equal((await f.request('/api/admin/employees/'+still.employee.id,{method:'PATCH',headers:owner,body:{active:false}})).status,200);
 const login=await f.request('/api/employee/login',{method:'POST',body:{email:'fresh-invite@example.invalid',password:'test-only-employee-password'}});
 assert.equal(login.status,401);assert.equal(login.data.code,'access_removed');
 const empty=await addWorker(f,owner,3,{name:'Empty Worker',email:'empty@example.invalid'});
 const emptyHeaders=await accept(f,empty);
 assert.equal((await f.request('/api/employee/jobs',{headers:emptyHeaders})).data.total,0);
});
