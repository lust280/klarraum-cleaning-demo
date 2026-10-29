import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';
import {clientQuote, durationMinutes, footerCopy} from '../lib/client-booking.mjs';
import {resolveBooking, allowsCard} from '../public/booking-contract.js';

const password='test-only-password-which-is-not-used-in-production';
const passwordHash=await hashPassword(password);

test('public booking contract drives the funnel and falls back to request',()=>{
  const paused = resolveBooking({config:{bookingMode:'paused', partnerBooking:{bookingMode:'paused', storedBookingMode:'request', trialPaused:true, currency:'EUR', areaUnit:'m2', cardPayments:true, connectOn:true, company:{name:'Fresh Clean', phone:'1', email:'a@b.c'}, prices:{home:2.2, office:1.8, deep:3.5, minimum:null, maxAreaM2:80, speedM2PerHour:30}}}});
  assert.equal(paused.source, 'config');
  assert.equal(paused.booking.bookingMode, 'paused');
  assert.equal(paused.booking.storedBookingMode, 'request');
  assert.equal(allowsCard(paused.booking), false);
  const instant = resolveBooking({partner:{bookingMode:'instant', storedBookingMode:'instant', trialPaused:false, cardPayments:true, connectOn:true, currency:'EUR', areaUnit:'m2', company:{name:'Fresh Clean'}, prices:{home:2.2, office:1.8, deep:3.5, minimum:null, maxAreaM2:null, speedM2PerHour:30}}});
  assert.equal(instant.source, 'partner-booking-mode');
  assert.equal(allowsCard(instant.booking), true);
  const missing = resolveBooking({config:{currency:'EUR', pricing:{rates:{home:1.8, office:1.5, deep:3.2}, minimum:60}}, company:{name:'Klarraum'}});
  assert.equal(missing.source, 'stub');
  assert.equal(missing.booking.bookingMode, 'request');
  assert.equal(allowsCard(missing.booking), false);
  assert.equal(missing.booking.prices.home, 1.8);
});

test('public booking page keeps clients off platform pricing and navigation',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.equal(html.includes('menu-open'),false);
  assert.equal(html.includes('client-menu'),false);
  assert.equal(/href="\/"/.test(html),false);
  assert.equal(html.includes('for-companies'),false);
  assert.equal(/href="[^"]*\/plans"/.test(html),false);
  assert.equal(/href="[^"]*check-email/.test(html),false);
  assert.match(html,/class="brand-pending"/);
  assert.match(html,/id="time-slots"/);
  assert.equal(html.includes('€0.00'),false);
  assert.match(html,/href="index\.html"/);
});

