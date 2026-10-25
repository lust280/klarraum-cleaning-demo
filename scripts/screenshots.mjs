// Dev-only: local synthetic installation, no production access or outbound messages.
import {mkdtemp,mkdir,rm,writeFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';
const output=resolve(process.env.SALES_KIT_DIR||'./dist/sales-kit');await mkdir(output,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'klarraum-sales-demo-'));const password=randomUUID()+randomUUID();
const clock=Date.UTC(2026,9,25,10);const config={...loadConfig({DATA_DIR:temporary}),demoMode:true,passwordHash:await hashPassword(password)};
const {server,app}=createServerApp(config,{now:()=>clock,fetcher:async()=>{throw new Error('No outbound messages in screenshot generation.');}});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;config.origin=origin;
 async function request(path,body,headers={},method=body?'POST':'GET'){const r=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error('Synthetic fixture failed: '+path+' '+r.status);return {data,headers:r.headers};}
 const login=await request('/api/admin/login',{password}),owner={Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.data.csrf};
 const create=(path,body)=>request('/api/admin/'+path,body,{...owner,'Idempotency-Key':randomUUID()});
 const customer=(await create('customers',{name:'Beispielkunde · Demo',email:'office@example.invalid',phone:'',notes:'Fiktive Firma zur Produktvorführung.',active:true})).data;
 const properties=[];for(const [name,address] of [['Büro Mitte','Beispielstraße 1 (fiktiv), Nürnberg'],['Treppenhaus Süd','Musterweg 2 (fiktiv), Nürnberg']])properties.push((await create('properties',{customerId:customer.id,name,address,region:'Nürnberg',instructions:'Böden und Oberflächen laut Checkliste reinigen.',active:true})).data);
 const workers=[];
 for(const [index,name] of ['Demo Team A','Demo Team B'].entries()){
  const invite=(await create('employees',{name,email:`team${index+1}@example.invalid`,region:'Nürnberg'})).data;
  const accepted=await request('/api/employee/accept-invite',{token:new URL(invite.inviteUrl).hash.slice(8),password});workers.push({id:invite.employee.id,email:`team${index+1}@example.invalid`,headers:{Cookie:accepted.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':accepted.data.csrf}});
 }
 for(const [i,property] of properties.entries())await create('series',{employeeId:workers[i].id,propertyId:property.id,title:i?'Treppenhaus · Unterhaltsreinigung':'Büro · Unterhaltsreinigung',address:property.address,customer:customer.name,contact:'',region:property.region,date:i?'2026-10-02':'2026-10-01',time:i?'14:00':'09:00',plannedMinutes:i?90:120,instructions:property.instructions,checklist:['Böden reinigen','Oberflächen reinigen','Ergebnis prüfen'],frequency:'weekly',endDate:'2026-10-31'});
 const completed=(await create('jobs',{employeeId:workers[0].id,propertyId:properties[0].id,title:'Büro · abgeschlossene Demoreinigung',address:properties[0].address,customer:customer.name,contact:'',region:'Nürnberg',date:'2026-10-25',time:'09:00',plannedMinutes:90,instructions:'Fiktiver Auftrag für die Produktvorführung.',checklist:['Böden gereinigt','Oberflächen gereinigt']})).data;
 app.store.db.prepare('INSERT INTO work_intervals VALUES(?,?,?,?,?)').run(randomUUID(),completed.id,workers[0].id,clock-5400000,clock);
 app.store.db.prepare("UPDATE jobs SET state='closed',report='Demobeispiel: Checkliste vollständig erledigt.' WHERE id=?").run(completed.id);
 app.store.db.prepare("INSERT INTO job_events(job_id,actor,action,note,created_at) VALUES(?,'owner','approve','Demobeispiel',?)").run(completed.id,clock);
 await create('payments',{jobId:completed.id,kind:'payment',amountCents:8900,date:'2026-10-25',method:'bank',reference:'DEMO-2026-001',note:'Fiktiver Zahlungseintrag; kein echter Umsatz.'});
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'de-DE'}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.locator('#mode-banner').filter({hasText:'DEMO'}).waitFor();await page.screenshot({path:join(output,'01-website-desktop.png'),fullPage:true});await page.locator('#anfrage').screenshot({path:join(output,'02-calculator.png')});
 await page.goto(origin+'/admin.html');await page.locator('#password').fill(password);await page.locator('#login-form button').click();await page.locator('#dashboard').waitFor();const siteEditor=page.locator('details').filter({has:page.locator('#site-form')});await siteEditor.locator(':scope > summary').click();await siteEditor.screenshot({path:join(output,'03-website-editor.png')});
 await page.goto(origin+'/planning.html');await page.locator('#planning-content').waitFor();await page.locator('#calendar-range').filter({hasText:'–'}).waitFor();await page.locator('#calendar-view').selectOption('month');await page.locator('#calendar-date').fill('2026-10-25');await page.locator('#calendar-range').filter({hasText:'2026-10-01 – 2026-10-31'}).waitFor();await page.locator('#calendar h2').click();await page.locator('#calendar').screenshot({path:join(output,'04-calendar.png')});await page.locator('#customers').screenshot({path:join(output,'05-customers.png')});await page.locator('#properties').screenshot({path:join(output,'06-properties.png')});
 await page.goto(origin+'/reports.html');await page.locator('#report-month').fill('2026-10');await page.locator('#load-report').click();await page.locator('#report-paper').waitFor();await page.locator('#report-paper').screenshot({path:join(output,'07-monthly-report.png')});await page.pdf({path:join(output,'monthly-report-demo.pdf'),format:'A4',printBackground:true});
 const staffContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'de-DE'}),staff=await staffContext.newPage();staff.on('pageerror',e=>errors.push(e.message));await staff.goto(origin+'/employee.html');await staff.locator('#worker-login').waitFor();await staff.locator('#worker-login-form [name="email"]').fill(workers[0].email);await staff.locator('#worker-login-form [name="password"]').fill(password);await staff.locator('#worker-login-form button').click();await staff.locator('#worker-dashboard').waitFor();await staff.screenshot({path:join(output,'08-employee-mobile.png'),fullPage:true});
 await page.goto(origin+'/planning.html');await page.locator('#planning-content').waitFor();await page.evaluate(()=>localStorage.setItem('klarraum-language','en'));await page.reload();await page.locator('#planning-content').waitFor();await page.locator('#calendar-date').fill('2026-10-25');await page.locator('#calendar-view').selectOption('month');await page.locator('#calendar-range').filter({hasText:'2026-10-01 – 2026-10-31'}).waitFor();await page.locator('#calendar h2').click();await page.locator('#calendar').screenshot({path:join(output,'09-calendar-english.png')});await page.goto(origin+'/system.html');await page.locator('#system-content').waitFor();await page.screenshot({path:join(output,'10-system-english.png'),fullPage:true});
 if(errors.length)throw new Error('Browser errors in synthetic screenshots: '+errors.join('; '));
 for(const file of ['SALES-LISTING-DE.md','SALES-LISTING-EN.md','INSTALL-DE.md','INSTALL-EN.md','MARKETPLACE-READINESS-RU.md'])await copyFile(join(import.meta.dirname,'../docs',file),join(output,file));
 await writeFile(join(output,'README.txt'),'Klarraum 2.1 sales material. All names, addresses, work and money in screenshots are fictional local fixtures, not customer evidence or real revenue. No production data, API keys, passwords or invitation links are included. Listing drafts require seller identity, pricing, tax/license/support terms and platform review before publication.\n');
 console.log('Synthetic sales kit created: '+output);
}finally{await browser?.close();await app.drain();await new Promise(r=>server.close(r));await rm(temporary,{recursive:true,force:true});}
