// Partner Admin owns plan cards, booking_mode, auth links, Connect stubs and
// the refund decision. Partner Ops calls classifyRefund / jobDurationMinutes.
// Client calls publicBooking() (also GET /api/partner/booking-mode and /api/config).
// Connect never calls Stripe. Customer card money is a future direct charge on
// the company's own Express account, not a charge through the operator.

import { randomUUID } from 'node:crypto';
import { digest, randomToken } from './security.mjs';
import { HttpError } from './validation.mjs';
import { connectOnboardingStub } from './integrations.mjs';

export const TRIAL_DAYS = 5;
export const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;
export const MAGIC_MS = 15 * 60 * 1000;
export const INVITE_MS = 24 * 60 * 60 * 1000;
export const SESSION_MS = 8 * 60 * 60 * 1000;
export const SQFT_PER_M2 = 10.76391041671;
export const DEMO_JOB = Object.freeze({
  address: '12 Linden St, 10115 Berlin',
  areaM2: 70,
  ratePerM2: 2.2,
  quote: 154,
  currency: 'EUR',
  payment: 'Unpaid',
});

export const PLANS = Object.freeze({
  starter: Object.freeze({key:'starter', name:'Starter', cents:4900, seats:2, support:'Email and the Help thread'}),
  pro: Object.freeze({key:'pro', name:'Pro', cents:8900, seats:5, support:'Priority support'}),
  plus: Object.freeze({key:'plus', name:'Plus', cents:14900, seats:10, support:'Priority support and a personal contact'}),
});
const PLAN_ORDER = ['starter', 'pro', 'plus'];
export const SHARED_FEATURES = Object.freeze([
  'Branded booking site and calculator',
  'Jobs, assignment, worker app, photos and reports (12 months)',
  'Booking mode: Paused, Request or Instant',
  'Pay on site and Stripe Connect',
  'English, Deutsch and Russian',
  'Reports and export',
]);

export const COUNTRIES = Object.freeze({
  DE: Object.freeze({label:'Germany', currency:'EUR', areaUnit:'m2', timeZone:'Europe/Berlin'}),
  AT: Object.freeze({label:'Austria', currency:'EUR', areaUnit:'m2', timeZone:'Europe/Vienna'}),
  CH: Object.freeze({label:'Switzerland', currency:'EUR', areaUnit:'m2', timeZone:'Europe/Zurich'}),
  GB: Object.freeze({label:'United Kingdom', currency:'GBP', areaUnit:'sqft', timeZone:'Europe/London'}),
  US: Object.freeze({label:'United States', currency:'USD', areaUnit:'sqft', timeZone:'America/New_York'}),
});

const BOOKING_MODES = new Set(['paused', 'request', 'instant']);
const ROLES = new Set(['cleaner', 'helper', 'admin']);
const LANGUAGES = new Set(['en', 'de', 'ru']);
const CURRENCIES = new Set(['EUR', 'USD', 'GBP']);
const UNITS = new Set(['m2', 'sqft']);
const ZONES = new Set(['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles']);
const HOUR_DAYS = new Set(['mon-sat', 'mon-fri', 'daily']);
const COOKIE = 'klarraum_partner';
const STATE_KEY = 'partner_admin';

export function nextPlanKey(key) {
  const index = PLAN_ORDER.indexOf(key);
  return index >= 0 && index < PLAN_ORDER.length - 1 ? PLAN_ORDER[index + 1] : null;
}

export function quoteEuros({rate, area, minimum} = {}) {
  const rateN = Number(rate);
  const areaN = Number(area);
  if (!(rateN > 0) || !(areaN > 0)) throw new RangeError('Rate and area must be positive.');
  const minimumN = minimum == null || minimum === '' ? 0 : Number(minimum);
  if (!Number.isFinite(minimumN) || minimumN < 0) throw new RangeError('Minimum price is invalid.');
  return Math.round(Math.max(rateN * areaN, minimumN) * 100) / 100;
}

export function jobDurationMinutes(areaM2, speedM2PerHour = 30) {
  const areaN = Number(areaM2);
  const speedN = Number(speedM2PerHour);
  if (!(areaN > 0) || !(speedN > 0)) throw new RangeError('Area and speed must be positive.');
  return (Math.ceil((areaN / speedN) * 2) / 2) * 60;
}

export function seatsUsed(team = []) {
  return team.filter(member => member && member.active !== false && (member.role === 'cleaner' || member.role === 'helper') && !['expired', 'declined', 'revoked'].includes(member.invite)).length;
}

