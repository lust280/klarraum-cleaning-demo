import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDirector,directorConfig} from '../director.mjs';
import {hashPassword} from '../lib/security.mjs';
const password='director-test-password-only',passwordHash=await hashPassword(password);
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'klarraum-director-'));
 const config=directorConfig({DIRECTOR_PASSWORD_HASH:passwordHash,DIRECTOR_DATA_DIR:directory});
 const d=createDirector(config);await new Promise(r=>d.server.listen(0,'127.0.0.1',r));
 const port=d.server.address().port;
 async function request(path,{host='director.localhost:3100',body,method=body?'POST':'GET',headers={}}={}){
  return new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{Host:host,Origin:'http://'+host,'Content-Type':'application/json',...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,data:res.headers['content-type']?.includes('application/json')?JSON.parse(text):text,headers:res.headers});});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
 }
 t.after(async()=>{await d.close();await rm(directory,{recursive:true,force:true});});
 const login=await request('/api/director/login',{body:{password}});assert.equal(login.status,200);
 const auth={Cookie:login.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':login.data.csrf};
 const post=(path,body,method='POST')=>request('/api/director/'+path,{body,method,headers:auth});
 const get=path=>request('/api/director/'+path,{headers:auth});
 const create=async name=>{const r=await post('companies',{name,baseCents:7900,included:3,seatCents:500});assert.equal(r.status,201);return r.data;};
 const activate=async item=>{const u=new URL(item.inviteUrl);const r=await request('/api/owner-setup',{host:u.host,body:{token:new URLSearchParams(u.hash.slice(1)).get('token'),password}});assert.equal(r.status,200);return u.host;};
 const owner=async host=>{const r=await request('/api/admin/login',{host,body:{password}});assert.equal(r.status,200);return {Cookie:r.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':r.data.csrf};};
 return {d,directory,request,post,get,create,activate,owner,auth};
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
test('two independent companies isolate owners, workers, activation links and director access',async t=>{
 const f=await fixture(t),a=await f.create('Alpha'),b=await f.create('Beta');
 assert.ok(!JSON.stringify(a.company).includes('secret'));assert.equal(a.company.estimatedCents,7900);
 const hostA=await f.activate(a),hostB=await f.activate(b);
 assert.equal((await f.request('/api/owner-setup',{host:hostA,body:{token:new URL(a.inviteUrl).hash.slice(7),password}})).status,400);
 const ownerA=await f.owner(hostA),ownerB=await f.owner(hostB);
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
