import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';
import {calendarEventBody,googleAuthorizationUrl,readGoogleState,signGoogleState} from '../lib/google-calendar.mjs';

const password='test-only-google-password';

async function boot(t,google={}){
 const dir=await mkdtemp(join(tmpdir(),'klarraum-google-'));
 const config=loadConfig({DATA_DIR:dir,ADMIN_PASSWORD_HASH:await hashPassword(password),APP_SECRET:'a'.repeat(32),...google});
 const hosted=createServerApp(config,{fetcher:google.fetcher});
 await new Promise(resolve=>hosted.server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${hosted.server.address().port}`;
 config.origin=origin;
 if(google.GOOGLE_CALENDAR_REDIRECT_URI===undefined&&config.google)config.google.redirectUri=`${origin}/api/google/calendar/callback`;
 t.after(async()=>{await hosted.app.drain();await new Promise(resolve=>hosted.server.close(resolve));await rm(dir,{recursive:true,force:true});});
 async function request(path,{body,cookie,csrf,method=body?'POST':'GET'}={}){
  const response=await fetch(origin+path,{method,redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();
  const data=text&&response.headers.get('content-type')?.includes('json')?JSON.parse(text):text;
  return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||'',location:response.headers.get('location')||''};
 }
 const login=await request('/api/admin/login',{body:{password}});
 return {origin,config,request,auth:{cookie:login.cookie,csrf:login.data.csrf},app:hosted.app};
}

test('calendar event names the worker and omits the customer phone',()=>{
 const body=calendarEventBody({title:'Home',workerName:'Alex',address:'12 Oak St',date:'2026-10-28',time:'09:00',minutes:60,timeZone:'Europe/Berlin'});
 assert.equal(body.description,'Worker: Alex');
 assert.equal(body.location,'12 Oak St');
 assert.equal(JSON.stringify(body).includes('555-0100'),false);
 assert.equal(body.start.timeZone,'Europe/Berlin');
});

test('signed calendar state rejects a swapped return address',()=>{
 const now=Date.now();
 const state=signGoogleState('secret',{companyId:'local',returnTo:'http://127.0.0.1/admin.html',now});
 assert.equal(readGoogleState('secret',state,now).returnTo,'http://127.0.0.1/admin.html');
 assert.throws(()=>readGoogleState('other',state,now),/invalid state/);
 const url=googleAuthorizationUrl({clientId:'client-id',redirectUri:'https://platform.klarraumapp.com/api/google/calendar/callback',state});
 assert.match(url,/client_id=client-id/);
 assert.equal(url.includes('client-secret'),false);
 assert.match(url,/calendar\.events/);
});

test('google calendar stays hidden and does not 500 without keys',async t=>{
 const app=await boot(t);
 assert.equal((await app.request('/api/admin/google-calendar',{cookie:app.auth.cookie})).data.enabled,false);
 const connect=await app.request('/api/admin/google-calendar/connect',{body:{},cookie:app.auth.cookie,csrf:app.auth.csrf});
 assert.equal(connect.status,404);
 assert.match(connect.data.error,/not configured/);
 const callback=await app.request('/api/google/calendar/callback?code=x&state=local.aa.bb');
 assert.equal(callback.status,404);
});

test('google calendar connect and sync run when both keys are set',async t=>{
 const calls=[];
 const fetcher=async(url,options={})=>{
  calls.push({url:String(url),body:options.body instanceof URLSearchParams?options.body.toString():options.body});
  if(String(url).includes('oauth2.googleapis.com/token'))return {ok:true,json:async()=>({access_token:'access-token',refresh_token:'refresh-token'})};
  if(String(url).includes('/calendar/v3/'))return {ok:true,json:async()=>({id:'event-1'})};
  return {ok:false,status:500,json:async()=>({})};
 };
 const app=await boot(t,{GOOGLE_CLIENT_ID:'client-id',GOOGLE_CLIENT_SECRET:'client-secret',fetcher});
 const status=await app.request('/api/admin/google-calendar',{cookie:app.auth.cookie});
 assert.equal(status.data.enabled,true);
 assert.equal(status.data.connected,false);
 const connect=await app.request('/api/admin/google-calendar/connect',{body:{},cookie:app.auth.cookie,csrf:app.auth.csrf});
 assert.equal(connect.status,200);
 assert.match(connect.data.url,/accounts\.google\.com/);
 assert.equal(connect.data.url.includes('client-secret'),false);
 const state=new URL(connect.data.url).searchParams.get('state');
 const callback=await app.request('/api/google/calendar/callback?code=auth-code&state='+encodeURIComponent(state));
 assert.equal(callback.status,302);
 assert.match(callback.location,/google=connected/);
 const connected=await app.request('/api/admin/google-calendar',{cookie:app.auth.cookie});
 assert.equal(connected.data.connected,true);
 const db=app.app.store.db,employee=randomUUID(),job=randomUUID();
 db.prepare('INSERT INTO employees(id,name,email,region,active,created_at) VALUES(?,?,?,?,1,?)').run(employee,'Alex','alex@example.invalid','Demo',Date.now());
 db.prepare(`INSERT INTO jobs(id,employee_id,title,address,customer,contact,region,scheduled_date,scheduled_time,planned_minutes,instructions,checklist,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(job,employee,'Home','12 Oak St','Customer','555-0100','Demo','2026-10-28','09:00',60,'','[]','assigned',Date.now());
 const synced=await app.request('/api/admin/google-calendar/sync',{body:{},cookie:app.auth.cookie,csrf:app.auth.csrf});
 assert.equal(synced.status,200);
 assert.equal(synced.data.copied,1);
 const event=calls.find(call=>String(call.url).includes('/calendar/v3/'));
 assert.equal(String(event.body).includes('555-0100'),false);
 assert.match(String(event.body),/Worker: Alex/);
 assert.equal(calls.some(call=>String(call.body).includes('client-secret')),true);
});

test('owner page does not offer Google sign-in in the static shell',async()=>{
 const html=await readFile(new URL('../public/admin.html',import.meta.url),'utf8');
 const script=await readFile(new URL('../public/admin.js',import.meta.url),'utf8');
 assert.equal(html.includes('Sign in with Google'),false);
 assert.equal(script.includes('Sign in with Google'),false);
 assert.match(script,/Connect Google Calendar/);
 assert.match(script,/if\(!ready\.googleCalendar\)return/);
});
