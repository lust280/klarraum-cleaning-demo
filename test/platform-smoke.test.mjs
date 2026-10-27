import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDirector,directorConfig} from '../director.mjs';
import {hashPassword} from '../lib/security.mjs';

const directorPassword='platform-smoke-director-password';
const ownerPassword='platform-smoke-owner-password';
const workerPassword='platform-smoke-worker-password';

test('ten temporary companies are provisioned, isolated and can receive assigned work',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'klarraum-platform-smoke-'));
 const config={...directorConfig({DIRECTOR_PASSWORD_HASH:await hashPassword(directorPassword),DIRECTOR_DATA_DIR:directory})};
 const platform=createDirector(config);await new Promise(resolve=>platform.server.listen(0,'127.0.0.1',resolve));const port=platform.server.address().port;
 t.after(async()=>{await platform.close();await rm(directory,{recursive:true,force:true});});
 const call=(path,{host='director.localhost:3100',method='GET',body,headers={}}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{Host:host,Origin:'http://'+host,'Content-Type':'application/json',...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,data:res.headers['content-type']?.includes('application/json')?JSON.parse(text):text});});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
 const directorLogin=await call('/api/director/login',{method:'POST',body:{password:directorPassword}});assert.equal(directorLogin.status,200);
 const director={Cookie:directorLogin.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':directorLogin.data.csrf};
 const companies=[];
 for(let index=1;index<=10;index++){
  const created=await call('/api/director/companies',{method:'POST',headers:director,body:{name:`Smoke company ${index}`,baseCents:7900,included:3,seatCents:500}});assert.equal(created.status,201);
  const activateUrl=new URL(created.data.inviteUrl),token=new URLSearchParams(activateUrl.hash.slice(1)).get('token');
  const activated=await call('/api/owner-setup',{host:activateUrl.host,method:'POST',body:{token,password:ownerPassword}});assert.equal(activated.status,200);
  const login=await call('/api/admin/login',{host:activateUrl.host,method:'POST',body:{password:ownerPassword}});assert.equal(login.status,200);
  const owner={Cookie:login.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':login.data.csrf};
  const worker=await call('/api/admin/employees',{host:activateUrl.host,method:'POST',headers:owner,body:{name:`Worker ${index}`,email:`worker-${index}@example.invalid`,region:'Smoke region'}});assert.equal(worker.status,201);
  const workerToken=new URL(worker.data.inviteUrl).hash.slice(8);
  const accepted=await call('/api/employee/accept-invite',{host:activateUrl.host,method:'POST',body:{token:workerToken,password:workerPassword}});assert.equal(accepted.status,200);
  const job=await call('/api/admin/jobs',{host:activateUrl.host,method:'POST',headers:{...owner,'Idempotency-Key':randomUUID()},body:{employeeId:worker.data.employee.id,title:`Smoke job ${index}`,address:'Fictional smoke address',customer:'Fictional customer',contact:'',region:'Smoke region',date:'2026-11-03',time:'09:00',plannedMinutes:60,instructions:'Fictional test only',checklist:['Test task']}});assert.equal(job.status,201);
  companies.push({id:created.data.company.id,host:activateUrl.host,owner,jobId:job.data.id});
 }
 const listed=await call('/api/director/companies',{headers:director});assert.equal(listed.status,200);assert.equal(listed.data.items.length,10);assert.ok(listed.data.items.every(company=>company.workers.active===1));
 for(const company of companies){const jobs=await call('/api/admin/jobs',{host:company.host,headers:company.owner});assert.equal(jobs.status,200);assert.equal(jobs.data.total,1);assert.equal(jobs.data.items[0].id,company.jobId);}
 assert.equal((await call('/api/admin/jobs',{host:companies[1].host,headers:companies[0].owner})).status,401);
 assert.equal((await call('/api/director/companies',{headers:companies[0].owner})).status,401);
});
