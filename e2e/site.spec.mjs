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
 await expect(page.locator('#price')).toHaveText('€126.00');
 await page.locator('#area').fill('100');await page.locator('#frequency').selectOption('weekly');await page.locator('#windows').check();
 await expect(page.locator('#price')).toHaveText('€202.00');
 await page.locator('#customer-name').fill('Browser Test');await page.locator('#customer-email').fill('browser@example.invalid');
 await page.locator('#postcode').fill('90402');await page.locator('#address').fill('Test address');
 await page.locator('#comments').fill('<img src=x onerror="window.__unsafe=true">');await page.locator('#privacy').check();
 await page.locator('#submit-inquiry').click();await expect(page.locator('#success-message')).toContainText('Thank you. Your inquiry was saved.');
 await expect(page.locator('#success-message')).toContainText('€202.00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:testInfo.outputPath('customer.png'),fullPage:true});
 await page.goto(origin+'/admin.html');await page.locator('#password').fill(password);await page.locator('#login-form button').click();
 await expect(page.locator('.inquiry')).toHaveCount(1);await expect(page.locator('.inquiry')).toContainText('browser@example.invalid');
 await expect(page.locator('.inquiry')).toContainText('<img src=x');expect(await page.evaluate(()=>window.__unsafe)).toBeUndefined();
 await page.locator('.inquiry select').selectOption('contacted');await expect(page.locator('.inquiry-head .badge')).toHaveText('Contacted');
 await page.locator('.settings summary').first().click();await page.locator('[name="home"]').fill('2.50');await page.locator('#pricing-form button').click();await expect(page.locator('#pricing-status')).toContainText('Prices saved');
 await page.screenshot({path:testInfo.outputPath('admin.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.locator('.inquiry button').filter({hasText:'Delete'}).click();await page.locator('#delete-confirm').click();await expect(page.locator('.inquiry')).toHaveCount(0);
 await page.locator('#logout').click();await expect(page.locator('#login-panel')).toBeVisible();
 await page.goto(origin);await expect(page.locator('#price')).toHaveText('€175.00');
 expect(errors).toEqual([]);
});

test('preview allows typing but never transmits or saves contact data',async({page})=>{
 config.live=false;
 const submissions=[];page.on('request',req=>{if(req.method()==='POST' && req.url().includes('/api/inquiries'))submissions.push(req.url());});
 await page.goto(origin);await expect(page.locator('#customer-name')).toBeEnabled();
 await page.locator('#customer-name').fill('Demo customer');await page.locator('#customer-email').fill('demo@example.invalid');
 await page.locator('#postcode').fill('90402');await page.locator('#address').fill('Fictional example street 1');await page.locator('#privacy').check();
 await page.locator('#submit-inquiry').click();await expect(page.locator('#success-message')).toContainText('Demo: your details were prepared as a preview.');
 await expect(page.locator('#message')).toHaveValue(/Fictional example street 1/);
 expect(submissions).toEqual([]);expect(app.store.list('',0).total).toBe(0);
 await page.goto(origin+'/datenschutz.html');await expect(page.locator('#processing-details')).toContainText('Test-only privacy notice');
 config.live=true;
});

test('server demo sends cleaning parameters to admin but strips all entered personal details',async({page})=>{
 config.live=false;config.demoMode=true;
 let sent;
 page.on('request',req=>{if(req.url().endsWith('/api/demo/inquiries') && req.method()==='POST')sent=req.postDataJSON();});
 await page.goto(origin);
 await expect(page.locator('#submit-inquiry')).toContainText('Send fictional test to owner');
 await page.locator('#customer-name').fill('Do not transmit this name');await page.locator('#customer-email').fill('private@example.invalid');
 await page.locator('#address').fill('Do not transmit this address');await page.locator('#area').fill('85');await page.locator('#privacy').check();
 await page.locator('#submit-inquiry').click();await expect(page.locator('#success-message')).toContainText('Fictional test saved.');
 expect(sent.area).toBe(85);expect(sent.name).toBeUndefined();expect(sent.email).toBeUndefined();expect(sent.address).toBeUndefined();
 await page.goto(origin+'/admin.html');await page.locator('#password').fill(password);await page.locator('#login-form button').click();
 await expect(page.locator('.inquiry')).toHaveCount(1);await expect(page.locator('.inquiry')).toContainText('Demo customer');await expect(page.locator('.inquiry')).toContainText('85 m²');
 await expect(page.locator('.inquiry')).not.toContainText('Do not transmit');await expect(page.locator('.inquiry')).toContainText('contact details omitted');
 await page.locator('.inquiry button').filter({hasText:'Delete'}).click();await page.locator('#delete-confirm').click();await expect(page.locator('.inquiry')).toHaveCount(0);
 config.demoMode=false;config.live=true;
});

test('owner edits site from dashboard and customer view applies brand, texts, theme and availability',async({page},testInfo)=>{
 await page.goto(origin+'/admin.html');await page.locator('#password').fill(password);await page.locator('#login-form button').click();
 await page.locator('#website-settings > summary').click();
 await page.locator('[name="company_name"]').fill('Nordlicht Reinigung');await page.locator('[name="company_theme"]').selectOption('navy');
 await page.locator('[name="company_phone"]').fill('+49 911 1234567');await page.locator('[name="company_email"]').fill('info@example.invalid');
 await page.locator('[name="company_area"]').fill('Nürnberg & Fürth');await page.locator('[name="hero_title"]').fill('Mehr Zeit für Sie.');
 await page.locator('[name="home_title"]').fill('Hauspflege');await page.locator('[name="office_enabled"]').uncheck();await page.locator('[name="windowsEnabled"]').uncheck();
 await page.locator('#site-form button[type="submit"]').click();await expect(page.locator('#site-status')).toContainText('Website saved.');
 await page.screenshot({path:testInfo.outputPath('website-editor.png'),fullPage:true});
 await page.goto(origin);await expect(page.locator('#hero-title')).toHaveText('Mehr Zeit für Sie.');await expect(page.locator('[data-company]').first()).toHaveText('Nordlicht Reinigung');
 await expect(page.locator('html')).toHaveAttribute('data-theme','navy');await expect(page.locator('[data-service-card="office"]')).toBeHidden();await expect(page.locator('#windows')).toBeHidden();await expect(page.locator('[data-service-promise="office"]')).toBeHidden();await expect(page.locator('#pricing-explanation')).not.toContainText('Büroreinigung');
 await expect(page.locator('[data-service-card="home"] h3')).toHaveText('Hauspflege');await expect(page.locator('#contact-email')).toHaveAttribute('href','mailto:info@example.invalid');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:testInfo.outputPath('customized-site.png'),fullPage:true});
 // Create a normal inquiry under the customized service and verify internal notes.
 await page.locator('#customer-name').fill('Notes Test');await page.locator('#customer-email').fill('notes@example.invalid');await page.locator('#postcode').fill('90402');await page.locator('#privacy').check();await page.locator('#submit-inquiry').click();
 await expect(page.locator('#success-message')).toContainText('Thank you. Your inquiry was saved.');
 await page.goto(origin+'/admin.html');await expect(page.locator('.inquiry')).toHaveCount(1);await expect(page.locator('[data-stat="new"]')).toHaveText('1');await expect(page.locator('.inquiry')).toContainText('Hauspflege');
 await page.locator('.note-editor textarea').fill('Rückruf am Dienstag');await page.locator('.note-editor button').click();await expect(page.locator('.note-editor .fine')).toContainText('Note saved.');
 await page.reload();await expect(page.locator('.note-editor textarea')).toHaveValue('Rückruf am Dienstag');
});

