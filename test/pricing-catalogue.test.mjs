import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {plans, customDomainCents, nextPlan} from '../lib/plans.mjs';

test('public plans match the catalogue: same features, seats and storage differ', ()=>{
 assert.deepEqual(['solo','starter','team','growth','business'].map(key=>[plans[key].name, plans[key].baseCents, plans[key].included]), [
  ['Solo',2900,1],['Starter',4900,3],['Team',8900,6],['Business',14900,12],['Scale',21900,20],
 ]);
 assert.equal(customDomainCents,9900);
 assert.equal(nextPlan('solo').name,'Starter');
 assert.equal(nextPlan('business'),null);
});

test('pricing and company pages advertise the catalogue without a checkout button', async()=>{
 const pricing=await readFile(new URL('../director-public/pricing.html',import.meta.url),'utf8');
 const company=await readFile(new URL('../director-public/platform.html',import.meta.url),'utf8');
 const script=await readFile(new URL('../director-public/showcase.js',import.meta.url),'utf8');
 assert.match(pricing,/showcase\.js/);
 assert.match(company,/showcase\.js/);
 assert.match(script,/plans\.mjs/);
 assert.equal(pricing.includes('checkout.stripe.com'),false);
 assert.equal(company.includes('Sign in with Google'),false);
 assert.match(script,/\$99|99 \$/);
});
