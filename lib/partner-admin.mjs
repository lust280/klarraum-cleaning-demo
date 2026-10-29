// Partner Admin owns plan cards, booking_mode, auth links, Connect stubs and
// the refund decision. Partner Ops calls classifyRefund / jobDurationMinutes.
// Client calls publicBooking() (also GET /api/partner/booking-mode and /api/config).
// Connect never calls Stripe. Customer card money is a future direct charge on
// the company's own Express account, not a charge through the operator.

import { randomUUID } from 'node:crypto';
import { digest, randomToken } from './security.mjs';
import { HttpError } from './validation.mjs';
import { connectOnboardingStub } from './integrations.mjs';
import { googleAuthorizationUrl, googleRedirectUri, signGoogleState, googleConnection, clearGoogleConnection, syncGoogleJobs } from './google-calendar.mjs';

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
    calendar: extras.calendar || {connected:false, email:''},
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  const guarded = /^[\t\r\n \uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

export function reportRecord(state) {
  return {
    address: DEMO_JOB.address,
    areaM2: DEMO_JOB.areaM2,
    ratePerM2: DEMO_JOB.ratePerM2,
    quote: DEMO_JOB.quote,
    currency: state?.company?.currency || DEMO_JOB.currency || 'EUR',
    payment: DEMO_JOB.payment,
    status: 'Accepted',
  };
}

export function reportCsv(state) {
  const job = reportRecord(state);
  const row = [job.address, job.areaM2, job.ratePerM2, job.quote, job.currency, job.payment, job.status].map(csvCell).join(',');
  return `address,area_m2,rate_per_m2,quote,currency,payment,status\n${row}\n`;
}

function invoiceText(state, id) {
  const invoice = (state.invoices || []).find(item => item.id === id);
  if (!invoice) return '';
  const plan = PLANS[state.plan.key] || PLANS.pro;
  const currency = state.company?.currency || 'EUR';
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '€';
  return `KlarraumApp\n${invoice.label}\n${plan.name}\n${symbol}${(invoice.cents / 100).toFixed(2)}\n${invoice.status}\nDemo invoice. Nothing was charged from this file.\n`;
}

function sendAttachment(res, filename, body) {
  const safe = String(filename).replace(/[^A-Za-z0-9._-]/g, '') || 'klarraum-export.txt';
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${safe}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
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

export function createPartnerAdmin({store, config, now, ops = null, team = null, fetcher = fetch}) {
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
    if (!state) {
      state = demoState();
      const currency = String(config.currency || '').toUpperCase();
      if (CURRENCIES.has(currency)) {
        state.company.currency = currency;
        if (currency === 'USD') state.company.country = 'US';
        if (currency === 'GBP') state.company.country = 'GB';
      }
      if (ZONES.has(config.timeZone)) state.company.timeZone = config.timeZone;
      save(state);
    }
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
    let calendar = {connected:false, email:''};
    if (config.integrations?.googleCalendar) {
      try { calendar = googleConnection(db); } catch { calendar = {connected:false, email:''}; }
    }
    return {
      csrf, demoControls: !config.production,
      integrations: {stripeLive:false, stripeKeysPresent:Boolean(config.integrations?.stripe), googleCalendar:Boolean(config.integrations?.googleCalendar)},
      calendar,
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

  function companyDate(state) {
    const zone = state?.company?.timeZone || config.timeZone || 'Europe/Berlin';
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date(now()));
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  }
  function ensureWorkers(state) {
    if (!team) return;
    for (const member of state.team || []) {
      if (!member?.active || !['cleaner', 'helper'].includes(member.role)) continue;
      if (member.invite && member.invite !== 'accepted') continue;
      const email = String(member.email || '').trim().toLowerCase();
      if (!email) continue;
      team.ensureActiveEmployee({name: member.name, email, region: 'Berlin', language: member.language || 'en'}, now());
    }
  }
  function withRoles(job, state) {
    const order = new Map();
    const roles = new Map();
    (state.team || []).forEach((member, index) => {
      const email = String(member.email || '').toLowerCase();
      order.set(email, index);
      if (member.role === 'helper') roles.set(email, 'Helper');
      else if (member.role === 'cleaner') roles.set(email, 'Cleaner');
    });
    const workers = (job.workers || []).map(worker => {
      const email = String(team?.employee(worker.id)?.email || '').toLowerCase();
      return {...worker, role: roles.get(email) || 'Cleaner'};
    }).sort((a, b) => {
      const ae = String(team?.employee(a.id)?.email || '').toLowerCase();
      const be = String(team?.employee(b.id)?.email || '').toLowerCase();
      return (order.get(ae) ?? 100) - (order.get(be) ?? 100) || a.name.localeCompare(b.name);
    });
    return {...job, workers};
  }
  function opsItems(query) {
    return ops.list({searchParams: new URLSearchParams(query)}).items;
  }
  function openDemoJob() {
    return opsItems('').find(item => item.address === DEMO_JOB.address && ['new', 'accepted', 'assigned'].includes(item.status)) || null;
  }
  function acceptExisting(id, state) {
    ensureWorkers(state);
    const current = ops.detail(id);
    if (current.status === 'new') return withRoles(ops.accept(id, {version: current.version}), state);
    if (current.status === 'accepted' || current.status === 'assigned') return withRoles(current, state);
    fail(409, 'Only a new request can be accepted.');
  }
  function cardOf(item) {
    return {
      id: item.id, address: item.address, areaM2: item.areaM2, priceCents: item.priceCents,
      currency: item.currency, version: item.version, serviceTitle: item.serviceTitle, status: item.status,
    };
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
        const row = sessionRow(req);
        const state = sweep(ensure());
        const account = accountById(state, row.account_id);
        if (!account) fail(401, 'Sign in required.', 'auth');
        const format = url.searchParams.get('format') || '';
        if (format === 'csv') return sendAttachment(res, 'klarraum-report.csv', reportCsv(state));
        if (format === 'json') return sendAttachment(res, 'klarraum-report.json', JSON.stringify(reportRecord(state), null, 2));
        if (format === 'invoice') {
          const id = text(url.searchParams.get('id') || '', 80, 'Invoice', true);
          const file = invoiceText(state, id);
          if (!file) fail(404, 'That invoice was not found.');
          return sendAttachment(res, `${id}.txt`, file);
        }
        if (format) fail(400, 'Choose CSV or JSON.');
        return send(200, {ok:true, report:{...DEMO_JOB, company:state.company.name, bookingMode:effectiveBookingMode(state, now())}, workspace: workspace(state, account, row.csrf)});
      }

      if (path === '/api/partner/inbox' && method === 'GET') {
        const row = sessionRow(req);
        const state = sweep(ensure());
        if (!accountById(state, row.account_id)) fail(401, 'Sign in required.', 'auth');
        const hasInbox = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='partner_inbox'").get();
        const items = hasInbox ? db.prepare('SELECT id, kind, job_id AS jobId, employee_id AS employeeId, note, created_at AS createdAt, read_at AS readAt FROM partner_inbox ORDER BY created_at DESC, id DESC LIMIT 50').all() : [];
        const hasJobs = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get();
        const workersOut = hasJobs ? db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='working'").get().n : 0;
        return send(200, {items, workersOut});
      }

      if (path === '/api/partner/calendar' && method === 'GET') {
        const row = sessionRow(req);
        const state = sweep(ensure());
        if (!accountById(state, row.account_id)) fail(401, 'Sign in required.', 'auth');
        if (!config.integrations?.googleCalendar) return send(200, {enabled:false, connected:false, email:''});
        return send(200, {enabled:true, ...googleConnection(db)});
      }

      if (path === '/api/partner/calendar/connect' && method === 'POST') {
        auth();
        await readJson(req);
        if (!config.integrations?.googleCalendar || !config.google?.clientId) fail(404, 'Google Calendar is not configured.');
        const returnTo = `${config.origin}${config.basePath || ''}/admin.html`;
        const stateToken = signGoogleState(config.secret, {companyId: config.companyId || 'local', returnTo, now: now()});
        return send(200, {url: googleAuthorizationUrl({clientId: config.google.clientId, redirectUri: googleRedirectUri(config.google, config.origin), state: stateToken})});
      }

      if (path === '/api/partner/calendar/disconnect' && method === 'POST') {
        auth();
        await readJson(req);
        if (!config.integrations?.googleCalendar) fail(404, 'Google Calendar is not configured.');
        clearGoogleConnection(db);
        return send(200, {connected:false, email:''});
      }

      if (path === '/api/partner/calendar/sync' && method === 'POST') {
        auth();
        await readJson(req);
        if (!config.integrations?.googleCalendar) fail(404, 'Google Calendar is not configured.');
        return send(200, await syncGoogleJobs({db, clientId: config.google.clientId, clientSecret: config.google.clientSecret, timeZone: config.timeZone, fetchImpl: fetcher, now: now()}));
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

      if (path === '/api/partner/today' && method === 'GET') {
        const row = sessionRow(req);
        const state = sweep(ensure());
        if (!accountById(state, row.account_id)) fail(401, 'Sign in required.', 'auth');
        if (!ops) fail(404, 'Not found.');
        const board = ops.today();
        const open = openDemoJob();
        const preview = board.attention.length === 0 && !open && board.counts.jobsToday === 0;
        const waiting = preview ? [] : opsItems('status=accepted').filter(item => !item.worker);
        return send(200, {
          preview,
          counts: {
            newRequests: preview ? 1 : board.counts.newRequests,
            jobsToday: preview ? 1 : board.counts.jobsToday,
            workersOut: board.counts.workersOut,
          },
          attention: preview ? [] : board.attention.map(cardOf),
          assign: waiting.map(cardOf),
        });
      }

      if (path === '/api/partner/jobs/confirm' && method === 'POST') {
        const {state} = auth();
        mutable(state);
        if (!ops || !team) fail(404, 'Not found.');
        const body = await readJson(req);
        ensureWorkers(state);
        const requested = typeof body?.id === 'string' ? body.id : '';
        if (requested) return send(200, {job: acceptExisting(requested, state)});
        const open = openDemoJob();
        if (open) return send(200, {job: acceptExisting(open.id, state)});
        const created = ops.receiveNew({
          service: 'home',
          serviceTitle: 'Home cleaning',
          areaM2: DEMO_JOB.areaM2,
          priceCents: Math.round(DEMO_JOB.quote * 100),
          rateCents: Math.round(DEMO_JOB.ratePerM2 * 100),
          address: DEMO_JOB.address,
          customer: 'Customer',
          date: companyDate(state),
          time: '09:00',
          plannedMinutes: 120,
          region: 'Berlin',
        });
        return send(200, {job: withRoles(ops.accept(created.id, {version: created.version}), state)});
      }

      const assignJob = path.match(/^\/api\/partner\/jobs\/([0-9a-f-]{36})\/assign$/i);
      if (assignJob && method === 'POST') {
        const {state} = auth();
        mutable(state);
        if (!ops || !team) fail(404, 'Not found.');
        const body = await readJson(req);
        ensureWorkers(state);
        const saved = ops.assign(assignJob[1], {employeeId: body?.employeeId, version: body?.version});
        return send(200, {job: withRoles(saved, state)});
      }

      const jobPath = path.match(/^\/api\/partner\/jobs\/([0-9a-f-]{36})$/i);
      if (jobPath && method === 'GET') {
        const row = sessionRow(req);
        const state = sweep(ensure());
        if (!accountById(state, row.account_id)) fail(401, 'Sign in required.', 'auth');
        if (!ops || !team) fail(404, 'Not found.');
        ensureWorkers(state);
        return send(200, {job: withRoles(ops.detail(jobPath[1]), state)});
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
