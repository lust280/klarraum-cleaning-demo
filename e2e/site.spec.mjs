import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';

let server,app,origin,dir,config;
const password='browser-test-only-password';
test.beforeAll(async()=>{
  dir=await mkdtemp(join(tmpdir(),'klarraum-site-browser-'));
  config={...loadConfig({DATA_DIR:dir}),live:true,passwordHash:await hashPassword(password),legalReady:true,
    business:{name:'Klarraum Test',owner:'Test owner',address:'Test address',email:'test@example.invalid',postcodes:['90','91'],priceNote:'Test prices',privacyDetails:'Test-only privacy notice'},
    mail:{key:'test-only',from:'test@example.invalid',to:'test@example.invalid'}};
  ({server,app}=createServerApp(config,{fetcher:async()=>({ok:true})}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  config.origin=origin;
});
test.afterAll(async()=>{await app.drain();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});

async function chooseSlot(page){
  await page.goto(origin);
  await expect.poll(()=>page.locator('#date option').count()).toBeGreaterThan(1);
  await page.locator('#date').selectOption({index:1});
  await page.locator('#preferred-time').selectOption({index:1});
}
async function partnerSignIn(page){
  await page.goto(origin+'/partner.html');
  await page.getByRole('button',{name:'Continue with Google'}).click();
  await expect(page.locator('[data-screen="today"]')).toBeVisible();
}

test('a customer request and Partner Confirm keep the user on a concrete Jobs route',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await chooseSlot(page);
  await page.locator('#area').fill('100');
  await expect(page.locator('#price')).toHaveText('€220.00');
  await page.locator('#continue-quote').click();
  await page.locator('#customer-name').fill('Browser Test');
  await page.locator('#customer-email').fill('browser@example.invalid');
  await page.locator('#postcode').fill('90402');
  await page.locator('#address').fill('Test address');
  await page.locator('#comments').fill('<img src=x onerror="window.__unsafe=true">');
  await page.locator('#privacy').check();
  await page.locator('#submit-inquiry').click();
  await expect(page.locator('#success-message')).toContainText('We got your request');
  await partnerSignIn(page);
  await page.getByRole('button',{name:'Confirm'}).first().click();
  await expect(page).toHaveURL(/partner\.html#jobs\//);
  await expect(page.locator('[data-screen="job-assign"]')).toContainText(/Job Detail|Assign worker/);
  expect(await page.evaluate(()=>window.__unsafe)).toBeUndefined();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('Partner Admin price settings update the customer calculator',async({page})=>{
  await partnerSignIn(page);
  await page.goto(origin+'/partner.html#settings/prices');
  await page.locator('input[name="home"]').fill('2.50');
  await page.getByRole('button',{name:'Save'}).click();
  await expect(page.locator('#toast')).toContainText('Saved');
  await page.goto(origin);
  await expect(page.locator('#price')).toHaveText('€175.00');
});

test('preview mode permits a draft but sends no customer details',async({page})=>{
  config.live=false;
  const submissions=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/client/requests'))submissions.push(request.url());});
  await chooseSlot(page);
  await page.locator('#continue-quote').click();
  await page.locator('#customer-name').fill('Demo customer');
  await page.locator('#customer-email').fill('demo@example.invalid');
  await page.locator('#postcode').fill('90402');
  await page.locator('#address').fill('Fictional example street 1');
  await page.locator('#privacy').check();
  await page.locator('#submit-inquiry').click();
  await expect(page.locator('#preview-status')).toContainText('Demo: your details were prepared as a preview.');
  expect(submissions).toEqual([]);
  config.live=true;
});
