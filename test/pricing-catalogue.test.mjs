import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {plans, customDomainCents, nextPlan, overagePrefersUpgrade, planEstimate, requestedPlanForWorkers} from '../lib/plans.mjs';

test('public plans match the catalogue: same features, seats and storage differ', ()=>{
 assert.deepEqual(['solo','starter','team','growth','business','plus'].map(key=>[plans[key].name, plans[key].baseCents, plans[key].included]), [
  ['Solo',2900,1],['Starter',4900,3],['Team',8900,6],['Business',14900,12],['Scale',21900,20],['Plus',25900,25],
 ]);
 assert.equal(plans.plus.seatCents,800);
 assert.equal(plans.plus.storageBytes,250*1024**3);
 assert.equal(customDomainCents,9900);
 assert.equal(nextPlan('solo').name,'Starter');
 assert.equal(nextPlan('business').name,'Plus');
 assert.equal(nextPlan('plus'),null);
 assert.deepEqual(['solo','starter','team','growth','business','plus'].map(key=>plans[key].seatCents),[1500,1500,1200,1000,1000,800]);
 for(const key of ['solo','starter','team','growth','business']){
  const upcoming=nextPlan(key);
  assert.equal(overagePrefersUpgrade(key),true);
  assert.ok(planEstimate(plans[key],upcoming.included)>upcoming.baseCents);
 }
 assert.equal(planEstimate(plans.business,25),26900);
 assert.ok(planEstimate(plans.business,25)>plans.plus.baseCents);
 assert.equal(overagePrefersUpgrade('plus'),null);
 assert.equal(requestedPlanForWorkers(20).key,'business');
 assert.equal(requestedPlanForWorkers(21).key,'plus');
 assert.equal(requestedPlanForWorkers(40).key,'plus');
 assert.equal(requestedPlanForWorkers(25).name,'Plus');
});

test('pricing and company pages advertise the catalogue without a checkout button', async()=>{
 const pricing=await readFile(new URL('../director-public/pricing.html',import.meta.url),'utf8');
 const company=await readFile(new URL('../director-public/platform.html',import.meta.url),'utf8');
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 for(const page of [pricing,company]){
  for(const price of ['$29','$49','$89','$149','$219','$259'])assert.match(page,new RegExp(price.replace('$','\\$')));
  for(const seats of ['>1<','>3<','>6<','>12<','>20<','>25<'])assert.match(page,new RegExp(seats));
  assert.match(page,/12-month rolling/);
  assert.match(page,/google-signup|plan=plus/);
  assert.match(page,/one-time/);
  assert.match(page,/\$99/);
  assert.match(page,/sales\.css/);
  assert.equal(page.includes('checkout.stripe.com'),false);
  assert.equal(page.includes('Sign in with Google'),false);
 }
 assert.match(company,/Continue with Google/);
 assert.match(pricing,/Continue with Google/);
 assert.match(company,/\/api\/google\/signup\/start/);
 assert.match(pricing,/\/api\/google\/signup\/start/);
 assert.match(pricing,/data-choose-plan="plus"/);
 assert.match(company,/Start your 15-day trial/);
 assert.match(company,/id="trial-form"/);
 assert.match(company,/id="application-form"/);
 for(const path of ['/pricing.html','/sales.css','/showcase.js','/plans.mjs'])assert.match(server,new RegExp(path.replaceAll('.','\\.')));
});