export function classifyRefund(input = {}) {
  const payment = input.payment;
  if (payment !== 'Paid online') return {action:'none', payment: payment || 'Unpaid', refund:false};
  if (input.started) return {action:'none', payment, refund:false, note:'Visit already started'};
  if (input.actor === 'partner_cancel' || input.actor === 'partner_decline') {
    return {action:'auto_refund', payment:'Refunded', refund:true, reason:'partner'};
  }
  if (input.actor === 'client_cancel') {
    if (Number(input.hoursUntilVisit) > 24) return {action:'auto_refund', payment:'Refunded', refund:true, reason:'more_than_24h'};
    if (input.choice === 'refund') return {action:'refund', payment:'Refunded', refund:true, reason:'partner_choice'};
    if (input.choice === 'keep' || Number(input.hoursSinceAsk) >= 48) {
      return {action:'keep', payment:'Paid online', refund:false, reason: input.choice === 'keep' ? 'partner_choice' : 'timeout_48h'};
    }
    return {action:'ask_partner', payment:'Paid online', refund:false, deadlineHours:48, inbox:true};
  }
  return {action:'none', payment, refund:false};
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function fail(status, message, code = '', details) {
  const error = new HttpError(status, message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function text(value, max, label, required = false) {
  if ((value == null || value === '') && !required) return '';
  if (typeof value !== 'string') fail(400, `${label} is invalid.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) fail(400, `${label} is invalid.`);
  return result;
}

function emailOf(value, label = 'Email') {
  const email = text(value, 254, label, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email.');
  return email;
}

function numberOf(value, label) {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) fail(400, `${label} is invalid.`);
  return number;
}

function planView(key) {
  const plan = PLANS[key];
  if (!plan) return null;
  return {
    key: plan.key, name: plan.name, cents: plan.cents, seats: plan.seats, support: plan.support,
    highlights: [`${plan.seats} seats (cleaners and helpers)`, 'Branded booking site', 'Jobs, photos and reports (12 months)', plan.support],
  };
}

function accessOf(state, now) {
  if (!state.onboardingComplete) return {mode:'onboarding', reason:''};
  const trialOver = state.plan.status === 'trial' && state.plan.trialEndsAt != null && state.plan.trialEndsAt <= now;
  if (state.plan.status === 'ended' || trialOver) return {mode:'readonly', reason:'trial-ended'};
  return {mode:'full', reason:''};
}
function homeScreen(state, now) {
  const mode = accessOf(state, now).mode;
  if (mode === 'onboarding') return 'onboarding';
  if (mode === 'readonly') return 'trial';
  return 'today';
}

export function effectiveBookingMode(state, now) {
  return accessOf(state, now).mode === 'readonly' ? 'paused' : state.bookingMode;
}

function blankState() {
  return {
    onboardingComplete: false,
    company: {
      name:'', country:'', currency:'EUR', areaUnit:'m2', timeZone:'Europe/Berlin',
      phone:'', email:'', address:'', language:'en',
      workingHours:{days:'mon-sat', start:'08:00', end:'18:00'},
    },
    plan: {key:'pro', status:'pending', trialStartedAt:null, trialEndsAt:null, cancelAtPeriodEnd:false, paymentMethod:null},
    bookingMode: 'request',
    prices: {home:2.2, office:1.8, deep:3.5, minimum:null, maxAreaM2:null, speedM2PerHour:30},
    serviceArea: [],
    connect: {status:'disconnected', accountLabel:'', bankLabel:'', cardPayments:false},
    team: [],
    accounts: [],
    notifications: {requests:true, schedule:true, payments:true, trial:true},
    legal: {note:''},
    help: [],
    invoices: [],
    bookingSite: {slug:''},
  };
}

function demoState() {
  const state = blankState();
  state.onboardingComplete = true;
  state.company = {
    name:'Linden Cleaning', country:'DE', currency:'EUR', areaUnit:'m2', timeZone:'Europe/Berlin',
    phone:'+49 30 12000000', email:'hello@linden.example', address:'Linienstraße 12, 10115 Berlin',
    language:'en', workingHours:{days:'mon-sat', start:'08:00', end:'18:00'},
  };
  state.plan = {
    key:'pro', status:'active', trialStartedAt:null, trialEndsAt:null, cancelAtPeriodEnd:false,
    paymentMethod:{brand:'Visa', last4:'4242', demo:true},
  };
  state.invoices = [
    {id:'inv-2026-10', date:'2026-10-12', label:'Oct 12, 2026', cents:8900, status:'Paid'},
    {id:'inv-2026-09', date:'2026-09-12', label:'Sep 12, 2026', cents:8900, status:'Paid'},
    {id:'inv-2026-08', date:'2026-08-12', label:'Aug 12, 2026', cents:8900, status:'Paid'},
  ];
  state.bookingSite = {slug:'linden'};
  state.serviceArea = ['10115', '10117', '10119'];
  state.accounts = [
    {id:'sam', email:'sam@linden.example', name:'Sam Keller', role:'admin', owner:true, active:true},
    {id:'alex', email:'alex@linden.example', name:'Alex Berg', role:'admin', owner:false, active:true},
  ];
  state.team = [
    {id:'sarah', name:'Sarah Jenkins', email:'sarah@linden.example', role:'cleaner', active:true, invite:'accepted', availability:'available', language:'en'},
    {id:'mike', name:'Mike Chen', email:'mike@linden.example', role:'cleaner', active:true, invite:'accepted', availability:'on_job', language:'en'},
    {id:'lisa', name:'Lisa Wong', email:'lisa@linden.example', role:'cleaner', active:true, invite:'accepted', availability:'available', language:'en'},
  ];
  return state;
}

function priceView(state) {
  const unit = state.company.areaUnit === 'sqft' ? 'sqft' : 'm2';
  const show = m2 => m2 == null ? null : round(unit === 'sqft' ? m2 * SQFT_PER_M2 : m2, 2);
  const showRate = perM2 => round(unit === 'sqft' ? perM2 / SQFT_PER_M2 : perM2, 2);
  return {
    currency: state.company.currency,
    areaUnit: unit,
    home: state.prices.home, office: state.prices.office, deep: state.prices.deep,
    homeDisplay: showRate(state.prices.home), officeDisplay: showRate(state.prices.office), deepDisplay: showRate(state.prices.deep),
    minimum: state.prices.minimum, maxAreaM2: state.prices.maxAreaM2, maxAreaDisplay: show(state.prices.maxAreaM2),
    speedM2PerHour: state.prices.speedM2PerHour, speedDisplay: show(state.prices.speedM2PerHour),
    sampleQuote: quoteEuros({rate:state.prices.home, area:DEMO_JOB.areaM2, minimum:state.prices.minimum}),
    sampleDurationMinutes: jobDurationMinutes(DEMO_JOB.areaM2, state.prices.speedM2PerHour),
  };
}

function present(state, account, now, extras) {
  const access = accessOf(state, now);
  const plan = PLANS[state.plan.key] || PLANS.pro;
  const used = seatsUsed(state.team);
  const nextKey = nextPlanKey(state.plan.key);
  return {
    csrf: extras.csrf || '',
    demoControls: Boolean(extras.demoControls),
    account: account ? {id:account.id, name:account.name, email:account.email, owner:Boolean(account.owner), role:account.role} : null,
    access,
    company: state.company,
    onboardingComplete: state.onboardingComplete,
    countries: Object.entries(COUNTRIES).map(([key, value]) => ({key, ...value})),
    plan: {
      ...planView(state.plan.key),
      status: access.reason === 'trial-ended' ? 'ended' : state.plan.status,
      storedStatus: state.plan.status,
      trialStartedAt: state.plan.trialStartedAt,
      trialEndsAt: state.plan.trialEndsAt,
      trialDays: TRIAL_DAYS,
      cancelAtPeriodEnd: Boolean(state.plan.cancelAtPeriodEnd),
      paymentMethod: state.plan.paymentMethod,
      nextInvoice: state.invoices.length ? {date:'2026-11-12', label:'November 12, 2026', shortLabel:'Nov 12, 2026', cents:plan.cents} : null,
    },
    plans: PLAN_ORDER.map(planView),
    sharedFeatures: SHARED_FEATURES,
    seats: {used, included: plan.seats, next: nextKey ? planView(nextKey) : null},
    bookingMode: state.bookingMode,
    publicBookingMode: effectiveBookingMode(state, now),
    connect: {
      status: state.connect.status,
      accountLabel: state.connect.accountLabel,
      bankLabel: state.connect.bankLabel,
      cardPayments: Boolean(state.connect.cardPayments),
      live: false,
    },
    prices: priceView(state),
    serviceArea: state.serviceArea,
    team: state.team.map(member => ({
      id:member.id, name:member.name, email:member.email, role:member.role, active:member.active !== false,
      invite:member.invite, availability:member.availability || '', language:member.language || 'en',
    })),
    admins: state.accounts.filter(item => item.active !== false).map(item => ({id:item.id, name:item.name, email:item.email, owner:Boolean(item.owner)})),
    notifications: state.notifications,
    legal: state.legal,
    help: state.help,
    bookingSite: state.bookingSite,
    invoices: state.invoices,
    report: {...DEMO_JOB, status:'Accepted'},
    integrations: extras.integrations,
  };
}

function projectPublic(state, now) {
  const mode = state ? effectiveBookingMode(state, now) : 'request';
  const stored = state?.bookingMode || 'request';
  return {
    bookingMode: mode,
    storedBookingMode: stored,
    trialPaused: Boolean(state) && mode !== stored,
    currency: state?.company.currency || 'EUR',
    areaUnit: state?.company.areaUnit || 'm2',
    cardPayments: Boolean(state?.connect.cardPayments) && mode !== 'paused',
    connectOn: state?.connect.status === 'connected',
    company: state ? {name:state.company.name, phone:state.company.phone, email:state.company.email} : {name:'', phone:'', email:''},
    prices: state ? {
      home: state.prices.home, office: state.prices.office, deep: state.prices.deep,
      minimum: state.prices.minimum, maxAreaM2: state.prices.maxAreaM2, speedM2PerHour: state.prices.speedM2PerHour,
    } : {home:2.2, office:1.8, deep:3.5, minimum:null, maxAreaM2:null, speedM2PerHour:30},
    demoJob: DEMO_JOB,
  };
}

export function createPartnerAdmin({store, config, now}) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS partner_sessions (
      token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS partner_tokens (
      token_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, email TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);`);

  function load() {
    const row = db.prepare('SELECT value FROM metadata WHERE key=?').get(STATE_KEY);
    return row ? JSON.parse(row.value) : null;
  }
  function save(state) {
    db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(STATE_KEY, JSON.stringify(state));
  }
  function ensure() {
    let state = load();
    if (!state) { state = demoState(); save(state); }
    return state;
  }
  function sweep(state) {
    const clock = now();
    const rows = db.prepare("SELECT payload FROM partner_tokens WHERE purpose='invite' AND expires_at<=?").all(clock);
    let changed = false;
    for (const row of rows) {
      const payload = JSON.parse(row.payload);
      const member = state.team.find(item => item.id === payload.memberId);
      if (member && member.invite === 'pending') { member.invite = 'expired'; member.active = false; changed = true; }
    }
    if (rows.length) db.prepare('DELETE FROM partner_tokens WHERE expires_at<=?').run(clock);
    db.prepare('DELETE FROM partner_sessions WHERE expires_at<=?').run(clock);
    if (changed) save(state);
    return state;
  }
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { try { db.exec('ROLLBACK'); } catch { /* rollback already closed */ } throw error; }
  }
  function cookie(token, age) {
    const path = config.basePath ? `${config.basePath}/` : '/';
    return `${COOKIE}=${token}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${age}${config.secureCookie ? '; Secure' : ''}`;
  }
  function readCookie(req) {
    const parts = String(req.headers.cookie || '').split(';').map(part => part.trim());
    const found = parts.find(part => part.startsWith(`${COOKIE}=`));
    const value = found ? found.slice(COOKIE.length + 1) : '';
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
  }
  function openSession(accountId) {
    const token = randomToken();
    const csrf = randomToken();
    db.prepare('INSERT INTO partner_sessions(token_hash,csrf,account_id,expires_at) VALUES(?,?,?,?)').run(digest(token), csrf, accountId, now() + SESSION_MS);
    return {token, csrf};
  }
  function accountById(state, id) {
    return state.accounts.find(item => item.id === id && item.active !== false) || null;
  }
  function extras(csrf) {
    return {
      csrf, demoControls: !config.production,
      integrations: {stripeLive:false, stripeKeysPresent:Boolean(config.integrations?.stripe), googleCalendar:Boolean(config.integrations?.googleCalendar)},
    };
  }
  function workspace(state, account, csrf) {
    return present(sweep(state), account, now(), extras(csrf));
  }
  function sessionRow(req) {
    const token = readCookie(req);
    if (!token) fail(401, 'Sign in required.', 'auth');
    const row = db.prepare('SELECT * FROM partner_sessions WHERE token_hash=?').get(digest(token));
    if (!row || row.expires_at <= now()) fail(401, 'Sign in required.', 'auth');
    return row;
  }
  function signed(req) {
    const row = sessionRow(req);
    if ((req.headers['x-csrf-token'] || '') !== row.csrf) fail(403, 'Refresh the page and try again.', 'csrf');
    const state = sweep(ensure());
    const account = accountById(state, row.account_id);
    if (!account) fail(401, 'Sign in required.', 'auth');
    return {row, state, account};
  }
  function mutable(state) {
    const access = accessOf(state, now());
    if (access.mode === 'onboarding') fail(409, 'Finish company setup first.', 'onboarding');
    if (access.mode === 'readonly') fail(403, 'The free trial has ended. Billing, Help and Export stay open.', 'trial_ended');
  }
  function ownerOnly(account) {
    if (!account.owner) fail(403, 'Only the company owner can change the plan or Connect.', 'owner_only');
  }
  function issueToken(purpose, email, payload, ttl) {
    const token = randomToken();
    db.prepare('INSERT INTO partner_tokens(token_hash,purpose,email,payload,expires_at) VALUES(?,?,?,?,?)').run(digest(token), purpose, email, JSON.stringify(payload || {}), now() + ttl);
    return token;
  }
  function startTrial(state, email, name) {
    const account = {id:randomUUID(), email, name: name || email.split('@')[0], role:'admin', owner:true, active:true};
    state.accounts = [account];
    state.plan = {key:'pro', status:'trial', trialStartedAt:now(), trialEndsAt:now() + TRIAL_MS, cancelAtPeriodEnd:false, paymentMethod:null};
    state.onboardingComplete = false;
    state.invoices = [];
    return account;
  }
  function applyCountry(state, country) {
    const preset = COUNTRIES[country];
    if (!preset) fail(400, 'Choose a country.');
    state.company.country = country;
    state.company.currency = preset.currency;
    state.company.areaUnit = preset.areaUnit;
    state.company.timeZone = preset.timeZone;
  }
  function seatFailure(reason, planKey, used, currentKey) {
    const plan = PLANS[planKey];
    const current = PLANS[currentKey] || plan;
    const nextKey = nextPlanKey(current.key);
    fail(409, reason === 'downgrade' ? `${plan.name} includes ${plan.seats} seats and ${used} are in use.` : 'All seats are in use.', 'seat_limit', {
      reason, plan: planKey, used, included: plan.seats,
      next: nextKey ? planView(nextKey) : null,
      current: planView(current.key),
    });
  }

  function publicBooking() {
    const state = load();
    if (!state) return projectPublic(null, now());
    return projectPublic(sweep(state), now());
  }

  async function handle(req, res, url, tools) {
    const {json, readJson, checkOrigin, limiter, clientKey} = tools;
    const path = url.pathname;
    const method = req.method;
    const send = (status, body, extra) => json(res, status, body, extra);
    try {
      if (path === '/api/partner/booking-mode' && method === 'GET') return send(200, publicBooking());
      if (method === 'POST' || method === 'PUT' || method === 'DELETE') checkOrigin(req);

      if (path === '/api/partner/demo/reset' && method === 'POST') {
        if (config.production) fail(404, 'Not found.');
        await readJson(req);
        tx(() => {
          save(blankState());
          db.prepare('DELETE FROM partner_sessions').run();
          db.prepare('DELETE FROM partner_tokens').run();
        });
        return send(200, {ok:true});
      }

      if (path === '/api/partner/auth/google' && method === 'POST') {
        await readJson(req);
        if (!limiter.allow(`partner-auth:${clientKey(req)}`, 10, 900000, now())) fail(429, 'Too many attempts. Wait a few minutes.', 'rate');
        const result = tx(() => {
          const state = ensure();
          let account = state.accounts.find(item => item.owner && item.active !== false);
          if (!account) account = startTrial(state, 'demo-owner@linden.example', 'Sam Keller');
          save(state);
          const session = openSession(account.id);
          return {session, body:{ok:true, next: homeScreen(state, now()), workspace: workspace(state, account, session.csrf)}};
        });
        return send(200, result.body, {'Set-Cookie': cookie(result.session.token, SESSION_MS / 1000)});
      }

      if (path === '/api/partner/auth/start' && method === 'POST') {
        const body = await readJson(req);
        if (!limiter.allow(`partner-auth:${clientKey(req)}`, 10, 900000, now())) fail(429, 'Too many attempts. Wait a few minutes.', 'rate');
        const mode = body?.mode === 'signup' ? 'signup' : 'signin';
        const email = emailOf(body?.email);
        const state = ensure();
        const known = state.accounts.find(item => item.email === email && item.active !== false);
        if (mode === 'signin') {
          if (!known) return send(202, {ok:true, next:'check-email', matched:false});
          const token = issueToken('magic', email, {}, MAGIC_MS);
          return send(202, {ok:true, next:'check-email', matched:true, email, continueToken: config.production ? undefined : token, expiresInMinutes:15});
        }
        if (state.accounts.some(item => item.owner)) return send(202, {ok:true, next:'check-email', matched:false, reason:'company_exists'});
        const token = issueToken('signup', email, {}, MAGIC_MS);
        return send(202, {ok:true, next:'check-email', matched:true, email, continueToken: config.production ? undefined : token, expiresInMinutes:15});
      }

      if (path === '/api/partner/auth/consume' && method === 'POST') {
        const body = await readJson(req);
        if (!limiter.allow(`partner-auth:${clientKey(req)}`, 10, 900000, now())) fail(429, 'Too many attempts. Wait a few minutes.', 'rate');
        const raw = text(body?.token, 80, 'Link', true);
        const result = tx(() => {
          const row = db.prepare('SELECT * FROM partner_tokens WHERE token_hash=?').get(digest(raw));
          if (!row || row.expires_at <= now() || !['magic', 'signup'].includes(row.purpose)) {
            if (row) db.prepare('DELETE FROM partner_tokens WHERE token_hash=?').run(row.token_hash);
            fail(410, 'This link has expired.', 'expired');
          }
          db.prepare('DELETE FROM partner_tokens WHERE token_hash=?').run(row.token_hash);
          const state = ensure();
          let account = state.accounts.find(item => item.email === row.email && item.active !== false);
          if (row.purpose === 'signup') {
            if (state.accounts.some(item => item.owner)) fail(409, 'This company already has an owner.', 'company_exists');
            account = startTrial(state, row.email);
          }
          if (!account) fail(410, 'This link has expired.', 'expired');
          save(state);
          const session = openSession(account.id);
          const access = accessOf(state, now());
          return {session, body:{ok:true, next: homeScreen(state, now()), workspace: workspace(state, account, session.csrf)}};
        });
        return send(200, result.body, {'Set-Cookie': cookie(result.session.token, SESSION_MS / 1000)});
      }

      if (path === '/api/partner/invites/lookup' && method === 'POST') {
        const body = await readJson(req);
        const raw = text(body?.token, 80, 'Link', true);
        const row = db.prepare('SELECT * FROM partner_tokens WHERE token_hash=?').get(digest(raw));
        if (!row || row.purpose !== 'invite' || row.expires_at <= now()) {
          if (row?.purpose === 'invite') {
            const state = ensure();
            const payload = JSON.parse(row.payload);
            const member = state.team.find(item => item.id === payload.memberId);
            if (member && member.invite === 'pending') { member.invite = 'expired'; member.active = false; save(state); }
            db.prepare('DELETE FROM partner_tokens WHERE token_hash=?').run(row.token_hash);
          }
          return send(410, {ok:false, code:'expired', error:'This link has expired.'});
        }
        const payload = JSON.parse(row.payload);
        const [local, domain] = row.email.split('@');
        return send(200, {ok:true, role:payload.role, name:payload.name, language:payload.language, emailMasked:`${local.slice(0, 1)}***@${domain}`, expiresAt:row.expires_at});
      }

      if (path === '/api/partner/invites/accept' && method === 'POST' || path === '/api/partner/invites/decline' && method === 'POST') {
        const decline = path.endsWith('/decline');
        const body = await readJson(req);
        const raw = text(body?.token, 80, 'Link', true);
        const result = tx(() => {
          const row = db.prepare('SELECT * FROM partner_tokens WHERE token_hash=?').get(digest(raw));
          if (!row || row.purpose !== 'invite' || row.expires_at <= now()) fail(410, 'This link has expired.', 'expired');
          const payload = JSON.parse(row.payload);
          const state = ensure();
          const member = state.team.find(item => item.id === payload.memberId);
          if (!member || member.invite !== 'pending') fail(410, 'This link has expired.', 'expired');
          db.prepare('DELETE FROM partner_tokens WHERE token_hash=?').run(row.token_hash);
          if (decline) {
            member.invite = 'declined';
            member.active = false;
            save(state);
            return {body:{ok:true, next:'declined'}};
          }
          member.invite = 'accepted';
          member.active = true;
          if (member.role === 'admin') {
            let account = state.accounts.find(item => item.email === member.email);
            if (!account) {
              account = {id:randomUUID(), email:member.email, name:member.name, role:'admin', owner:false, active:true};
              state.accounts.push(account);
            } else account.active = true;
            save(state);
            const session = openSession(account.id);
            return {session, body:{ok:true, next: homeScreen(state, now()), workspace: workspace(state, account, session.csrf)}};
          }
          save(state);
          return {body:{ok:true, next:'worker', note:'The seat is reserved. The worker signs in from the worker app.'}};
        });
        return send(200, result.body, result.session ? {'Set-Cookie': cookie(result.session.token, SESSION_MS / 1000)} : undefined);
      }

      if (path === '/api/partner/session' && method === 'GET') {
        const row = sessionRow(req);
        const state = sweep(ensure());
        const account = accountById(state, row.account_id);
        if (!account) fail(401, 'Sign in required.', 'auth');
        return send(200, workspace(state, account, row.csrf));
      }

      if (path === '/api/partner/auth/logout' && method === 'POST') {
        const row = sessionRow(req);
        if ((req.headers['x-csrf-token'] || '') !== row.csrf) fail(403, 'Refresh the page and try again.', 'csrf');
        await readJson(req).catch(() => ({}));
        db.prepare('DELETE FROM partner_sessions WHERE token_hash=?').run(row.token_hash);
        return send(200, {ok:true}, {'Set-Cookie': cookie('', 0)});
      }

      if (path === '/api/partner/auth/demo-as' && method === 'POST') {
        if (config.production) fail(404, 'Not found.');
        const {state} = signed(req);
        const body = await readJson(req);
        const account = accountById(state, text(body?.accountId, 80, 'Account', true));
        if (!account) fail(404, 'That admin was not found.');
        const session = openSession(account.id);
        return send(200, {ok:true, workspace: workspace(state, account, session.csrf)}, {'Set-Cookie': cookie(session.token, SESSION_MS / 1000)});
      }

      const auth = () => signed(req);

      if (path === '/api/partner/onboarding' && method === 'POST') {
        const {state, account, row} = auth();
        applyCountry(state, text((await readJson(req))?.country, 8, 'Country', true));
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }
      if (path === '/api/partner/onboarding/site' && method === 'POST') {
        const {state, account, row} = auth();
        const body = await readJson(req);
        const name = text(body?.name, 80, 'Company name', true);
        const slug = text(body?.slug, 40, 'Booking link', true).toLowerCase();
        const person = text(body?.person, 80, 'Your name') || account.name;
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(400, 'Use a short booking link with letters, numbers and dashes.');
        state.company.name = name;
        state.bookingSite.slug = slug;
        account.name = person;
        const stored = state.accounts.find(item => item.id === account.id);
        if (stored) stored.name = person;
        state.onboardingComplete = true;
        if (!state.bookingMode) state.bookingMode = 'request';
        save(state);
        return send(200, {ok:true, next: homeScreen(state, now()), workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/company' && method === 'PUT') {
        const {state, account, row} = auth();
        mutable(state);
        const body = await readJson(req);
        const currency = text(body?.currency, 3, 'Currency', true);
        const areaUnit = text(body?.areaUnit, 8, 'Area unit', true);
        const timeZone = text(body?.timeZone, 64, 'Time zone', true);
        const days = text(body?.days, 16, 'Working days', true);
        const start = text(body?.start, 5, 'Start', true);
        const end = text(body?.end, 5, 'End', true);
        if (!CURRENCIES.has(currency) || !UNITS.has(areaUnit) || !ZONES.has(timeZone) || !HOUR_DAYS.has(days)) fail(400, 'Choose a supported currency, unit and time zone.');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) fail(400, 'Enter working hours as HH:MM, with the end after the start.');
        const country = text(body?.country, 8, 'Country', true);
        if (!COUNTRIES[country]) fail(400, 'Choose a country.');
        state.company = {
          ...state.company,
          name: text(body?.name, 80, 'Company name', true),
          country, currency, areaUnit, timeZone,
          phone: text(body?.phone, 40, 'Phone'),
          email: emailOf(body?.email, 'Public email'),
          address: text(body?.address, 160, 'Address'),
          workingHours: {days, start, end},
        };
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/area' && method === 'PUT') {
        const {state, account, row} = auth();
        mutable(state);
        const body = await readJson(req);
        if (!Array.isArray(body?.postcodes) || body.postcodes.length > 40) fail(400, 'Enter up to 40 postcodes.');
        const postcodes = [];
        for (const item of body.postcodes) {
          const code = text(item, 12, 'Postcode', true).toUpperCase();
          if (!/^[A-Z0-9][A-Z0-9 -]{1,11}$/.test(code)) fail(400, 'Check the postcode.');
          if (!postcodes.includes(code)) postcodes.push(code);
        }
        state.serviceArea = postcodes;
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/prices' && method === 'PUT') {
        const {state, account, row} = auth();
        mutable(state);
        const body = await readJson(req);
        const unit = state.company.areaUnit === 'sqft' ? 'sqft' : 'm2';
        const rate = value => {
          const number = numberOf(value, 'Price');
          if (number == null || number < 0.01 || number > 500) fail(400, 'Enter a price between 0.01 and 500.');
          const perM2 = unit === 'sqft' ? number * SQFT_PER_M2 : number;
          return round(perM2, 4);
        };
        const minimum = numberOf(body?.minimum, 'Minimum price');
        if (minimum != null && (minimum < 0 || minimum > 100000)) fail(400, 'Minimum price is invalid.');
        const maxArea = numberOf(body?.maxArea, 'Max area');
        if (maxArea != null && (maxArea <= 0 || maxArea > 1000000)) fail(400, 'Max area is invalid.');
        const speed = numberOf(body?.speed, 'Speed');
        if (speed == null || speed <= 0 || speed > 10000) fail(400, 'Enter a speed above 0.');
        const speedM2 = unit === 'sqft' ? speed / SQFT_PER_M2 : speed;
        if (speedM2 < 1 || speedM2 > 2000) fail(400, 'Speed is out of range.');
        state.prices = {
          home: rate(body?.home), office: rate(body?.office), deep: rate(body?.deep),
          minimum: minimum == null ? null : round(minimum, 2),
          maxAreaM2: maxArea == null ? null : round(unit === 'sqft' ? maxArea / SQFT_PER_M2 : maxArea, 2),
          speedM2PerHour: round(speedM2, 2),
        };
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/booking-mode' && method === 'PUT') {
        const {state, account, row} = auth();
        mutable(state);
        const mode = text((await readJson(req))?.bookingMode, 16, 'Booking mode', true);
        if (!BOOKING_MODES.has(mode)) fail(400, 'Choose paused, request or instant.');
        state.bookingMode = mode;
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/language' && method === 'PUT') {
        const {state, account, row} = auth();
        mutable(state);
        const language = text((await readJson(req))?.language, 8, 'Language', true);
        if (!LANGUAGES.has(language)) fail(400, 'Choose English, Deutsch or Russian.');
        state.company.language = language;
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/notifications' && method === 'PUT') {
        const {state, account, row} = auth();
        mutable(state);
        const body = await readJson(req);
        state.notifications = {
          requests: Boolean(body?.requests), schedule: Boolean(body?.schedule),
          payments: Boolean(body?.payments), trial: Boolean(body?.trial),
        };
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/legal' && method === 'PUT') {
        const {state, account, row} = auth();
        mutable(state);
        state.legal = {note: text((await readJson(req))?.note, 2000, 'Note')};
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/help' && method === 'POST') {
        const {state, account, row} = auth();
        const message = text((await readJson(req))?.message, 2000, 'Message', true);
        state.help.push({id:randomUUID(), sender:'company', name:account.name, body:message, createdAt:now()});
        if (state.help.length > 100) state.help = state.help.slice(-100);
        save(state);
        return send(201, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/export' && method === 'GET') {
        const {state, account, row} = auth();
        return send(200, {ok:true, report:{...DEMO_JOB, company:state.company.name, bookingMode:effectiveBookingMode(state, now())}, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/plan' && method === 'POST') {
        const {state, account, row} = auth();
        ownerOnly(account);
        const key = text((await readJson(req))?.key, 16, 'Plan', true);
        if (!PLANS[key]) fail(400, 'Choose Starter, Pro or Plus.');
        const used = seatsUsed(state.team);
        if (used > PLANS[key].seats) seatFailure('downgrade', key, used, state.plan.key);
        state.plan.key = key;
        state.plan.status = 'active';
        state.plan.trialStartedAt = null;
        state.plan.trialEndsAt = null;
        state.plan.cancelAtPeriodEnd = false;
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/plan/cancel' && method === 'POST') {
        const {state, account, row} = auth();
        ownerOnly(account);
        await readJson(req);
        state.plan.cancelAtPeriodEnd = true;
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/plan/preview-trial' && method === 'POST') {
        if (config.production) fail(404, 'Not found.');
        const {state, account, row} = auth();
        await readJson(req);
        state.plan.status = 'ended';
        state.plan.trialEndsAt = now() - 1000;
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/plan/restore-demo' && method === 'POST') {
        if (config.production) fail(404, 'Not found.');
        const {state, account, row} = auth();
        await readJson(req);
        state.plan.key = 'pro';
        state.plan.status = 'active';
        state.plan.trialEndsAt = null;
        state.plan.trialStartedAt = null;
        state.plan.cancelAtPeriodEnd = false;
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/connect/start' && method === 'POST') {
        const {state, account, row} = auth();
        mutable(state);
        ownerOnly(account);
        await readJson(req);
        const stub = connectOnboardingStub(config.origin);
        return send(200, {ok:true, ...stub, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/connect/finish' && method === 'POST') {
        const {state, account, row} = auth();
        mutable(state);
        ownerOnly(account);
        const result = text((await readJson(req))?.result, 16, 'Result', true);
        if (result === 'connected') {
          state.connect = {status:'connected', accountLabel:'acct_••••7Q2x', bankLabel:'DE ••• 3001', cardPayments:true};
        } else if (result === 'incomplete') {
          state.connect = {status:'incomplete', accountLabel:'', bankLabel:'', cardPayments:false};
        } else fail(400, 'Finish or leave the demo setup.');
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/connect/disconnect' && method === 'POST') {
        const {state, account, row} = auth();
        mutable(state);
        ownerOnly(account);
        await readJson(req);
        state.connect = {status:'disconnected', accountLabel:'', bankLabel:'', cardPayments:false};
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/team/invites' && method === 'POST') {
        const {state, account, row} = auth();
        mutable(state);
        const body = await readJson(req);
        const role = text(body?.role, 16, 'Role', true);
        const language = text(body?.language, 8, 'Language', true);
        const name = text(body?.name, 80, 'Name', true);
        const email = emailOf(body?.email);
        if (!ROLES.has(role) || !LANGUAGES.has(language)) fail(400, 'Choose a role and a language.');
        if (state.accounts.some(item => item.email === email && item.active !== false) || state.team.some(item => item.email === email && item.active !== false && !['expired', 'declined', 'revoked'].includes(item.invite))) {
          fail(409, 'That email is already on the team.', 'duplicate');
        }
        const used = seatsUsed(state.team);
        if ((role === 'cleaner' || role === 'helper') && used >= PLANS[state.plan.key].seats) seatFailure('invite', state.plan.key, used, state.plan.key);
        const member = {id:randomUUID(), name, email, role, active:true, invite:'pending', availability:'', language};
        const created = tx(() => {
          state.team.push(member);
          save(state);
          const token = issueToken('invite', email, {memberId:member.id, role, name, language}, INVITE_MS);
          const link = `${config.origin}${config.basePath || ''}/partner.html#invite/${token}`;
          return {token, link};
        });
        return send(201, {ok:true, invite:{name, email, role, language, expiresAt: now() + INVITE_MS, url: created.link}, workspace: workspace(load(), account, row.csrf)});
      }

      if (path === '/api/partner/team/deactivate' && method === 'POST') {
        const {state, account, row} = auth();
        mutable(state);
        const id = text((await readJson(req))?.id, 80, 'Person', true);
        const member = state.team.find(item => item.id === id);
        if (!member) fail(404, 'That person was not found.');
        if (member.role === 'admin') {
          const target = state.accounts.find(item => item.email === member.email);
          if (target?.owner) fail(403, 'The owner account stays.', 'owner_only');
          if (target) target.active = false;
        }
        member.active = false;
        member.invite = 'revoked';
        save(state);
        return send(200, {ok:true, workspace: workspace(state, account, row.csrf)});
      }

      fail(404, 'Not found.');
    } catch (error) {
      const status = error.status || 500;
      const body = {error: status === 500 ? 'Something went wrong. Try again.' : error.message, code: error.code || ''};
      if (error.details) Object.assign(body, error.details);
      if (status === 500) console.error(error);
      return send(status, body);
    }
  }

  return {handle, publicBooking};
}
