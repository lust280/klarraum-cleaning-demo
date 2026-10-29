import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {plans, customDomainCents, nextPlan, overagePrefersUpgrade, planEstimate, requestedPlanForWorkers, salesPlans, currencyFromAcceptLanguage, languageFromAcceptLanguage, resolveSignupPlan, applySalesRequest, formatSalesPrice} from '../lib/plans.mjs';

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

test('sales catalogue keeps the same face amount in EUR, USD and GBP',()=>{
 assert.deepEqual(['starter','pro','plus'].map(key=>[salesPlans[key].name,salesPlans[key].seats,salesPlans[key].amounts]),[
  ['Starter',2,{EUR:4900,USD:4900,GBP:4900}],
  ['Pro',5,{EUR:8900,USD:8900,GBP:8900}],
  ['Plus',10,{EUR:14900,USD:14900,GBP:14900}],
 ]);
 assert.equal(salesPlans.pro.trialDays,5);
 assert.equal(formatSalesPrice(4900,'USD'),'$49');
 assert.equal(formatSalesPrice(8900,'GBP'),'£89');
 assert.equal(formatSalesPrice(14900,'EUR'),'€149');
 assert.equal(currencyFromAcceptLanguage('en-US,en;q=0.9'),'USD');
 assert.equal(currencyFromAcceptLanguage('en-GB,en;q=0.8'),'GBP');
 assert.equal(currencyFromAcceptLanguage('en-UK'),'GBP');
 assert.equal(currencyFromAcceptLanguage('de-DE,en-US;q=0.8'),'EUR');
 assert.equal(currencyFromAcceptLanguage('de-AT'),'EUR');
 assert.equal(currencyFromAcceptLanguage('de-CH,de;q=0.9'),'EUR');
 assert.equal(currencyFromAcceptLanguage('fr-FR'),'EUR');
 assert.equal(currencyFromAcceptLanguage('en'),'EUR');
 assert.equal(currencyFromAcceptLanguage(''),'EUR');
 assert.equal(currencyFromAcceptLanguage('en-US;q=0.2,en-GB;q=0.9'),'GBP');
 assert.equal(languageFromAcceptLanguage('ru-RU,en;q=0.5'),'ru');
 assert.equal(languageFromAcceptLanguage('de-AT,en;q=0.8'),'de');
 assert.equal(resolveSignupPlan('plus').baseCents,14900);
 assert.equal(resolveSignupPlan('plus').included,10);
 assert.equal(resolveSignupPlan('plus').seatCents,0);
 assert.equal(resolveSignupPlan('plus').currency,'EUR');
 assert.equal(resolveSignupPlan('plus').trialDays,5);
 assert.equal(resolveSignupPlan('plus','USD').currency,'USD');
 assert.equal(resolveSignupPlan('plus','USD').baseCents,14900);
 assert.equal(resolveSignupPlan('pro','GBP').currency,'GBP');
 assert.equal(resolveSignupPlan('pro','GBP').included,5);
 assert.equal(resolveSignupPlan('team'),null);
 assert.equal(resolveSignupPlan('solo'),null);
});

test('pricing and company pages advertise the catalogue without a checkout button', async()=>{
 const pricing=await readFile(new URL('../director-public/pricing.html',import.meta.url),'utf8');
 const company=await readFile(new URL('../director-public/platform.html',import.meta.url),'utf8');
 const showcase=await readFile(new URL('../director-public/showcase.js',import.meta.url),'utf8');
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 for(const page of [pricing,company]){
  for(const key of ['starter','pro','plus']){
   const amount=salesPlans[key].amounts.EUR/100;
   assert.match(page,new RegExp(`data-sales-price="${key}"[^>]*data-eur="${amount}"`));
   assert.match(page,new RegExp(`data-usd="${amount}"`));
   assert.match(page,new RegExp(`data-gbp="${amount}"`));
   assert.match(page,new RegExp(`>€${amount}<`));
  }
  for(const seats of ['>2<','>5<','>10<'])assert.match(page,new RegExp(seats));
  assert.equal(page.includes('$29'),false);
  assert.equal(page.includes('<h2>Solo</h2>'),false);
  assert.equal(page.includes('<h2>Team</h2>'),false);
  assert.equal(page.includes('<h2>Scale</h2>'),false);
  assert.equal(page.includes('15-day'),false);
  assert.match(page,/data-currency-choice="USD"/);
  assert.match(page,/data-currency-choice="GBP"/);
  assert.match(page,/data-lang="ru"/);
  assert.match(page,/5-day/);
  assert.match(page,/No per-seat fee/);
  assert.match(page,/12-month rolling/);
  assert.match(page,/google-signup/);
  assert.match(page,/data-choose-plan="plus"/);
  assert.match(page,/Paid add-on/);
  assert.match(page,/sales\.css/);
  assert.equal(page.includes('checkout.stripe.com'),false);
  assert.equal(page.includes('Sign in with Google'),false);
  assert.equal(page.includes('<h2>Solo</h2>'),false);
  assert.equal(page.includes('<h2>Team</h2>'),false);
  assert.equal(page.includes('<h2>Business</h2>'),false);
  assert.equal(page.includes('<h2>Scale</h2>'),false);
  assert.equal(page.includes('15-day'),false);
  const dollars=applySalesRequest(page,'en-US,en;q=0.8');
  assert.match(dollars,/\$49/);
  assert.match(dollars,/\$89/);
  assert.match(dollars,/\$149/);
  assert.match(dollars,/data-currency="USD"/);
  assert.equal(dollars.includes('€89'),false);
  const pounds=applySalesRequest(page,'en-GB');
  assert.match(pounds,/£49/);
  assert.match(pounds,/£89/);
  assert.match(pounds,/£149/);
  assert.match(pounds,/data-currency="GBP"/);
  const euros=applySalesRequest(page,'de-DE,de;q=0.9');
  assert.match(euros,/€49/);
  assert.match(euros,/€89/);
  assert.match(euros,/data-currency="EUR"/);
  assert.match(euros,/data-locale="de"/);
 }
 assert.match(company,/Continue with Google/);
 assert.match(pricing,/Continue with Google/);
 assert.match(company,/\/api\/google\/signup\/start/);
 assert.match(pricing,/\/api\/google\/signup\/start/);
 assert.match(pricing,/data-choose-plan="plus"/);
 assert.match(company,/Start your 5-day trial/);
 assert.match(company,/id="trial-form"/);
 assert.match(company,/id="application-form"/);
 assert.match(company,/name="currency"/);
 assert.match(showcase,/currencyFromAcceptLanguage|data-currency-choice/);
 for(const lang of ['de:','ru:'])assert.match(showcase,new RegExp(lang));
 for(const path of ['/pricing.html','/sales.css','/showcase.js','/plans.mjs'])assert.match(server,new RegExp(path.replaceAll('.','\\.')));
});
