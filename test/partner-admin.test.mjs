import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServerApp} from '../server.mjs';
import {loadConfig} from '../lib/config.mjs';
import {hashPassword} from '../lib/security.mjs';
import {stripeCheckout, connectOnboardingStub} from '../lib/integrations.mjs';
import {classifyRefund, quoteEuros, jobDurationMinutes, seatsUsed, DEMO_JOB, PLANS, TRIAL_MS, MAGIC_MS, INVITE_MS} from '../lib/partner-admin.mjs';
import {translate} from '../public/partner-i18n.js';
import {DatabaseSync} from 'node:sqlite';

const passwordHash = await hashPassword('test-only-partner-admin-password');

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'klarraum-partner-'));
  let clock = Date.UTC(2026, 9, 25, 10);
  const config = {...loadConfig({DATA_DIR: dir}), passwordHash};
  const {server} = createServerApp(config, {now: () => clock});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, {recursive: true, force: true}); });
  const jar = {cookie: '', csrf: ''};
  async function request(path, {method = 'GET', body, headers = {}, auth = true} = {}) {
    const response = await fetch(config.origin + path, {
      method,
      headers: {
        Origin: config.origin,
        Accept: 'application/json',
        ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
        ...(auth && jar.cookie ? {Cookie: jar.cookie} : {}),
        ...(auth && jar.csrf && method !== 'GET' ? {'X-CSRF-Token': jar.csrf} : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    const setCookie = response.headers.get('set-cookie');
    if (setCookie && setCookie.includes('klarraum_partner=')) jar.cookie = setCookie.split(';')[0];
    if (data?.workspace?.csrf) jar.csrf = data.workspace.csrf;
    else if (data?.csrf) jar.csrf = data.csrf;
    return {status: response.status, data};
  }
  return {request, jar, origin: config.origin, dir, advance(ms) { clock += ms; }};
}

test('quote, duration, seats and refunds follow the locked rules', () => {
  assert.equal(quoteEuros({rate: DEMO_JOB.ratePerM2, area: DEMO_JOB.areaM2, minimum: null}), 154);
  assert.equal(quoteEuros({rate: 2.2, area: 10, minimum: 50}), 50);
  assert.equal(jobDurationMinutes(70, 30), 150);
  assert.equal(seatsUsed([{role:'cleaner', active:true, invite:'accepted'}, {role:'admin', active:true, invite:'accepted'}, {role:'helper', active:false, invite:'revoked'}]), 1);
  assert.deepEqual([PLANS.starter.cents, PLANS.pro.cents, PLANS.plus.cents], [4900, 8900, 14900]);
  assert.deepEqual([PLANS.starter.seats, PLANS.pro.seats, PLANS.plus.seats], [2, 5, 10]);
  assert.equal(classifyRefund({payment:'Paid online', actor:'client_cancel', hoursUntilVisit:25}).payment, 'Refunded');
  assert.equal(classifyRefund({payment:'Paid online', actor:'client_cancel', hoursUntilVisit:24}).action, 'ask_partner');
  assert.equal(classifyRefund({payment:'Paid online', actor:'client_cancel', hoursUntilVisit:2, hoursSinceAsk:48}).action, 'keep');
  assert.equal(classifyRefund({payment:'Paid online', actor:'partner_cancel'}).payment, 'Refunded');
  assert.equal(classifyRefund({payment:'Paid online', actor:'partner_decline'}).action, 'auto_refund');
  assert.equal(classifyRefund({payment:'Paid on site', actor:'client_cancel', hoursUntilVisit:1}).refund, false);
  assert.equal(classifyRefund({payment:'Unpaid', actor:'client_cancel'}).action, 'none');
  assert.throws(() => stripeCheckout(), /not enabled/);
  assert.equal(connectOnboardingStub('http://127.0.0.1:3000').live, false);
  assert.match(connectOnboardingStub('http://127.0.0.1:3000').url, /\/partner\.html#connect\/mock$/);
  assert.throws(() => connectOnboardingStub('https://checkout.stripe.com'), /not called/);
});

test('partner pages do not carry live Stripe or the old trial copy', async () => {
  const source = await readFile(new URL('../public/partner.js', import.meta.url), 'utf8');
  assert.match(source, /€49\/mo|4900/);
  assert.match(source, /Online booking OFF/);
  assert.equal(source.includes('14-day'), false);
  assert.equal(source.includes('Connect later'), false);
  assert.equal(source.includes('checkout.stripe.com'), false);
});

test('demo company is Pro in Berlin and Connect stays a local stub', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/config')).data.bookingMode, 'request');
  assert.equal((await f.request('/partner.html', {auth:false})).status, 200);
  const google = await f.request('/api/partner/auth/google', {method:'POST', body:{}});
  assert.equal(google.status, 200);
  assert.equal(google.data.workspace.plan.key, 'pro');
  assert.equal(google.data.workspace.plan.cents, 8900);
  assert.equal(google.data.workspace.seats.used, 3);
  assert.equal(google.data.workspace.seats.included, 5);
  assert.equal(google.data.workspace.company.timeZone, 'Europe/Berlin');
  assert.equal(google.data.workspace.company.currency, 'EUR');
  assert.equal(google.data.workspace.report.address, '12 Linden St, 10115 Berlin');
  assert.equal(google.data.workspace.report.quote, 154);
  assert.equal(google.data.workspace.connect.live, false);
  const prices = await f.request('/api/partner/prices', {method:'PUT', body:{home:2.2, office:1.8, deep:3.5, minimum:'', maxArea:'', speed:30}});
  assert.equal(prices.status, 200);
  assert.equal(prices.data.workspace.prices.sampleQuote, 154);
  assert.equal(prices.data.workspace.prices.sampleDurationMinutes, 150);
  const mode = await f.request('/api/partner/booking-mode', {method:'PUT', body:{bookingMode:'instant'}});
  assert.equal(mode.status, 200);
  assert.equal((await f.request('/api/partner/booking-mode', {auth:false})).data.bookingMode, 'instant');
  const started = await f.request('/api/partner/connect/start', {method:'POST', body:{}});
  assert.equal(started.status, 200);
  assert.equal(started.data.live, false);
  assert.match(started.data.url, new RegExp(`^${f.origin}/partner.html#connect/mock$`));
  assert.equal(started.data.url.includes('stripe.com'), false);
  assert.equal((await f.request('/api/partner/connect/finish', {method:'POST', body:{result:'connected'}})).data.workspace.connect.status, 'connected');
  assert.equal((await f.request('/api/partner/connect/disconnect', {method:'POST', body:{}})).data.workspace.connect.cardPayments, false);
  assert.equal((await f.request('/api/partner/plan', {method:'POST', body:{key:'starter'}})).status, 409);
  const alex = await f.request('/api/partner/auth/demo-as', {method:'POST', body:{accountId:'alex'}});
  assert.equal(alex.data.workspace.account.owner, false);
  assert.equal((await f.request('/api/partner/connect/start', {method:'POST', body:{}})).status, 403);
  assert.equal((await f.request('/api/partner/plan', {method:'POST', body:{key:'plus'}})).status, 403);
});

test('invites last 24 hours, admins do not take seats, and magic links last 15 minutes', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/partner/auth/google', {method:'POST', body:{}})).status, 200);
  const invite = await f.request('/api/partner/team/invites', {method:'POST', body:{name:'Nora Klein', email:'nora@linden.example', role:'helper', language:'de'}});
  assert.equal(invite.status, 201);
  assert.equal(invite.data.workspace.seats.used, 4);
  const token = new URL(invite.data.invite.url).hash.split('/').pop();
  assert.equal((await f.request('/api/partner/invites/lookup', {method:'POST', body:{token}, auth:false})).data.role, 'helper');
  f.advance(INVITE_MS);
  assert.equal((await f.request('/api/partner/invites/lookup', {method:'POST', body:{token}, auth:false})).status, 410);
  const refreshed = await f.request('/api/partner/auth/google', {method:'POST', body:{}});
  assert.equal(refreshed.data.workspace.seats.used, 3);
  for (const email of ['a@linden.example', 'b@linden.example']) {
    assert.equal((await f.request('/api/partner/team/invites', {method:'POST', body:{name:email, email, role:'cleaner', language:'en'}})).status, 201);
  }
  const blocked = await f.request('/api/partner/team/invites', {method:'POST', body:{name:'Full', email:'full@linden.example', role:'cleaner', language:'ru'}});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'seat_limit');
  const admin = await f.request('/api/partner/team/invites', {method:'POST', body:{name:'Ada Admin', email:'ada@linden.example', role:'admin', language:'en'}});
  assert.equal(admin.status, 201);
  assert.equal(admin.data.workspace.seats.used, 5);
  await f.request('/api/partner/auth/logout', {method:'POST', body:{}});
  const link = await f.request('/api/partner/auth/start', {method:'POST', body:{email:'sam@linden.example', mode:'signin'}, auth:false});
  assert.equal(link.status, 202);
  f.advance(MAGIC_MS);
  assert.equal((await f.request('/api/partner/auth/consume', {method:'POST', body:{token:link.data.continueToken}, auth:false})).status, 410);
});

test('a new company gets a 5-day Pro trial and the public page pauses when it ends', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/partner/demo/reset', {method:'POST', body:{}})).status, 200);
  const started = await f.request('/api/partner/auth/start', {method:'POST', body:{mode:'signup', email:'new@example.test'}, auth:false});
  assert.equal(started.status, 202);
  const consumed = await f.request('/api/partner/auth/consume', {method:'POST', body:{token:started.data.continueToken}, auth:false});
  assert.equal(consumed.status, 200);
  assert.equal(consumed.data.workspace.access.mode, 'onboarding');
  assert.equal(consumed.data.workspace.plan.storedStatus, 'trial');
  assert.equal(consumed.data.workspace.plan.trialEndsAt - consumed.data.workspace.plan.trialStartedAt, TRIAL_MS);
  assert.equal(consumed.data.workspace.plan.paymentMethod, null);
  assert.equal(consumed.data.workspace.plan.key, 'pro');
  const country = await f.request('/api/partner/onboarding', {method:'POST', body:{country:'DE'}});
  assert.equal(country.data.workspace.company.currency, 'EUR');
  assert.equal(country.data.workspace.company.areaUnit, 'm2');
  assert.equal(country.data.workspace.company.timeZone, 'Europe/Berlin');
  const site = await f.request('/api/partner/onboarding/site', {method:'POST', body:{name:'Nord Clean', slug:'nord-clean', person:'Nora'}});
  assert.equal(site.data.workspace.access.mode, 'full');
  assert.equal(site.data.workspace.bookingMode, 'request');
  f.advance(TRIAL_MS);
  const ended = await f.request('/api/partner/auth/google', {method:'POST', body:{}});
  assert.equal(ended.data.workspace.access.mode, 'readonly');
  const booking = await f.request('/api/partner/booking-mode', {auth:false});
  assert.equal(booking.data.bookingMode, 'paused');
  assert.equal(booking.data.storedBookingMode, 'request');
  assert.equal(booking.data.trialPaused, true);
  assert.equal((await f.request('/api/partner/booking-mode', {method:'PUT', body:{bookingMode:'instant'}})).status, 403);
  const chosen = await f.request('/api/partner/plan', {method:'POST', body:{key:'pro'}});
  assert.equal(chosen.status, 200);
  assert.equal(chosen.data.workspace.access.mode, 'full');
  assert.equal((await f.request('/api/partner/booking-mode', {auth:false})).data.bookingMode, 'request');
});

