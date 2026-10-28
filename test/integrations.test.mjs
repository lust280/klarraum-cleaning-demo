import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {integrationStatus,stripeCheckout,googleCalendarSync} from '../lib/integrations.mjs';
import {loadConfig} from '../lib/config.mjs';

test('stripe and google stay inactive until both required keys exist, and never start a live flow',()=>{
 assert.deepEqual(integrationStatus({}),{stripe:false,googleCalendar:false});
 assert.equal(integrationStatus({STRIPE_SECRET_KEY:'sk_test',STRIPE_PUBLISHABLE_KEY:'pk_test'}).stripe,true);
 assert.equal(integrationStatus({GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret'}).googleCalendar,true);
 const config=loadConfig({STRIPE_SECRET_KEY:'sk_test'});
 assert.equal(config.integrations.stripe,false);
 assert.equal(config.integrations.googleCalendar,false);
 assert.throws(()=>stripeCheckout(),/Stripe Checkout is not enabled/);
 assert.throws(()=>googleCalendarSync(),/Google Calendar is not configured/);
 assert.deepEqual(googleCalendarSync({GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret'}),{ready:true});
});

test('public and partner pages do not offer Stripe checkout or Google sign-in',async()=>{
 const files=await Promise.all(['public/index.html','public/admin.html','public/employee.html'].map(file=>readFile(new URL('../'+file,import.meta.url),'utf8')));
 const html=files.join('\n');
 assert.equal(html.includes('checkout.stripe.com'),false);
 assert.equal(html.includes('accounts.google.com'),false);
 assert.equal(html.includes('Pay with Stripe'),false);
 assert.equal(html.includes('Sign in with Google'),false);
});
