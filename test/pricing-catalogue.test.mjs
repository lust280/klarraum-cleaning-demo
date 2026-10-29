import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {plans, customDomainCents, nextPlan, overagePrefersUpgrade, planEstimate, requestedPlanForWorkers} from '../lib/plans.mjs';

test('public plans are Starter, Pro and Plus in euros with no per-seat fee', ()=>{
 assert.deepEqual(['starter','pro','plus'].map(key=>[plans[key].name, plans[key].baseCents, plans[key].included, plans[key].seatCents]), [
  ['Starter',4900,2,0],['Pro',8900,5,0],['Plus',14900,10,0],
 ]);
 assert.equal(plans.solo,undefined);
 assert.equal(plans.pro.storageBytes,50*1024**3);
 assert.equal(customDomainCents,9900);
 assert.equal(nextPlan('starter').name,'Pro');
 assert.equal(nextPlan('pro').name,'Plus');
 assert.equal(nextPlan('plus'),null);
 assert.equal(overagePrefersUpgrade('starter'),null);
 assert.equal(overagePrefersUpgrade('plus'),null);
 assert.equal(planEstimate(plans.pro,5),8900);
 assert.equal(requestedPlanForWorkers(1).key,'starter');
 assert.equal(requestedPlanForWorkers(2).key,'starter');
 assert.equal(requestedPlanForWorkers(3).key,'pro');
 assert.equal(requestedPlanForWorkers(5).key,'pro');
 assert.equal(requestedPlanForWorkers(6).key,'plus');
 assert.equal(requestedPlanForWorkers(40).name,'Plus');
});

test('pricing and company pages advertise the catalogue without a checkout button', async()=>{
 const pricing=await readFile(new URL('../director-public/pricing.html',import.meta.url),'utf8');
 const company=await readFile(new URL('../director-public/platform.html',import.meta.url),'utf8');
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 for(const page of [pricing,company]){
  for(const price of ['€49','€89','€149'])assert.match(page,new RegExp(price));
  for(const seats of ['>2<','>5<','>10<'])assert.match(page,new RegExp(seats));
  assert.equal(page.includes('$29'),false);
  assert.equal(page.includes('<h2>Solo</h2>'),false);
  assert.equal(page.includes('<h2>Team</h2>'),false);
  assert.equal(page.includes('<h2>Scale</h2>'),false);
  assert.equal(page.includes('15-day'),false);
  assert.match(page,/12-month rolling/);
  assert.match(page,/5-day/);
  assert.match(page,/google-signup|plan=plus/);
  assert.match(page,/Paid add-on/);
  assert.match(page,/sales\.css/);
  assert.equal(page.includes('checkout.stripe.com'),false);
  assert.equal(page.includes('Sign in with Google'),false);
 }
 assert.match(company,/Continue with Google/);
 assert.match(pricing,/Continue with Google/);
 assert.match(company,/\/api\/google\/signup\/start/);
 assert.match(pricing,/\/api\/google\/signup\/start/);
 assert.match(pricing,/data-choose-plan="plus"/);
 assert.match(company,/Start your 5-day trial/);
 assert.match(company,/id="trial-form"/);
 assert.match(company,/id="application-form"/);
 for(const path of ['/pricing.html','/sales.css','/showcase.js','/plans.mjs'])assert.match(server,new RegExp(path.replaceAll('.','\\.')));
});