test('partner Confirm accepts the request and Assign stores the worker', async t => {
  const f = await fixture(t);
  const source = await readFile(new URL('../public/partner.js', import.meta.url), 'utf8');
  assert.match(source, /api\/partner\/jobs\/confirm/);
  assert.match(source, /data-action="assign-worker"/);
  assert.equal(source.includes("toast('Confirmed')"), false);
  assert.equal((await f.request('/api/partner/jobs/confirm', {method:'POST', body:{}, auth:false})).status, 401);
  const google = await f.request('/api/partner/auth/google', {method:'POST', body:{}});
  assert.equal(google.status, 200);
  const today = await f.request('/api/partner/today');
  assert.equal(today.status, 200);
  assert.equal(today.data.preview, true);
  const confirmed = await f.request('/api/partner/jobs/confirm', {method:'POST', body:{}});
  assert.equal(confirmed.status, 200);
  const job = confirmed.data.job;
  assert.equal(job.status, 'accepted');
  assert.equal(job.step, 1);
  assert.deepEqual(job.chain, ['new', 'accepted', 'assigned', 'in_progress', 'done']);
  assert.equal(job.address, DEMO_JOB.address);
  assert.equal(job.areaM2, 70);
  assert.equal(job.priceCents, 15400);
  assert.equal(job.serviceTitle, 'Home cleaning');
  assert.deepEqual(job.workers.map(worker => worker.name), ['Sarah Jenkins', 'Mike Chen', 'Lisa Wong']);
  assert.deepEqual(job.workers.map(worker => worker.role), ['Cleaner', 'Cleaner', 'Cleaner']);
  assert.equal(JSON.stringify(job).includes('km'), false);
  const board = await f.request('/api/partner/today');
  assert.equal(board.data.preview, false);
  assert.equal(board.data.counts.newRequests, 0);
  assert.equal(board.data.assign.some(item => item.id === job.id), true);
  const sarah = job.workers[0];
  const assigned = await f.request(`/api/partner/jobs/${job.id}/assign`, {method:'POST', body:{employeeId: sarah.id, version: job.version}});
  assert.equal(assigned.status, 200);
  assert.equal(assigned.data.job.status, 'assigned');
  assert.equal(assigned.data.job.step, 2);
  assert.equal(assigned.data.job.worker.name, 'Sarah Jenkins');
  const again = await f.request('/api/partner/jobs/confirm', {method:'POST', body:{}});
  assert.equal(again.data.job.id, job.id);
  assert.equal(again.data.job.status, 'assigned');
  const login = await fetch(f.origin + '/api/admin/login', {method:'POST', headers:{Origin: f.origin, 'Content-Type':'application/json'}, body: JSON.stringify({password:'test-only-partner-admin-password'})});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const ops = await fetch(f.origin + '/api/admin/ops/jobs/' + job.id, {headers:{Origin: f.origin, Cookie: cookie}});
  assert.equal(ops.status, 200);
  const stored = await ops.json();
  assert.equal(stored.status, 'assigned');
  assert.equal(stored.worker.name, 'Sarah Jenkins');
  assert.ok(stored.jobId);
  const replaced = await f.request(`/api/partner/jobs/${job.id}/assign`, {method:'POST', body:{employeeId: job.workers[1].id, version: assigned.data.job.version}});
  assert.equal(replaced.status, 200);
  assert.equal(replaced.data.job.worker.name, 'Mike Chen');
});

