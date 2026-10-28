import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../lib/config.mjs';
import {companyInquiryEnv,companyInquiryReadiness} from '../lib/company-inquiry.mjs';
import {sendNotification,sendInquiryReceipt} from '../lib/mail.mjs';

const hash='scrypt:'+'ab'.repeat(16)+':'+'cd'.repeat(64);
const mail={key:'test-resend-key',from:'KlarraumApp <inquiries@example.invalid>'};
const readyRow={contact_email:'owner@example.invalid',legal_owner:'Owner',legal_address:'1 Test Street',price_note:'Estimates include applicable tax.',privacy_details:'Test privacy notice.',legal_reviewed:1,inquiries_enabled:null,service_postcodes:'90,91'};

test('inquiries turn on only when mail, legal details and an owner password are ready',()=>{
 const missing=companyInquiryReadiness({},mail,{passwordHash:hash});
 assert.equal(missing.accepting,false);assert.ok(missing.missing.includes('contact email'));assert.ok(missing.missing.includes('legal review acknowledgement'));
 const ready=companyInquiryEnv(readyRow,mail,{passwordHash:hash});
 assert.equal(ready.env.ENABLE_INQUIRIES,'true');assert.equal(ready.env.MAIL_TO,'owner@example.invalid');assert.equal(ready.env.RESEND_API_KEY,'test-resend-key');
 const paused=companyInquiryEnv({...readyRow,inquiries_enabled:0},mail,{passwordHash:hash});
 assert.equal(paused.ready.ready,true);assert.equal(paused.env.ENABLE_INQUIRIES,'false');
 const demo=companyInquiryEnv(readyRow,mail,{passwordHash:hash,demo:true});
 assert.equal(demo.env.ENABLE_INQUIRIES,'false');assert.equal(demo.ready.accepting,false);
 const noMail=companyInquiryReadiness(readyRow,{},{passwordHash:hash});
 assert.equal(noMail.accepting,false);assert.deepEqual(noMail.mailMissing,['PLATFORM_RESEND_API_KEY','PLATFORM_MAIL_FROM']);
});

test('loadConfig accepts a ready platform company and still refuses demo live mode',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'klarraum-inquiry-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const {env}=companyInquiryEnv(readyRow,mail,{passwordHash:hash});
 const live=loadConfig({...env,DATA_DIR:dir,ADMIN_PASSWORD_HASH:hash,APP_ORIGIN:'http://localhost:3999',APP_SECRET:'x'.repeat(32)});
 assert.equal(live.live,true);assert.equal(live.mail.to,'owner@example.invalid');assert.equal(live.mail.customerReceipt,true);assert.equal(loadConfig({...env,MAIL_CUSTOMER_RECEIPT:'false',DATA_DIR:dir,ADMIN_PASSWORD_HASH:hash,APP_ORIGIN:'http://localhost:3999',APP_SECRET:'x'.repeat(32)}).mail.customerReceipt,false);assert.equal(live.business.privacyDetails,'Test privacy notice.');
 const demoEnv=companyInquiryEnv(readyRow,mail,{passwordHash:hash,demo:true}).env;
 assert.equal(loadConfig({...demoEnv,DATA_DIR:dir,DEMO_ONLY:'true',ADMIN_PASSWORD_HASH:hash}).live,false);
 assert.throws(()=>loadConfig({...env,DATA_DIR:dir,DEMO_ONLY:'true',ENABLE_INQUIRIES:'true',ADMIN_PASSWORD_HASH:hash}),/DEMO_ONLY/);
});

test('inquiry mail fails before any network call when Resend settings are missing',async()=>{
 const fetcher=async()=>{throw new Error('network should not be called');};
 await assert.rejects(sendNotification({key:'',from:'',to:''},{id:'abc'},'https://example.invalid',fetcher),/PLATFORM_RESEND_API_KEY/);
 await assert.rejects(sendInquiryReceipt({key:'test',from:'from@example.invalid',to:'owner@example.invalid',transport:'disabled'},{id:'abc',email:'customer@example.invalid'},'Alpha','https://example.invalid',fetcher),/not configured/);
});

test('customer calculator uses svg service icons',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(html,/<svg/);assert.equal(html.includes('🏠'),false);assert.equal(html.includes('🏢'),false);assert.equal(html.includes('✨'),false);
 assert.match(html,/id="price"/);assert.match(html,/id="area-range"/);
});