test('owner uploads logo and photos, publishes approved review, then removes all optional sections',async({page},testInfo)=>{
 const sharp=(await import('sharp')).default;
 const png=await sharp({create:{width:500,height:300,channels:4,background:{r:50,g:110,b:80,alpha:0.8}}}).png().toBuffer();
 await page.goto(origin+'/admin.html');await page.locator('#password').fill(password);await page.locator('#login-form button').click();await page.locator('#website-settings > summary').click();
 for(const kind of ['logo','hero','gallery']){
  await page.locator('#upload-'+kind).setInputFiles({name:'test-image.png',mimeType:'image/png',buffer:png});
  await expect(page.locator(kind==='gallery'?'#selected-gallery img':`#selected-${kind} img`)).toBeVisible();
  await expect(page.locator('#site-form button[type="submit"]')).toBeEnabled();
 }
 await page.locator('#selected-gallery input').fill('Test-only gallery caption');
 await page.locator('[name="review_name_0"]').fill('Approved test author');await page.locator('[name="review_text_0"]').fill('Test fixture for a customer-authorized statement.');
 await page.locator('#site-form button[type="submit"]').click();await expect(page.locator('#site-status')).toContainText('Website saved.');
 await page.goto(origin);await expect(page.locator('.booking-header .company-logo')).toBeVisible();await expect(page.locator('#hero-photo')).toBeVisible();
 await expect(page.locator('#photo-gallery')).toBeVisible();await expect(page.locator('#gallery-grid figcaption')).toHaveText('Test-only gallery caption');
 await expect(page.locator('#testimonial-grid')).toContainText('Approved test author');
 const images=await page.locator('.header .company-logo, #hero-photo, #gallery-grid img').evaluateAll(nodes=>nodes.every(node=>node.complete&&node.naturalWidth>0));expect(images).toBeTruthy();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:testInfo.outputPath('photos-and-reviews.png'),fullPage:true});
 await page.goto(origin+'/admin.html');await page.locator('#website-settings > summary').click();
 await page.locator('#selected-logo button').click();await page.locator('#selected-hero button').click();await page.locator('#selected-gallery button').filter({hasText:'Remove'}).click();
 await page.locator('.media-library-details > summary').click();
 const galleryFile=page.locator('.library-card').filter({hasText:'gallery'});
 await galleryFile.getByRole('button',{name:'Reuse'}).click();await expect(page.locator('#selected-gallery img')).toBeVisible();
 await page.locator('#selected-gallery button').filter({hasText:'Remove'}).click();
 await page.locator('[name="review_name_0"]').fill('');await page.locator('[name="review_text_0"]').fill('');
 await page.locator('#site-form button[type="submit"]').click();await expect(page.locator('#site-status')).toContainText('Website saved.');
 await page.goto(origin);await expect(page.locator('.booking-header .company-logo')).toBeHidden();await expect(page.locator('#hero-photo')).toBeHidden();await expect(page.locator('#photo-gallery')).toBeHidden();await expect(page.locator('#testimonials')).toBeHidden();
});