test('export, inbox and language are real partner actions', async t => {
  assert.equal(translate('de', 'Today'), 'Heute');
  assert.equal(translate('ru', 'Today'), 'Сегодня');
  assert.equal(translate('de', 'Confirm'), 'Bestätigen');
  assert.equal(translate('ru', 'Settings'), 'Настройки');
  assert.equal(translate('de', 'Save'), 'Speichern');
  assert.equal(translate('ru', 'Inbox'), 'Входящие');
  const source = await readFile(new URL('../public/partner.js', import.meta.url), 'utf8');
  assert.equal(source.includes('Inbox opens with Partner Ops.'), false);
  assert.match(source, /#settings\/billing\/plan/);
  assert.match(source, /api\/partner\/export\?format=/);
  assert.match(source, /api\/partner\/inbox/);
  assert.match(source, /navigator\.share/);
  assert.equal(source.includes('/admin.html'), false);
  assert.match(source, /api\/partner\/jobs\/confirm/);
  const f = await fixture(t);
  assert.equal((await f.request('/api/partner/export?format=csv', {auth:false})).status, 401);
  assert.equal((await f.request('/api/partner/inbox', {auth:false})).status, 401);
  assert.equal((await f.request('/api/partner/auth/google', {method:'POST', body:{}})).status, 200);
  const headers = {Cookie: f.jar.cookie, Origin: f.origin};
  const csv = await fetch(f.origin + '/api/partner/export?format=csv', {headers});
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition') || '', /attachment;\s*filename="klarraum-report\.csv"/);
  assert.equal(csv.headers.get('content-type'), 'application/octet-stream');
  const csvText = await csv.text();
  assert.match(csvText, /12 Linden St, 10115 Berlin/);
  assert.match(csvText, /"154"/);
  const jsonFile = await fetch(f.origin + '/api/partner/export?format=json', {headers});
  assert.match(jsonFile.headers.get('content-disposition') || '', /klarraum-report\.json/);
  const report = JSON.parse(await jsonFile.text());
  assert.equal(report.status, 'Accepted');
  assert.equal(report.quote, 154);
  assert.equal((await f.request('/api/partner/inbox')).status, 200);
  const db = new DatabaseSync(join(f.dir, 'klarraum.sqlite'));
  db.prepare('INSERT INTO partner_inbox(id,kind,job_id,employee_id,note,created_at) VALUES(?,?,?,?,?,?)').run('note-1', 'job_completed', null, null, '12 Linden St · report submitted', 1);
  db.close();
  const inbox = await f.request('/api/partner/inbox');
  assert.equal(inbox.data.items[0].kind, 'job_completed');
  assert.match(inbox.data.items[0].note, /report submitted/);
  assert.equal(typeof inbox.data.workersOut, 'number');
  const invoice = await fetch(f.origin + '/api/partner/export?format=invoice&id=inv-2026-10', {headers});
  assert.equal(invoice.status, 200);
  assert.match(invoice.headers.get('content-disposition') || '', /inv-2026-10\.txt/);
  assert.match(await invoice.text(), /KlarraumApp/);
  assert.equal((await f.request('/api/partner/calendar/connect', {method:'POST', body:{}})).status, 404);
});
