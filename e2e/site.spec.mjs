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
 dir=await mkdtemp(join(tmpdir(),'klarraum-browser-'));
 config={...loadConfig({DATA_DIR:dir}),live:true,passwordHash:await hashPassword(password),legalReady:true,
  business:{name:'Klarraum Test',owner:'Test owner',address:'Test address',email:'test@example.invalid',postcodes:['90','91'],priceNote:'Testpreise inkl. Umsatzsteuer',privacyDetails:'Test-only privacy notice'},
  mail:{key:'test-only',from:'test@example.invalid',to:'test@example.invalid'}};
 ({server,app}=createServerApp(config,{fetcher:async()=>({ok:true})}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;config.origin=origin;
});
test.afterAll(async()=>{await app.drain();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});

test('customer submits, owner manages, updates prices and deletes; no unsafe HTML rendering',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin);await expect(page.locator('#customer-name')).toBeEnabled();
 await expect(page.locator('#price')).toHaveText('126,00 €');
 await page.locator('#area').fill('100');await page.locator('#frequency').selectOption('weekly');await page.locator('#windows').check();
 await expect(page.locator('#price')).toHaveText('202,00 €');
 await page.locator('#customer-name').fill('Browser Test');await page.locator('#customer-email').fill('browser@example.invalid');
 await page.locator('#postcode').fill('90402');await page.locator('#address').fill('Test address');
 await page.locator('#comments').fill('<img src=x onerror="window.__unsafe=true">');await page.locator('#privacy').check();
 await page.locator('#submit-inquiry').click();await expect(page.locator('#success-message')).toContainText('Ihre Anfrage wurde gespeichert');
 await expect(page.locator('#success-message')).toContainText('202,00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:testInfo.outputPath('customer.png'),fullPage:true});
 await page.goto(origin+'/admin.html');await page.locator('#password').fill(password);await page.locator('#login-form button').click();
 await expect(page.locator('.inquiry')).toHaveCount(1);await expect(page.locator('.inquiry')).toContainText('browser@example.invalid');
 await expect(page.locator('.inquiry')).toContainText('<img src=x');expect(await page.evaluate(()=>window.__unsafe)).toBeUndefined();
 await page.locator('.inquiry select').selectOption('contacted');await expect(page.locator('.inquiry-head .badge')).toHaveText('Kontaktiert');
 await page.locator('.settings summary').click();await page.locator('[name="home"]').fill('2.50');await page.locator('#pricing-form button').click();await expect(page.locator('#pricing-status')).toContainText('Preise gespeichert');
 await page.screenshot({path:testInfo.outputPath('admin.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.locator('.inquiry button').filter({hasText:'Löschen'}).click();await page.locator('#delete-confirm').click();await expect(page.locator('.inquiry')).toHaveCount(0);
 await page.locator('#logout').click();await expect(page.locator('#login-panel')).toBeVisible();
 await page.goto(origin);await expect(page.locator('#price')).toHaveText('175,00 €');
 expect(errors).toEqual([]);
});

test('preview allows typing but never transmits or saves contact data',async({page})=>{
 config.live=false;
 const submissions=[];page.on('request',req=>{if(req.method()==='POST' && req.url().includes('/api/inquiries'))submissions.push(req.url());});
 await page.goto(origin);await expect(page.locator('#customer-name')).toBeEnabled();
 await page.locator('#customer-name').fill('Demo customer');await page.locator('#customer-email').fill('demo@example.invalid');
 await page.locator('#postcode').fill('90402');await page.locator('#address').fill('Fictional example street 1');await page.locator('#privacy').check();
 await page.locator('#submit-inquiry').click();await expect(page.locator('#success-message')).toContainText('Es wurde nichts versendet');
 await expect(page.locator('#message')).toHaveValue(/Fictional example street 1/);
 expect(submissions).toEqual([]);expect(app.store.list('',0).total).toBe(0);
 await page.goto(origin+'/datenschutz.html');await expect(page.locator('#processing-details')).toContainText('Test-only privacy notice');
 config.live=true;
});
