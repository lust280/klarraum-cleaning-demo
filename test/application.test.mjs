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
 const response=await f.submit({price:0},key);assert.equal(response.status,201);assert.equal(response.data.price,126);
 await f.app.drain();assert.equal(f.notifications.length,1);
 const mail=JSON.parse(f.notifications[0].body);assert.ok(!mail.text.includes('customer@example.invalid'));
 const repeat=await f.submit({price:0},key);assert.equal(repeat.status,200);assert.equal(repeat.data.id,response.data.id);
 const changed=await f.submit({name:'Different'},key);assert.equal(changed.status,409);
 const headers=await f.login();const list=await f.request('/api/admin/inquiries',{headers});
 assert.equal(list.data.total,1);assert.equal(list.data.items[0].notification,'sent');assert.equal(list.data.items[0].email,'customer@example.invalid');
 assert.equal(list.headers.get('cache-control'),'no-store');
});

test('validate personal data, area, service region, date, privacy, honeypot and form token',async t=>{
 const f=await fixture(t);
 for(const invalid of [{name:''},{email:'',phone:''},{email:'bad'},{email:'a@b.c\nBcc: x@y.z'},{phone:'abc'},{postcode:'12345'},{postcode:'9040'},{date:'2026-02-30'},{date:'2025-01-01'},{date:'2030-01-01'},{area:1001},{area:20.5},{service:'__proto__'},{windows:'true'},{privacy:false},{message:'x'.repeat(2001)},{website:'spam'},{token:'forged'}]){
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
