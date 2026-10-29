import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';

let server,app,origin,dir,contract=null;
const password='browser-test-only-password';
test.beforeAll(async()=>{
  dir=await mkdtemp(join(tmpdir(),'klarraum-funnel-'));
  const config={...loadConfig({DATA_DIR:dir}),live:true,passwordHash:await hashPassword(password),legalReady:true,
    business:{name:'Fresh Clean',owner:'Test owner',address:'12 Linden St, 10115 Berlin',email:'contact@freshandclean.com',phone:'555-012-3456',postcodes:['10','90','91'],priceNote:'Test prices',privacyDetails:'Test privacy'},
    mail:{key:'test-only',from:'test@example.invalid',to:'test@example.invalid'}};
  ({server,app}=createServerApp(config,{fetcher:async()=>({ok:true}), getPublicBooking:()=>contract}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  config.origin=origin;
  const headers=await owner();
  const current=await (await fetch(origin+'/api/admin/settings',{headers:{...headers,Origin:origin}})).json();
  const saved=await fetch(origin+'/api/admin/settings',{method:'PUT',headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({...current.pricing,rates:{...current.pricing.rates,home:2.2}})});
  if(!saved.ok) throw new Error('Could not seed the Berlin rate.');
});
test.afterAll(async()=>{await app.drain();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
let auth;
async function owner(){
  if(auth) return auth;
  const response=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||'Owner login failed.');
  auth={Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':data.csrf};
  return auth;
}
function setBooking(body={}){
  const mode=body.mode||'request';
  contract={
    bookingMode:mode, storedBookingMode:body.storedBookingMode||mode, trialPaused:body.trialPaused===true,
    currency:'EUR', areaUnit:'m2', cardPayments:mode==='instant'&&body.connect===true, connectOn:body.connect===true,
    company:{name:'Fresh Clean', phone:'555-012-3456', email:'contact@freshandclean.com'},
    prices:{home:2.2, office:1.5, deep:3.2, minimum:60, maxAreaM2:body.maxArea??null, speedM2PerHour:30},
    demoJob:{address:'12 Linden St, 10115 Berlin', areaM2:70, ratePerM2:2.2, quote:154, currency:'EUR', payment:'Unpaid'},
  };
}
test.beforeEach(()=>{contract=null;});

async function chooseSlot(page){
  await page.goto(origin+'/');
  await expect(page.locator('#price')).toHaveText('€154.00');
  await expect.poll(()=>page.locator('#date option').count()).toBeGreaterThan(1);
  await page.locator('#date').selectOption({index:1});
  await page.locator('#preferred-time').selectOption({index:1});
  return {date:await page.locator('#date').inputValue(),time:await page.locator('#preferred-time').inputValue()};
}
async function contacts(page){
  await page.locator('#continue-quote').click();
  await page.locator('#customer-name').fill('Anna Example');
  await page.locator('#customer-email').fill('anna@example.invalid');
  await page.locator('#postcode').fill('10115');
  await page.locator('#address').fill('12 Linden St');
  await page.locator('#privacy').check();
}
async function jobs(){
  const headers=await owner();
  const response=await fetch(origin+'/api/admin/client-jobs',{headers:{...headers,Origin:origin}});
  return response.json();
}

test('request mode skips the card and saves a new unpaid request',async({page})=>{
  const slot=await chooseSlot(page);
  await contacts(page);
  await expect(page.locator('#pay-card')).toBeHidden();
  await page.locator('#submit-inquiry').click();
  await expect(page.getByRole('heading',{name:'Request sent'})).toBeVisible();
  await expect(page.locator('#success-message')).toContainText('We got your request');
  await expect(page.locator('#success-message')).toContainText('€154.00');
  await expect(page.getByText('This is not a confirmed booking yet.')).toBeVisible();
  const feed=await jobs();
  const item=feed.items.find(job=>job.date===slot.date&&job.time===slot.time);
  expect(item.jobStatus).toBe('New request');
  expect(item.paymentStatus).toBe('Unpaid');
  expect(item.address).toBe('12 Linden St');
});

test('instant pay on site confirms without a card',async({page})=>{
  await setBooking({mode:'instant',connect:false});
  await chooseSlot(page);
  await contacts(page);
  await page.locator('#submit-inquiry').click();
  await expect(page.getByRole('heading',{name:'Secure payment'})).toBeVisible();
  await expect(page.locator('#pay-card')).toBeHidden();
  await page.locator('#pay-onsite').click();
  await expect(page.getByRole('heading',{name:'Booking confirmed'})).toBeVisible();
  await expect(page.locator('#confirmed-card')).toContainText('pay on site');
  const feed=await jobs();
  expect(feed.items.some(job=>job.jobStatus==='Accepted'&&job.paymentStatus==='Unpaid')).toBeTruthy();
});

test('instant card stub can succeed or fail',async({page})=>{
  await setBooking({mode:'instant',connect:true});
  await chooseSlot(page);
  await contacts(page);
  await page.locator('#submit-inquiry').click();
  await page.locator('#card-number').fill('4242424242424242');
  await page.locator('#card-expiry').fill('12/28');
  await page.locator('#card-cvc').fill('123');
  await page.locator('#card-name').fill('Anna Example');
  await page.locator('#card-decline').check();
  await page.locator('#pay-card').click();
  await expect(page.getByRole('heading',{name:'Payment failed'})).toBeVisible();
  await expect(page.getByText('No money was taken.')).toBeVisible();
  await page.locator('#fail-onsite').click();
  await expect(page.getByRole('heading',{name:'Booking confirmed'})).toBeVisible();
  await chooseSlot(page);
  await contacts(page);
  await page.locator('#submit-inquiry').click();
  await page.locator('#card-number').fill('4242424242424242');
  await page.locator('#card-expiry').fill('12/28');
  await page.locator('#card-cvc').fill('123');
  await page.locator('#card-name').fill('Anna Example');
  await page.locator('#pay-card').click();
  await expect(page.getByRole('heading',{name:'Payment received'})).toBeVisible();
  const feed=await jobs();
  expect(feed.items.some(job=>job.paymentStatus==='Paid online')).toBeTruthy();
});

test('paused booking has no submit',async({page})=>{
  await setBooking({mode:'paused'});
  await page.goto(origin+'/');
  await expect(page.getByRole('heading',{name:'Online booking is paused'})).toBeVisible();
  await expect(page.getByText('Phone: 555-012-3456')).toBeVisible();
  await expect(page.getByText('Email: contact@freshandclean.com')).toBeVisible();
  await expect(page.locator('#continue-quote')).toBeHidden();
  await expect(page.locator('#submit-inquiry')).toBeHidden();
});

test('a taken slot disappears from the quote',async({page})=>{
  const slot=await chooseSlot(page);
  await contacts(page);
  await page.locator('#submit-inquiry').click();
  await expect(page.getByRole('heading',{name:'Request sent'})).toBeVisible();
  await page.goto(origin+'/');
  await expect.poll(()=>page.locator('#date option').count()).toBeGreaterThan(1);
  const dates=await page.locator('#date option').evaluateAll(nodes=>nodes.map(node=>node.value));
  // A new request holds the slot for 24h. A 70 m² visit can be the last open time that day, so the day drops out of the list.
  if(dates.includes(slot.date)){
    await page.locator('#date').selectOption(slot.date);
    await expect.poll(()=>page.locator('#preferred-time option').evaluateAll(nodes=>nodes.map(node=>node.value))).not.toContain(slot.time);
  }else{
    expect(dates).not.toContain(slot.date);
  }
});

test('customer can cancel a request from the link',async({page})=>{
  await chooseSlot(page);
  await contacts(page);
  await page.locator('#submit-inquiry').click();
  await page.locator('#cancel-link').click();
  await expect(page.getByRole('heading',{name:'Cancel booking'})).toBeVisible();
  await expect(page.locator('#screen-cancel')).toContainText('Free cancellation');
  await page.locator('#confirm-cancel').click();
  await expect(page.getByRole('heading',{name:'Booking cancelled'})).toBeVisible();
  const feed=await jobs();
  expect(feed.items.some(job=>job.jobStatus==='Cancelled')).toBeTruthy();
});

test('plans, check-email stub, expired link, and card blocked screen',async({page})=>{
  await page.goto(origin+'/plans');
  await expect(page.getByText('€49')).toBeVisible();
  await expect(page.getByText('€89')).toBeVisible();
  await expect(page.getByText('€149')).toBeVisible();
  await expect(page.getByText('5-day trial').first()).toBeVisible();
  await expect(page.getByText('14-day')).toHaveCount(0);
  await page.goto(origin+'/check-email');
  await page.locator('#magic-email').fill('anna@example.invalid');
  await page.locator('#magic-form button').click();
  await expect(page.locator('#magic-status')).toContainText('No session was created');
  await page.goto(origin+'/link-expired');
  await expect(page.getByRole('heading',{name:'This link has expired'})).toBeVisible();
  await setBooking({mode:'instant',connect:false});
  await page.goto(origin+'/pay?card=1');
  await expect(page.getByRole('heading',{name:'Online card pay unavailable'})).toBeVisible();
  await expect(page.locator('#pay-card')).toBeHidden();
});

test('larger than the company max area cannot continue',async({page})=>{
  await setBooking({maxArea:50});
  await page.goto(origin+'/');
  await page.locator('#area').fill('80');
  await expect(page.locator('#area-error')).toHaveText('Contact the company for larger areas');
  await expect(page.locator('#continue-quote')).toBeDisabled();
});
