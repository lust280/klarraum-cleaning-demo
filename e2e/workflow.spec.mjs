import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';

let server,app,origin,dir;
const password='test-only-workflow-owner-password';
test.beforeAll(async()=>{
 dir=await mkdtemp(join(tmpdir(),'klarraum-workflow-browser-'));
 const config={...loadConfig({DATA_DIR:dir}),live:true,legalReady:true,passwordHash:await hashPassword(password),business:{name:'Workflow Test',owner:'Test owner',address:'Test address',email:'test@example.invalid',postcodes:['90'],priceNote:'Test prices',privacyDetails:'Test privacy notice'},mail:{key:'test-only',from:'test@example.invalid',to:'test@example.invalid'}};
 ({server,app}=createServerApp(config,{fetcher:async()=>({ok:true})}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;config.origin=origin;
});
test.afterAll(async()=>{await app.drain();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});

test('customer inquiry flows through owner assignment, employee report and owner acceptance',async({page,browser})=>{
 await page.goto(origin);await page.locator('#customer-name').fill('Workflow customer');await page.locator('#customer-email').fill('workflow@example.invalid');await page.locator('#postcode').fill('90402');await page.locator('#address').fill('Fictional Street 8');await page.locator('#privacy').check();await page.locator('#submit-inquiry').click();await expect(page.locator('#success-message')).toContainText('Thank you. Your inquiry was saved.');
 await page.goto(origin+'/admin.html');await page.locator('#password').fill(password);await page.locator('#login-form button').click();await expect(page.locator('.inquiry')).toHaveCount(1);
 const session=await (await page.request.get(origin+'/api/admin/session')).json();
 const employee=await (await page.request.post(origin+'/api/admin/employees',{headers:{Origin:origin,'X-CSRF-Token':session.csrf},data:{name:'Workflow employee',email:'workflow-worker@example.invalid',region:'Nuremberg'}})).json();
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin'}).format(new Date());
 await page.getByRole('link',{name:'Create job',exact:true}).click();const form=page.locator('#job-form');await expect(form.locator('[name="inquiryId"]')).not.toHaveValue('');await form.locator('[name="employeeId"]').selectOption(employee.employee.id);await form.locator('[name="region"]').fill('Nuremberg');await form.locator('[name="date"]').fill(today);await form.locator('[name="checklist"]').fill('Clean entrance');await form.locator('button[type="submit"]').click();await expect(page.locator('#job-status')).toContainText('Job saved');
 const workerContext=await browser.newContext(),worker=await workerContext.newPage();const token=new URL(employee.inviteUrl).hash.slice(8);const accepted=await worker.request.post(origin+'/api/employee/accept-invite',{headers:{Origin:origin,'Content-Type':'application/json'},data:{token,password:'test-only-workflow-worker-password'}});expect(accepted.ok()).toBeTruthy();await worker.goto(origin+'/employee.html');await expect(worker.locator('.job-card')).toHaveCount(1);await worker.locator('.job-card').getByRole('button',{name:'Start',exact:true}).click();await worker.locator('.checklist input').check();await worker.getByRole('button',{name:'Complete job'}).click();await worker.getByRole('button',{name:'Submit report'}).click();await expect(worker.getByRole('heading',{name:'Report sent'})).toBeVisible();
 await page.locator('#refresh-jobs').click();await expect(page.locator('.job-card')).toContainText('Clean entrance');await page.getByRole('button',{name:'Accept report',exact:true}).click();await expect(page.locator('.job-card .badge')).toHaveText('Accepted');await workerContext.close();
});