test('quote, duration and footer follow the client locks',()=>{
  assert.equal(clientQuote(70,2.2,60),154);
  assert.equal(clientQuote(20,2.2,60),60);
  assert.equal(durationMinutes(70,30),150);
  assert.equal(durationMinutes(30,30),60);
  assert.equal(durationMinutes(31,30),90);
  assert.equal(footerCopy('request'),'No payment now · The company confirms your request');
  assert.equal(footerCopy('instant'),'Instant booking · Pay online or on site');
  assert.equal(footerCopy('paused'),'Online booking is paused');
});

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'klarraum-client-'));
  let clock=Date.UTC(2026,9,26,7,0,0);
  let contract=null;
  const config={...loadConfig({DATA_DIR:dir}),passwordHash,live:true,
    business:{name:'Fresh Clean',owner:'Test owner',address:'12 Linden St',email:'owner@example.invalid',phone:'555-012-3456',postcodes:['10','90','91']},
    mail:{key:'test-only',from:'test@example.invalid',to:'owner@example.invalid'}};
  const {server,app}=createServerApp(config,{now:()=>clock,fetcher:async()=>({ok:true}),getPublicBooking:()=>contract});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  config.origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await app.drain();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  async function request(path,{method='GET',body,headers={}}={}){
    const response=await fetch(config.origin+path,{method,headers:{Origin:config.origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
    return {status:response.status,data,headers:response.headers};
  }
  async function token(){const response=await request('/api/form-token');clock+=2100;return response.data.token;}
  async function login(){
    const response=await request('/api/admin/login',{method:'POST',body:{password}});
    assert.equal(response.status,200);
    return {Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':response.data.csrf};
  }
  function useContract(overrides={}){
    const mode=overrides.bookingMode||'request';
    contract={
      bookingMode:mode, storedBookingMode:overrides.storedBookingMode||mode, trialPaused:overrides.trialPaused===true,
      currency:'EUR', areaUnit:'m2', cardPayments:overrides.cardPayments===true, connectOn:overrides.connectOn===true,
      company:{name:'Fresh Clean', phone:'555-012-3456', email:'owner@example.invalid'},
      prices:{home:1.8, office:1.5, deep:3.2, minimum:60, maxAreaM2:null, speedM2PerHour:30, ...overrides.prices},
      demoJob:{address:'12 Linden St, 10115 Berlin', areaM2:70, ratePerM2:2.2, quote:154, currency:'EUR', payment:'Unpaid'},
    };
  }
  return {request,token,login,app,config,useContract,advance:ms=>{clock+=ms;},
    async submit(changes={},choice='request'){
      const body={name:'Anna Example',email:'anna@example.invalid',phone:'',postcode:'10115',address:'12 Linden St',message:'',service:'home',area:70,date:'2026-10-28',time:'09:00',privacy:true,website:'',paymentChoice:choice,token:await token(),...changes};
      const path=choice==='card'?'/api/client/pay':'/api/client/requests';
      const sent=choice==='card'?{...body,outcome:changes.outcome||'success',paymentChoice:undefined}:body;
      return request(path,{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:sent});
    }};
}

test('request mode creates an unpaid new request and lists it for ops',async t=>{
  const f=await fixture(t);
  const config=await f.request('/api/client/config');
  assert.equal(config.data.bookingMode,'request');
  assert.equal(config.data.connect,false);
  assert.equal(config.data.auth.plugIn,'wave1-shared-auth');
  const saved=await f.submit();
  assert.equal(saved.status,201,JSON.stringify(saved.data));
  assert.equal(saved.data.jobStatus,'New request');
  assert.equal(saved.data.paymentStatus,'Unpaid');
  assert.equal(saved.data.price,126);
  assert.equal(saved.data.address,'12 Linden St');
  const headers=await f.login();
  const jobs=await f.request('/api/admin/client-jobs',{headers});
  assert.equal(jobs.data.total,1);
  assert.equal(jobs.data.items[0].jobStatus,'New request');
  assert.equal(jobs.data.items[0].paymentStatus,'Unpaid');
  const inquiries=await f.request('/api/admin/inquiries',{headers});
  assert.equal(inquiries.data.items[0].jobStatus,'New request');
  assert.equal(inquiries.data.items[0].postcode,'10115');
});

test('instant pay on site, card stub, decline, and connect off',async t=>{
  const f=await fixture(t);const headers=await f.login();
  f.useContract({bookingMode:'instant', cardPayments:true, connectOn:true});
  const onsite=await f.submit({time:'10:00'},'onsite');
  assert.equal(onsite.status,201,JSON.stringify(onsite.data));
  assert.equal(onsite.data.jobStatus,'Accepted');
  assert.equal(onsite.data.paymentStatus,'Unpaid');
  const declined=await f.submit({time:'12:00',outcome:'fail'},'card');
  assert.equal(declined.status,402);
  assert.equal(declined.data.stub,true);
  assert.equal((await f.request('/api/admin/client-jobs',{headers})).data.total,1);
  const paid=await f.submit({time:'13:00',outcome:'success'},'card');
  assert.equal(paid.status,201,JSON.stringify(paid.data));
  assert.equal(paid.data.paymentStatus,'Paid online');
  assert.equal(paid.data.processor,'stripe-later');
  f.useContract({bookingMode:'instant', cardPayments:false, connectOn:false});
  const blocked=await f.submit({time:'14:00',outcome:'success'},'card');
  assert.equal(blocked.status,409);
  f.useContract({bookingMode:'request', cardPayments:true});
  assert.equal((await f.request('/api/config')).data.partnerBooking.bookingMode,'request');
  const noCard=await f.submit({time:'14:00',outcome:'success'},'card');
  assert.equal(noCard.status,400);
});

test('paused mode does not create a request',async t=>{
  const f=await fixture(t);const headers=await f.login();
  f.useContract({bookingMode:'paused', storedBookingMode:'request', trialPaused:true, cardPayments:false});
  const saved=await f.submit();
  assert.equal(saved.status,503);
  assert.match(saved.data.error,/paused/);
  assert.equal((await f.request('/api/admin/client-jobs',{headers})).data.total,0);
});

test('only open slots can be booked and a taken slot is rejected',async t=>{
  const f=await fixture(t);
  const slots=await f.request('/api/client/slots?area=70');
  assert.equal(slots.status,200);
  const day=slots.data.dates.find(item=>item.value==='2026-10-26');
  assert.ok(day);
  assert.equal(day.times.some(item=>item.value==='08:00'),false);
  assert.equal(day.times.some(item=>item.value==='08:30'),true);
  const saved=await f.submit({date:'2026-10-26',time:'08:30'});
  assert.equal(saved.status,201,JSON.stringify(saved.data));
  const again=await f.request('/api/client/slots?area=70');
  const same=again.data.dates.find(item=>item.value==='2026-10-26');
  assert.equal(same.times.some(item=>item.value==='08:30'),false);
  assert.equal(same.times.some(item=>item.value==='09:00'),false);
  const rejected=await f.submit({date:'2026-10-26',time:'08:30'});
  assert.equal(rejected.status,409);
});

test('a new request releases its slot after 24 hours',async t=>{
  const f=await fixture(t);
  assert.equal((await f.submit({date:'2026-10-27',time:'09:00'})).status,201);
  f.advance(24*3600000+1);
  const slots=await f.request('/api/client/slots?area=70');
  const day=slots.data.dates.find(item=>item.value==='2026-10-27');
  assert.equal(day.times.some(item=>item.value==='09:00'),true);
  const headers=await f.login();
  assert.equal((await f.request('/api/admin/client-jobs',{headers})).data.items[0].jobStatus,'New request');
});

test('cancel frees the slot and follows the refund rule',async t=>{
  const f=await fixture(t);const headers=await f.login();
  f.useContract({bookingMode:'instant', cardPayments:true, connectOn:true});
  const later=await f.submit({date:'2026-10-28',time:'09:00',outcome:'success'},'card');
  assert.equal(later.status,201,JSON.stringify(later.data));
  const auto=await f.request('/api/client/cancel',{method:'POST',body:{token:later.data.token}});
  assert.equal(auto.status,200);
  assert.equal(auto.data.jobStatus,'Cancelled');
  assert.equal(auto.data.paymentStatus,'Refunded');
  const soon=await f.submit({date:'2026-10-26',time:'15:30',outcome:'success'},'card');
  assert.equal(soon.status,201,JSON.stringify(soon.data));
  const company=await f.request('/api/client/cancel',{method:'POST',body:{token:soon.data.token}});
  assert.equal(company.data.jobStatus,'Cancelled');
  assert.equal(company.data.paymentStatus,'Paid online');
  assert.equal(company.data.refundNotice,'Refund is decided by the company');
  const started=await f.submit({date:'2026-10-27',time:'11:00',outcome:'success'},'card');
  const patched=await f.request('/api/admin/client-jobs/'+started.data.id,{method:'PATCH',headers,body:{jobStatus:'In progress'}});
  assert.equal(patched.status,200);
  assert.equal((await f.request('/api/client/cancel',{method:'POST',body:{token:started.data.token}})).status,409);
  const slots=await f.request('/api/client/slots?area=70');
  assert.equal(slots.data.dates.find(item=>item.value==='2026-10-28').times.some(item=>item.value==='09:00'),true);
});

test('max area blocks the quote and magic-link auth stays a stub',async t=>{
  const f=await fixture(t);const headers=await f.login();
  f.useContract({prices:{maxAreaM2:50}});
  const tooBig=await f.submit({area:70});
  assert.equal(tooBig.status,400);
  assert.match(tooBig.data.error,/Contact the company for larger areas/);
  const magic=await f.request('/api/client/magic-link',{method:'POST',body:{email:'anna@example.invalid'}});
  assert.equal(magic.status,202);
  assert.equal(magic.data.stub,true);
  assert.equal(magic.data.plugIn,'wave1-shared-auth');
  assert.equal((await f.request('/api/client/magic-link?token=nope')).status,410);
  assert.equal((await f.request('/api/admin/session',{headers:{Cookie:magic.headers.get('set-cookie')||''}})).status,401);
});
