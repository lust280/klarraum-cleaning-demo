// Partner Admin zone smoke. Nine checks, one temporary server, no Stripe.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import { createServerApp } from '../server.mjs';
import { loadConfig } from '../lib/config.mjs';
import { hashPassword } from '../lib/security.mjs';
import { quoteEuros, jobDurationMinutes, DEMO_JOB, TRIAL_MS, MAGIC_MS, INVITE_MS } from '../lib/partner-admin.mjs';

const passwordHash = await hashPassword('test-only-partner-admin-password');
const HUB = ['Company profile', 'Service area', 'Service prices', 'Booking site', 'Booking mode', 'Billing / Connect', 'Language', 'Legal', 'Notifications', 'Google Calendar', 'Help'];
function chromePath() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  for (const path of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (existsSync(path)) return path;
  }
  return undefined;
}

async function boot() {
  const dir = await mkdtemp(join(tmpdir(), 'klarraum-smoke-'));
  let clock = Date.UTC(2026, 9, 25, 10);
  const config = {...loadConfig({DATA_DIR: dir}), passwordHash};
  const hosted = createServerApp(config, {now: () => clock});
  await new Promise(resolve => hosted.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${hosted.server.address().port}`;
  config.origin = origin;
  const jar = {cookie: '', csrf: ''};
  async function request(path, {method = 'GET', body, auth = true} = {}) {
    const response = await fetch(origin + path, {
      method,
      headers: {
        Origin: origin, Accept: 'application/json',
        ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
        ...(auth && jar.cookie ? {Cookie: jar.cookie} : {}),
        ...(auth && jar.csrf && method !== 'GET' ? {'X-CSRF-Token': jar.csrf} : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    const setCookie = response.headers.get('set-cookie');
    if (setCookie?.includes('klarraum_partner=')) jar.cookie = setCookie.split(';')[0];
    if (data?.workspace?.csrf) jar.csrf = data.workspace.csrf;
    else if (data?.csrf) jar.csrf = data.csrf;
    return {status: response.status, data};
  }
  return {origin, request, jar, advance(ms) { clock += ms; }, async close() { await new Promise(resolve => hosted.server.close(resolve)); await rm(dir, {recursive: true, force: true}); }};
}

describe('Partner Admin zone smoke', { concurrency: 1, timeout: 180000 }, () => {
  let origin;
  let request;
  let jar;
  let browser;
  let page;
  const stripeHits = [];

  let shared;
  before(async () => {
    shared = await boot();
    origin = shared.origin;
    request = shared.request;
    jar = shared.jar;
    browser = await chromium.launch({
      executablePath: chromePath(),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    page = await browser.newPage({viewport: {width: 390, height: 844}});
    page.setDefaultTimeout(20000);
    page.on('request', hit => { if (/stripe\.com/i.test(hit.url())) stripeHits.push(hit.url()); });
    page.on('pageerror', error => { throw error; });
  });

  after(async () => { await browser?.close(); await shared?.close(); });

  async function syncJar() {
    const cookies = await page.context().cookies();
    const token = cookies.find(cookie => cookie.name === 'klarraum_partner');
    if (!token) return null;
    jar.cookie = `klarraum_partner=${token.value}`;
    const session = await request('/api/partner/session');
    if (session.data?.csrf) jar.csrf = session.data.csrf;
    return session;
  }

  async function signIn() {
    await page.goto(origin + '/partner.html', {waitUntil: 'networkidle'});
    await page.waitForSelector('[data-screen="login"]');
    const login = await page.locator('[data-screen="login"]').innerText();
    assert.match(login, /For cleaning companies/);
    assert.match(login, /Continue with Google/);
    assert.match(login, /Send sign-in link/);
    assert.match(login, /See plans/);
    assert.match(login, /sam@linden\.example/);
    assert.equal(login.includes('Owner password'), false);
    assert.equal(login.includes('OWNER ACCESS'), false);
    assert.equal(/\bTeam\b/.test(login), false);
    assert.equal(/\bHelp\b/.test(login), false);
    assert.equal(/\bReports\b/.test(login), false);
    assert.equal(await page.locator('#toast').isHidden(), true);
    await page.getByRole('button', {name: 'Continue with Google'}).click();
    await page.waitForSelector('[data-screen="today"]');
    const today = await page.locator('[data-screen="today"]').innerText();
    assert.match(today, /New requests/);
    assert.match(today, /Jobs today/);
    assert.match(today, /Workers out/);
    assert.match(today, /Confirm/);
    assert.match(today, /Pro/);
    assert.equal(await page.locator('[data-screen="today"] a[aria-label="Menu"]').count(), 1);
    assert.equal(today.includes('Heute'), false);
    assert.equal(today.includes('Übersicht'), false);
    assert.equal(today.includes('Owner password'), false);
    await syncJar();
  }

  test('1. partner.html signs in owner Sam on Pro in Berlin', async () => {
    const html = await fetch(origin + '/partner.html');
    assert.equal(html.status, 200);
    assert.match(await html.text(), /KlarraumApp/);
    await signIn();
    const session = await request('/api/partner/session');
    assert.equal(session.status, 200);
    assert.equal(session.data.account.name, 'Sam Keller');
    assert.equal(session.data.account.owner, true);
    assert.equal(session.data.company.name, 'Linden Cleaning');
    assert.equal(session.data.company.timeZone, 'Europe/Berlin');
    assert.equal(session.data.company.currency, 'EUR');
    assert.equal(session.data.company.areaUnit, 'm2');
    assert.equal(session.data.plan.key, 'pro');
    assert.equal(session.data.plan.cents, 8900);
    assert.match(await page.locator('body').innerText(), /Sam|S/);
    assert.equal(page.url().includes('accounts.google.com'), false);
  });

  test('2. Settings hub matches B2 and omits Online booking and Connect later', async () => {
    await page.goto(origin + '/partner.html#settings', {waitUntil: 'networkidle'});
    await page.waitForSelector('[data-screen="settings"] .settings-list');
    const rows = (await page.locator('.settings-list a').allInnerTexts()).map(text => text.split('\n')[0].trim());
    assert.deepEqual(rows, HUB);
    const blob = rows.join('\n');
    assert.equal(blob.includes('Online booking'), false);
    assert.equal(blob.includes('Connect later'), false);
    const source = await readFile(new URL('../public/partner.js', import.meta.url), 'utf8');
    assert.equal(source.includes('Connect later'), false);
    assert.match(source, /Online booking OFF/);
  });

  test('3. Booking mode cycles and a finished trial reports paused without changing the saved mode', async () => {
    for (const mode of ['paused', 'request', 'instant']) {
      await page.goto(origin + '/partner.html#settings/booking-mode', {waitUntil: 'networkidle'});
      await page.locator(`input[value="${mode}"]`).check();
      await page.getByRole('button', {name: 'Save'}).click();
      await page.waitForSelector('#toast:not([hidden])');
      const live = await request('/api/partner/booking-mode', {auth: false});
      const config = await request('/api/config', {auth: false});
      assert.equal(live.data.bookingMode, mode);
      assert.equal(live.data.storedBookingMode, mode);
      assert.equal(config.data.bookingMode, mode);
      assert.equal(config.data.partnerBooking.bookingMode, mode);
      assert.equal(config.data.partnerBooking.storedBookingMode, mode);
    }
    const isolated = await boot();
    try {
    assert.equal((await isolated.request('/api/partner/auth/google', {method: 'POST', body: {}})).status, 200);
    assert.equal((await isolated.request('/api/partner/booking-mode', {method: 'PUT', body: {bookingMode: 'instant'}})).status, 200);
    assert.equal((await isolated.request('/api/partner/plan/preview-trial', {method: 'POST', body: {}})).status, 200);
    const paused = await isolated.request('/api/partner/booking-mode', {auth: false});
    const config = await isolated.request('/api/config', {auth: false});
    assert.equal(paused.data.bookingMode, 'paused');
    assert.equal(paused.data.storedBookingMode, 'instant');
    assert.equal(paused.data.trialPaused, true);
    assert.equal(config.data.partnerBooking.storedBookingMode, 'instant');
    assert.equal(config.data.bookingMode, 'paused');
    } finally { await isolated.close(); }
  });

  test('4. Service prices quote €154 and duration rounds up to 30 minutes', async () => {
    assert.equal(quoteEuros({rate: DEMO_JOB.ratePerM2, area: DEMO_JOB.areaM2, minimum: null}), 154);
    assert.equal(quoteEuros({rate: 2.2, area: 70, minimum: null}), 154);
    assert.equal(jobDurationMinutes(70, 30), 150);
    assert.equal(jobDurationMinutes(70, 40), 120);
    await page.goto(origin + '/partner.html#settings/prices', {waitUntil: 'networkidle'});
    await page.waitForSelector('[data-panel="service-prices"]');
    const text = await page.locator('[data-panel="service-prices"]').innerText();
    assert.match(text, /12 Linden St, 10115 Berlin/);
    assert.match(text, /70 m²/);
    assert.match(text, /€2\.20\/m² = €154\.00/);
    assert.match(text, /2 h 30 min/);
    assert.equal(await page.locator('input[name="home"]').inputValue(), '2.2');
    assert.equal(await page.locator('input[name="speed"]').inputValue(), '30');
  });

  test('5. Invites, seat rules, and owner-only plan and Connect', async () => {
    const before = await request('/api/partner/session');
    assert.equal(before.data.seats.used, 3);
    assert.equal(before.data.seats.included, 5);
    const people = [
      ['cleaner', 'Smoke Cleaner', 'cleaner-smoke@linden.example', '4 of 5'],
      ['helper', 'Smoke Helper', 'helper-smoke@linden.example', '5 of 5'],
      ['admin', 'Smoke Admin', 'admin-smoke@linden.example', '5 of 5'],
    ];
    for (const [role, name, email, seats] of people) {
      await page.goto(origin + '/partner.html#team/invite', {waitUntil: 'networkidle'});
      await page.locator('input[name="name"]').fill(name);
      await page.locator('input[name="email"]').fill(email);
      await page.locator('select[name="role"]').selectOption(role);
      await page.locator('select[name="language"]').selectOption(role === 'helper' ? 'de' : 'en');
      await page.getByRole('button', {name: 'Send invite'}).click();
      await page.waitForSelector('[data-screen="invite-sent"]');
      assert.match(await page.locator('[data-screen="invite-sent"]').innerText(), new RegExp(name));
      await page.goto(origin + '/partner.html#team', {waitUntil: 'networkidle'});
      await page.waitForSelector(`text=${seats}`);
    }
    const after = await request('/api/partner/session');
    assert.equal(after.data.seats.used, 5);
    assert.equal(after.data.team.filter(person => person.role === 'admin' && person.invite === 'pending').length, 1);
    await page.goto(origin + '/partner.html#settings/billing/plan', {waitUntil: 'networkidle'});
    await page.locator('details.demo summary').click();
    await page.getByRole('button', {name: 'View as Alex (admin)'}).click();
    await page.waitForSelector('text=Only the company owner');
    assert.equal(await page.getByRole('button', {name: 'Manage billing with Stripe'}).isDisabled(), true);
    await page.goto(origin + '/partner.html#settings/billing/change', {waitUntil: 'networkidle'});
    assert.equal(await page.getByRole('button', {name: 'Downgrade'}).isDisabled(), true);
    assert.equal(await page.getByRole('button', {name: 'Upgrade'}).isDisabled(), true);
    await page.goto(origin + '/partner.html#settings/billing', {waitUntil: 'networkidle'});
    assert.equal(await page.getByRole('button', {name: 'Connect Stripe'}).isDisabled(), true);
    await page.goto(origin + '/partner.html#settings/billing/plan', {waitUntil: 'networkidle'});
    await page.locator('details.demo summary').click();
    await page.getByRole('button', {name: 'View as Sam (owner)'}).click();
    await page.waitForFunction(() => !document.body.innerText.includes('Only the company owner'));
    await page.goto(origin + '/partner.html#settings/billing', {waitUntil: 'networkidle'});
    assert.equal(await page.getByRole('button', {name: 'Connect Stripe'}).isDisabled(), false);
  });

  test('6. Billing tabs and Connect stub states never call Stripe', async () => {
    stripeHits.length = 0;
    await page.goto(origin + '/partner.html#settings/billing', {waitUntil: 'networkidle'});
    await page.waitForSelector('[data-screen="billing-payments"]');
    const tabs = await page.locator('.tabs').innerText();
    assert.match(tabs, /Plan/);
    assert.match(tabs, /Customer payments/);
    assert.match(await page.locator('[data-screen="billing-payments"]').innerText(), /Not connected/);
    assert.match(await page.locator('body').innerText(), /Take card payments online/);
    await page.getByRole('button', {name: 'Connect Stripe'}).click();
    await page.waitForSelector('[data-screen="connect-mock"]');
    assert.match(page.url(), /\/partner\.html#connect\/mock$/);
    assert.equal(page.url().includes('stripe.com'), false);
    await page.getByRole('button', {name: 'Finish setup'}).click();
    await page.waitForSelector('text=Stripe connected');
    assert.match(await page.locator('body').innerText(), /acct_••••7Q2x/);
    await page.goto(origin + '/partner.html#connect/mock', {waitUntil: 'networkidle'});
    await page.getByRole('button', {name: 'Leave setup unfinished'}).click();
    await page.waitForSelector('text=Stripe setup not finished');
    assert.match(await page.locator('body').innerText(), /Incomplete/);
    assert.match(await page.locator('body').innerText(), /Nothing was charged/);
    await page.getByRole('button', {name: 'Retry setup'}).click();
    await page.getByRole('button', {name: 'Finish setup'}).click();
    await page.waitForSelector('text=Stripe connected');
    await page.getByRole('button', {name: 'Disconnect'}).click();
    await page.waitForSelector('#sheet[open]');
    assert.equal(await page.locator('#sheet h2').innerText(), 'Disconnect Stripe?');
    assert.match(await page.locator('#sheet').innerText(), /Online card payments will pause/);
    assert.match(await page.locator('#sheet').innerText(), /Cash on site keeps working/);
    await page.locator('#sheet').getByRole('button', {name: 'Cancel'}).click();
    await page.waitForSelector('#sheet', {state: 'hidden'});
    assert.equal(stripeHits.length, 0, stripeHits.join(','));
    const files = await Promise.all(['public/partner.js', 'public/partner.html', 'lib/partner-admin.mjs', 'lib/integrations.mjs', '.env.example'].map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')));
    const source = files.join('\n');
    assert.equal(source.includes('sk_live'), false);
    assert.equal(source.includes('checkout.stripe.com'), false);
    const started = await request('/api/partner/connect/start', {method: 'POST', body: {}});
    assert.equal(started.data.live, false);
    assert.equal(started.data.url.includes('stripe.com'), false);
  });

  test('7. Check-email, 15-minute link, 24-hour invite, DE onboarding, and 5-day trial screen', async () => {
    const auth = await boot();
    const browser2 = await chromium.launch({executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage']});
    const authPage = await browser2.newPage({viewport: {width: 390, height: 844}});
    authPage.setDefaultTimeout(20000);
    try {
      await authPage.goto(auth.origin + '/partner.html', {waitUntil: 'networkidle'});
      await authPage.getByRole('button', {name: 'Continue with Google'}).click();
      await authPage.waitForSelector('[data-screen="today"]');
      await authPage.goto(auth.origin + '/partner.html#team/invite', {waitUntil: 'networkidle'});
      await authPage.locator('input[name="name"]').fill('Expire Me');
      await authPage.locator('input[name="email"]').fill('expire-me@linden.example');
      await authPage.locator('select[name="role"]').selectOption('cleaner');
      await authPage.getByRole('button', {name: 'Send invite'}).click();
      await authPage.waitForSelector('[data-screen="invite-sent"]');
      const inviteUrl = (await authPage.locator('[data-screen="invite-sent"] strong').innerText()).trim();
      await authPage.getByRole('button', {name: 'Sign out'}).click();
      await authPage.waitForSelector('[data-screen="login"]');
      await authPage.locator('input[name="email"]').fill('sam@linden.example');
      await authPage.getByRole('button', {name: 'Send sign-in link'}).click();
      await authPage.waitForSelector('[data-screen="check-email"]');
      assert.match(await authPage.locator('[data-screen="check-email"]').innerText(), /Check your email/);
      assert.match(await authPage.locator('[data-screen="check-email"]').innerText(), /15 minutes/);
      auth.advance(MAGIC_MS);
      await authPage.getByRole('button', {name: 'Open sign-in link'}).click();
      await authPage.waitForSelector('[data-screen="link-expired"]');
      assert.match(await authPage.locator('h1').innerText(), /expired/i);
      auth.advance(INVITE_MS - MAGIC_MS);
      await authPage.goto(inviteUrl, {waitUntil: 'networkidle'});
      await authPage.waitForSelector('[data-screen="link-expired"]');
    } finally {
      await browser2.close();
      await auth.close();
    }

    const setup = await boot();
    const browser3 = await chromium.launch({executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage']});
    const setupPage = await browser3.newPage({viewport: {width: 390, height: 844}});
    setupPage.setDefaultTimeout(20000);
    try {
      assert.equal((await setup.request('/api/partner/demo/reset', {method: 'POST', body: {}})).status, 200);
      await setupPage.goto(setup.origin + '/partner.html', {waitUntil: 'networkidle'});
      await setupPage.getByRole('button', {name: 'Continue with Google'}).click();
      await setupPage.waitForSelector('[data-screen="onboarding"]');
      await setupPage.locator('select[name="country"]').selectOption('DE');
      await setupPage.waitForFunction(() => document.querySelector('#country-hint')?.textContent?.includes('Europe/Berlin'));
      const hint = await setupPage.locator('#country-hint').innerText();
      assert.match(hint, /EUR/);
      assert.match(hint, /m²/);
      assert.match(hint, /Europe\/Berlin/);
      await setupPage.getByRole('button', {name: 'Continue'}).click();
      await setupPage.waitForSelector('[data-screen="onboarding-site"]');
      await setupPage.locator('input[name="name"]').fill('Nord Clean');
      await setupPage.locator('input[name="slug"]').fill('nord-clean');
      await setupPage.getByRole('button', {name: 'Finish'}).click();
      await setupPage.waitForSelector('[data-screen="today"]');
      const session = await setupPage.evaluate(async () => (await fetch('api/partner/session')).json());
      assert.equal(session.company.currency, 'EUR');
      assert.equal(session.company.areaUnit, 'm2');
      assert.equal(session.company.timeZone, 'Europe/Berlin');
      assert.equal(session.plan.storedStatus, 'trial');
      assert.equal(session.plan.trialEndsAt - session.plan.trialStartedAt, TRIAL_MS);
      assert.equal(session.plan.paymentMethod, null);
      await setupPage.goto(setup.origin + '/partner.html#settings/billing/plan', {waitUntil: 'networkidle'});
      await setupPage.locator('details.demo summary').click();
      await setupPage.getByRole('button', {name: 'Preview trial ended'}).click();
      await setupPage.waitForSelector('[data-screen="trial-ended"]');
      const trial = await setupPage.locator('[data-screen="trial-ended"]').innerText();
      assert.match(trial, /Your free trial has ended/);
      assert.match(trial, /5 days/);
      assert.match(trial, /Choose Pro/);
    } finally {
      await browser3.close();
      await setup.close();
    }
  });

  test('8. Toast and confirm sheet', async () => {
    await page.goto(origin + '/partner.html#settings/booking-mode', {waitUntil: 'networkidle'});
    await page.locator('input[value="request"]').check();
    await page.getByRole('button', {name: 'Save'}).click();
    await page.waitForSelector('#toast:not([hidden])');
    assert.equal(await page.locator('#toast').innerText(), 'Saved');
    assert.equal(await page.locator('#toast').getAttribute('role'), 'status');
    await page.goto(origin + '/partner.html#settings/billing', {waitUntil: 'networkidle'});
    await page.getByRole('button', {name: 'Disconnect'}).click();
    await page.waitForSelector('#sheet[open]');
    assert.match(await page.locator('#sheet h2').innerText(), /Disconnect Stripe\?/);
    await page.locator('#sheet').getByRole('button', {name: 'Cancel'}).click();
    await page.waitForSelector('#sheet', {state: 'hidden'});
    assert.match(await page.locator('[data-screen="billing-payments"]').innerText(), /Stripe connected/);
    await page.goto(origin + '/partner.html#settings/site', {waitUntil: 'networkidle'});
    await page.locator('#toast').evaluate(node => { node.hidden = true; node.textContent = ''; });
    await page.getByRole('button', {name: 'Copy link'}).click();
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Copied');
  });

  test('9. Retired pilot screens redirect and Today no longer links to them', async () => {
    const redirects = {
      '/operations.html':'/partner.html#team',
      '/planning.html':'/ops.html',
      '/reports.html':'/partner.html#reports',
      '/system.html':'/partner.html#settings/help',
    };
    for (const [path, location] of Object.entries(redirects)) {
      const response = await fetch(origin + path, {redirect:'manual'});
      assert.equal(response.status, 301, path);
      assert.equal(response.headers.get('location'), location);
      const body = await response.text();
      assert.equal(body.includes('Planung'), false);
      assert.equal(body.includes('Monatsberichte'), false);
    }
    const admin = await fetch(origin + '/admin.html', {redirect:'manual'});
    assert.equal(admin.status, 301);
    assert.equal(admin.headers.get('location'), '/partner.html');
    const adminBody = await admin.text();
    assert.equal(adminBody.includes('Heute'), false);
    assert.equal(adminBody.includes('OWNER ACCESS'), false);
    assert.equal(adminBody.includes('Please sign in'), false);
    assert.equal(adminBody.includes('Owner password'), false);
    const partnerScript = await fetch(origin + '/partner.js').then(response => response.text());
    assert.match(partnerScript, /Continue with Google/);
    assert.match(partnerScript, /Send sign-in link/);
    assert.equal(partnerScript.includes('/admin.html'), false);
    assert.equal(partnerScript.includes('Owner password'), false);
    assert.equal(partnerScript.includes('Inbox opens with Partner Ops.'), false);
  });

  test('10. Bell, avatar, export and language are live controls', async () => {
    const isolated = await boot();
    try {
      await page.goto(isolated.origin + '/partner.html', {waitUntil: 'networkidle'});
      await page.getByRole('button', {name: 'Continue with Google'}).click();
      await page.waitForSelector('[data-screen="today"]');
      await page.getByRole('link', {name: 'Inbox'}).click();
      await page.waitForSelector('[data-screen="inbox"]');
      const inbox = await page.locator('[data-screen="inbox"]').innerText();
      assert.match(inbox, /No notifications yet/);
      assert.equal(await page.locator('#toast').isHidden(), true);
      await page.getByRole('link', {name: 'Your plan'}).click();
      await page.waitForSelector('[data-screen="billing-plan"]');
      assert.match(await page.locator('[data-screen="billing-plan"]').innerText(), /Pro/);
      await page.goto(isolated.origin + '/partner.html#reports', {waitUntil: 'networkidle'});
      await page.getByRole('button', {name: 'Export'}).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', {name: 'Download CSV'}).click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /klarraum-report\.csv/);
      await page.goto(isolated.origin + '/partner.html#settings/language', {waitUntil: 'networkidle'});
      await page.locator('input[name="language"][value="de"]').check();
      await page.getByRole('button', {name: 'Save'}).click();
      await page.waitForFunction(() => /Sprache/.test(document.body.innerText) && /Speichern/.test(document.body.innerText));
      await page.goto(isolated.origin + '/partner.html#today', {waitUntil: 'networkidle'});
      const today = await page.locator('[data-screen="today"]').innerText();
      assert.match(today, /Heute/);
      assert.match(today, /Neue Anfragen/);
      assert.match(today, /Bestätigen/);
      await page.locator('input[name="language"], a[href="#settings/language"]').first();
      await page.goto(isolated.origin + '/partner.html#settings/language', {waitUntil: 'networkidle'});
      await page.locator('input[name="language"][value="ru"]').check();
      await page.getByRole('button', {name: 'Speichern'}).click();
      await page.waitForFunction(() => /Язык/.test(document.body.innerText));
      await page.goto(isolated.origin + '/partner.html#today', {waitUntil: 'networkidle'});
      assert.match(await page.locator('[data-screen="today"]').innerText(), /Сегодня/);
      assert.match(await page.locator('[data-screen="today"]').innerText(), /Подтвердить/);
    } finally {
      await isolated.close();
    }
  });

  test('11. Desktop hides the mobile Menu page; a phone still has one', async () => {
    const context = await browser.newContext();
    const wide = await context.newPage();
    const phone = await context.newPage();
    try {
      await wide.setViewportSize({width:1280, height:800});
      await wide.goto(origin + '/partner.html', {waitUntil:'domcontentloaded'});
      await wide.getByRole('button', {name:'Continue with Google'}).click();
      await wide.waitForSelector('[data-screen="today"]');
      await wide.goto(origin + '/partner.html#menu', {waitUntil:'domcontentloaded'});
      await wide.waitForSelector('[data-screen="today"]');
      assert.equal(wide.url().includes('#menu'), false);
      assert.equal(await wide.locator('.nav-list').count(), 0);
      assert.equal(await wide.locator('.side').count(), 1);
      assert.equal(await wide.locator('h1').innerText(), 'Today');
      await wide.goto(origin + '/partner.html#team', {waitUntil:'domcontentloaded'});
      await wide.waitForSelector('[data-screen="team"]');
      await wide.locator('.side .brand').click();
      await wide.waitForSelector('[data-screen="today"]');
      assert.equal(wide.url().includes('#menu'), false);
      await wide.goto(origin + '/partner.html#not-a-partner-route', {waitUntil:'domcontentloaded'});
      await wide.waitForSelector('[data-screen="today"]');
      assert.equal(await wide.locator('.nav-list').count(), 0);
      await phone.setViewportSize({width:390, height:844});
      await phone.goto(origin + '/partner.html#menu', {waitUntil:'domcontentloaded'});
      await phone.waitForSelector('[data-screen="menu"]');
      const menu = await phone.locator('[data-screen="menu"]').innerText();
      assert.match(menu, /Menu/);
      assert.match(menu, /Today/);
      assert.match(menu, /Jobs/);
      assert.match(menu, /Team/);
      assert.match(menu, /Reports/);
      assert.match(menu, /Settings/);
      assert.equal(await phone.locator('.side').count(), 0);
      assert.equal(await phone.locator('a[aria-label="Back"]').count(), 1);
      await phone.locator('a[aria-label="Back"]').click();
      await phone.waitForSelector('[data-screen="today"]');
      assert.equal(await phone.locator('a[aria-label="Menu"]').count(), 1);
    } finally {
      await context.close();
    }
  });
});
