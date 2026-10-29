// Public client booking. Partner Ops owns the full slot engine; this module is the
// client-facing stub Ops can replace. Partner Admin owns booking_mode writes and
// shared auth. Wave1 magic-link auth is not in this repo, so customer sign-in is
// a hook only — see CLIENT_STUBS.
import {randomUUID} from 'node:crypto';
import {digest, randomToken, validFormToken} from './security.mjs';
import {HttpError, validateInquiry} from './validation.mjs';
import {localInstant} from './scheduling.mjs';
import {resolveBooking, allowsCard} from '../public/booking-contract.js';

export const CLIENT_STUBS = Object.freeze([
  'Booking mode is read from GET /api/config partnerBooking, or else GET /api/partner/booking-mode. Until Partner Admin is merged, that contract is absent and the funnel falls back to request mode. The effective bookingMode is used, not storedBookingMode.',
  'Instant card pay is a stub. No Stripe call, no charge, no live key. A card button exists only when bookingMode is instant and cardPayments is true.',
  'Pay-blocked is only the card path after Connect is off. It does not move money.',
  'Slot engine is client-side until Partner Ops replaces it: duration = area ÷ speed, round up to 30 min; Mon–Sat 08:00–18:00 Europe/Berlin; 1 worker per job; New request holds the slot 24h.',
  'When the company has no active Cleaner or Helper, capacity is stubbed to 1 so the public page still offers times. Real capacity is the active worker count once Ops adds people.',
  'Working hours and speed use the A1 defaults (Mon–Sat 08:00–18:00, 30 m²/h). Company-profile fields stay with Partner Admin.',
  'Customer magic-link sign-in is not a second auth stack. POST /api/client/magic-link reserves the wave1 hook and does not create a session. Cancel links are booking tokens, not logins.',
  'Emails after Accept (payment link), reminder, reschedule, decline, refund and report are copy stubs in CLIENT_EMAILS. The existing inquiry receipt still sends on create.',
  'Refunds do not call Stripe. More than 24h before the visit marks Paid online as Refunded. Within 24h the company decides (Refund / Keep is Partner Ops Inbox).',
  'Legacy inquiry status stays on the owner inbox scale. Job status for Ops is jobStatus on /api/admin/client-jobs.',
  'Area unit comes from the booking contract (m2 or sqft). The customer cannot toggle it. The request-mode stub uses m².',
]);

export const DEMO_SEED = Object.freeze({
  address:'12 Linden St, 10115 Berlin',
  area:70,
  ratePerM2:2.2,
  total:154,
  currency:'EUR',
  unit:'m²',
});

export const CLIENT_EMAILS = Object.freeze({
  received:{subject:'We received your cleaning request', note:'Request mode. Not a confirmed booking.'},
  confirmed:{subject:'Your cleaning is booked — pay on site', note:'Instant, or pay on site. Unpaid.'},
  acceptedPaymentLink:{subject:'Your cleaning was accepted', note:'Request + Connect ON only. Pay link after Accept. Not sent in this stub.'},
  reminder:{subject:'Reminder: cleaning visit', note:'Copy stub. Not sent.'},
  reschedule:{subject:'Your cleaning time changed', note:'Copy stub. Not sent.'},
  cancelled:{subject:'Your cleaning was cancelled', note:'Copy stub. Not sent.'},
  declined:{subject:'We cannot take this request', note:'Copy stub. Not sent.'},
  refund:{subject:'Refund for your cleaning', note:'No Stripe refund is created here.'},
  report:{subject:'Your cleaning report', note:'Copy stub. Not sent.'},
});

const JOB = ['New request','Accepted','Assigned','In progress','Done','Declined','Cancelled'];
const PAY = ['Unpaid','Paid online','Paid on site','Refunded'];
const HOLD = new Set(['Accepted','Assigned','In progress']);
const DAY_MS = 86400000;
const STEP = 30;

export function clientQuote(area, rate, minimum = 0) {
  const raw = Math.round(Number(area) * Number(rate) * 100) / 100;
  const floor = Math.round((Number(minimum) || 0) * 100) / 100;
  return Math.round(Math.max(raw, floor) * 100) / 100;
}

export function durationMinutes(area, speed = 30) {
  const hours = Number(area) / Number(speed);
  if (!Number.isFinite(hours) || hours <= 0) throw new HttpError(400, 'Enter the area in whole square metres.');
  return Math.ceil(hours * 2) / 2 * 60;
}

export function footerCopy(mode) {
  if (mode === 'instant') return 'Instant booking · Pay online or on site';
  if (mode === 'paused') return 'Online booking is paused';
  return 'No payment now · The company confirms your request';
}

export function normalizeBookingSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const mode = ['paused','request','instant'].includes(source.mode) ? source.mode : 'request';
  const speed = Number(source.speedM2PerHour);
  const maxRaw = source.maxArea == null || source.maxArea === '' ? null : Number(source.maxArea);
  if (maxRaw != null && (!Number.isInteger(maxRaw) || maxRaw < 20 || maxRaw > 100000)) throw new HttpError(400, 'Max area must be a whole number of square metres.');
  const capacity = source.capacity == null || source.capacity === '' ? null : Number(source.capacity);
  if (capacity != null && (!Number.isInteger(capacity) || capacity < 0 || capacity > 500)) throw new HttpError(400, 'Capacity must be a whole number.');
  return {
    mode,
    connect: source.connect === true,
    speedM2PerHour: Number.isFinite(speed) && speed > 0 && speed <= 500 ? speed : 30,
    maxArea: maxRaw,
    capacity,
    workStart: '08:00',
    workEnd: '18:00',
    workDays: [1,2,3,4,5,6],
  };
}

export function effectiveMode(settings, site) {
  if (site?.booking?.enabled === false || settings.mode === 'paused') return 'paused';
  return settings.mode === 'instant' ? 'instant' : 'request';
}

function minutes(value) {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}
function clock(total) {
  const hour = Math.floor(total / 60), minute = total % 60;
  return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
}
function timeLabel(value) {
  const [hour, minute] = value.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute).padStart(2,'0')} ${suffix}`;
}
function dateLabel(iso) {
  return new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'}).format(new Date(`${iso}T12:00:00Z`));
}
function shiftDate(iso, days) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0,10);
}
function overlaps(start, end, otherStart, otherEnd) {
  return start < otherEnd && otherStart < end;
}
function berlinToday(now, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(now));
}
function berlinMinutes(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone, hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(new Date(now)).map(part => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}
function referenceFor(id) {
  return `KR-${(parseInt(id.replace(/-/g,'').slice(0,6), 16) % 9000) + 1000}`;
}
function tokenHash(secret, token) {
  return digest(`${secret}:client-cancel:${token}`);
}

function ensureTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS client_jobs (
    id TEXT PRIMARY KEY,
    inquiry_id TEXT UNIQUE,
    reference TEXT NOT NULL,
    service TEXT NOT NULL,
    service_title TEXT NOT NULL,
    area INTEGER NOT NULL,
    slot_date TEXT NOT NULL,
    slot_time TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    address TEXT NOT NULL,
    postcode TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    notes TEXT NOT NULL,
    job_status TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    booking_mode TEXT NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL,
    hold_until INTEGER,
    token_hash TEXT NOT NULL UNIQUE,
    visit_at INTEGER NOT NULL,
    refund_note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS client_jobs_slot ON client_jobs(slot_date, slot_time);`);
}

function holds(row, now) {
  if (row.job_status === 'New request') return Number(row.hold_until) > now;
  return HOLD.has(row.job_status);
}

function intervalsFor(db, date, now) {
  const rows = db.prepare('SELECT slot_time, duration_min, job_status, hold_until FROM client_jobs WHERE slot_date=?').all(date);
  const intervals = [];
  for (const row of rows) {
    if (!holds(row, now)) continue;
    const start = minutes(row.slot_time);
    intervals.push([start, start + row.duration_min]);
  }
  try {
    const jobs = db.prepare("SELECT scheduled_time, planned_minutes, state FROM jobs WHERE scheduled_date=?").all(date);
    for (const job of jobs) {
      if (!['assigned','working','paused'].includes(job.state) || !/^\d{2}:\d{2}$/.test(job.scheduled_time || '')) continue;
      const start = minutes(job.scheduled_time);
      intervals.push([start, start + Number(job.planned_minutes || 0)]);
    }
  } catch { /* Ops jobs table is optional for the client stub. */ }
  return intervals;
}

function workerCapacity(db, settings) {
  if (Number.isInteger(settings.capacity)) return settings.capacity;
  try {
    const count = db.prepare('SELECT COUNT(*) AS n FROM employees WHERE active=1').get().n;
    return count > 0 ? count : 1;
  } catch {
    return 1;
  }
}

export function freeSlots({db, area, settings, now, timeZone}) {
  const duration = durationMinutes(area, settings.speedM2PerHour);
  const capacity = workerCapacity(db, settings);
  const today = berlinToday(now, timeZone);
  const nowMinutes = berlinMinutes(now, timeZone);
  const open = minutes(settings.workStart);
  const close = minutes(settings.workEnd);
  const dates = [];
  for (let offset = 0; offset < 21; offset += 1) {
    const date = shiftDate(today, offset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!settings.workDays.includes(weekday)) continue;
    const taken = intervalsFor(db, date, now);
    const times = [];
    for (let start = open; start + duration <= close; start += STEP) {
      if (date === today && start <= nowMinutes) continue;
      const end = start + duration;
      const busy = taken.filter(([from, to]) => overlaps(start, end, from, to)).length;
      if (busy >= capacity) continue;
      const value = clock(start);
      try { localInstant(date, value, timeZone); } catch { continue; }
      times.push({value, label: timeLabel(value)});
    }
    if (times.length) dates.push({value: date, label: dateLabel(date), times});
  }
  return {durationMin: duration, capacity, dates};
}

function assertSlot(db, area, settings, date, time, now, timeZone) {
  const slots = freeSlots({db, area, settings, now, timeZone});
  const day = slots.dates.find(item => item.value === date);
  if (!day?.times.some(item => item.value === time)) throw new HttpError(409, 'That time is not open. Choose another time.');
  return slots.durationMin;
}

function publicJob(row, now) {
  const cancellable = !['In progress','Done','Declined','Cancelled'].includes(row.job_status);
  const soon = row.visit_at - now <= DAY_MS;
  let refundNotice = '';
  if (row.payment_status === 'Paid online' && soon && row.job_status !== 'Cancelled') refundNotice = 'Refund is decided by the company';
  if (row.job_status === 'Cancelled' && row.refund_note) refundNotice = row.refund_note;
  return {
    id: row.id,
    inquiryId: row.inquiry_id,
    reference: row.reference,
    service: row.service,
    serviceTitle: row.service_title,
    area: row.area,
    unit: 'm²',
    date: row.slot_date,
    dateLabel: dateLabel(row.slot_date),
    time: row.slot_time,
    timeLabel: timeLabel(row.slot_time),
    durationMin: row.duration_min,
    endTime: clock(minutes(row.slot_time) + row.duration_min),
    address: row.address,
    postcode: row.postcode,
    name: row.customer_name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    jobStatus: row.job_status,
    paymentStatus: row.payment_status,
    bookingMode: row.booking_mode,
    price: row.price,
    currency: row.currency,
    cancellable,
    refundNotice,
    createdAt: row.created_at,
  };
}

export function createClientBooking(config, store, {now, limiter, clientKey, checkOrigin, readJson, json, onInquiry, getPublicBooking}) {
  ensureTables(store.db);
  const secret = config.secret;
  function settings() {
    const row = store.db.prepare("SELECT value FROM metadata WHERE key='client_booking'").get();
    return normalizeBookingSettings(row ? JSON.parse(row.value) : {});
  }
  function saveSettings(value) {
    store.db.prepare("INSERT INTO metadata(key,value) VALUES('client_booking',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
  }
  function active() {
    const external = getPublicBooking?.() || null;
    const site = store.site().content;
    return resolveBooking({
      config: external ? {partnerBooking: external, bookingMode: external.bookingMode, currency: external.currency || config.currency, pricing: store.pricing(), site: site.content ? site : {company: site.company}} : {currency: config.currency, pricing: store.pricing(), site},
      company: site.company,
      pricing: store.pricing(),
    });
  }
  function slotSettings() {
    const booking = active().booking;
    const local = settings();
    return {...local, speedM2PerHour: booking.prices.speedM2PerHour || 30, mode: booking.bookingMode};
  }
  function viewConfig() {
    const resolved = active();
    const booking = resolved.booking;
    const site = store.site().content;
    return {
      live: Boolean(config.live),
      demoMode: Boolean(config.demoMode),
      bookingMode: booking.bookingMode,
      bookingSource: resolved.source,
      bookingStub: resolved.stub === true,
      cardPayments: allowsCard(booking),
      connect: allowsCard(booking),
      currency: booking.currency || config.currency || 'EUR',
      unit: booking.areaUnit === 'sqft' ? 'sq ft' : 'm²',
      timeZone: config.timeZone || 'Europe/Berlin',
      pricing: {rates:{home:booking.prices.home, office:booking.prices.office, deep:booking.prices.deep}, minimum:booking.prices.minimum || 0, discounts: store.pricing().discounts},
      maxArea: booking.prices.maxAreaM2,
      speedM2PerHour: booking.prices.speedM2PerHour,
      footer: footerCopy(booking.bookingMode),
      company: booking.company.name ? booking.company : site.company,
      services: site.services,
      partnerBooking: resolved.source === 'stub' ? null : booking,
      demoSeed: DEMO_SEED,
      auth: {
        provider: 'stub',
        plugIn: 'wave1-shared-auth',
        magicLinkMinutes: 15,
        inviteHours: 24,
        note: 'Shared magic-link auth is not merged. This does not start a session.',
      },
      stubs: CLIENT_STUBS,
    };
  }
  function insertBooking(req, body, paymentChoice) {
    const booking = active().booking;
    const site = store.site().content;
    const bookingMode = booking.bookingMode;
    if (!config.live) throw new HttpError(503, 'Online requests are not turned on yet.');
    if (bookingMode === 'paused') throw new HttpError(503, 'Online booking is paused.');
    if (!limiter.allow(`client-booking:${clientKey(req)}`, 40, 3600000, now())) throw new HttpError(429, 'Too many requests. Please try again later.');
    const area = body.area;
    if (!Number.isInteger(area) || area < 20) throw new HttpError(400, 'Enter at least 20 m².');
    if (booking.prices.maxAreaM2 != null && area > booking.prices.maxAreaM2) throw new HttpError(400, 'Contact the company for larger areas');
    if (area > 1000) throw new HttpError(400, 'Contact the company for larger areas');
    if (bookingMode === 'request' && paymentChoice === 'card') throw new HttpError(400, 'Request booking does not take a card. Pay on site, or pay after the company accepts.');
    if (bookingMode === 'instant' && paymentChoice === 'request') throw new HttpError(400, 'Choose pay on site or card.');
    if (paymentChoice === 'card' && !allowsCard(booking)) throw new HttpError(409, 'Online card pay is unavailable.');
    if (!Object.hasOwn(site.services, body.service) || !site.services[body.service].enabled) throw new HttpError(400, 'That service is not available.');
    const key = body.key;
    const submittedChoice = paymentChoice === 'card' ? 'card' : paymentChoice === 'onsite' ? 'onsite' : 'request';
    const payload = validateInquiry({
      ...body.fields,
      service: body.service,
      area,
      frequency: 'once',
      windows: false,
      tipPercent: 0,
      date: body.date,
      preferredTime: body.time,
      privacy: true,
    }, store.pricing(), config.business, now(), config.timeZone);
    payload.serviceTitle = site.services[body.service].title;
    const contractRate = booking.prices[body.service];
    if (Number.isFinite(contractRate) && contractRate > 0) payload.price = clientQuote(area, contractRate, booking.prices.minimum || 0);
    const jobStatus = bookingMode === 'instant' ? 'Accepted' : 'New request';
    const paymentStatus = submittedChoice === 'card' ? 'Paid online' : 'Unpaid';
    payload.jobStatus = jobStatus;
    payload.paymentStatus = paymentStatus;
    payload.bookingMode = bookingMode;
    payload.paymentChoice = submittedChoice;
    const {price, serviceTitle, jobStatus: statusField, paymentStatus: payField, bookingMode: modeField, paymentChoice: choiceField, ...submitted} = payload;
    const fingerprint = digest(JSON.stringify({...submitted, paymentChoice: choiceField}));
    const existing = store.byKey(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'This request was already saved with different details.');
      const saved = store.db.prepare('SELECT * FROM client_jobs WHERE inquiry_id=?').get(existing.id);
      if (!saved) throw new HttpError(409, 'This request was already saved with different details.');
      return {...publicJob(saved, now()), saved: true, token: null};
    }
    const db = store.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const duration = assertSlot(db, area, slotSettings(), body.date, body.time, now(), config.timeZone);
      const visitAt = localInstant(body.date, body.time, config.timeZone);
      const createdAt = now();
      const row = store.add(key, fingerprint, {...payload, durationMin: duration}, createdAt);
      const id = randomUUID();
      const token = randomToken();
      const reference = referenceFor(id);
      db.prepare(`INSERT INTO client_jobs(
        id,inquiry_id,reference,service,service_title,area,slot_date,slot_time,duration_min,address,postcode,
        customer_name,email,phone,notes,job_status,payment_status,booking_mode,price,currency,hold_until,token_hash,visit_at,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, row.id, reference, body.service, serviceTitle, area, body.date, body.time, duration, payload.address, payload.postcode,
        payload.name, payload.email, payload.phone, payload.message, statusField, payField, modeField, price, config.currency || 'EUR',
        statusField === 'New request' ? createdAt + DAY_MS : null, tokenHash(secret, token), visitAt, createdAt,
      );
      db.exec('COMMIT');
      onInquiry?.(row.id);
      const saved = db.prepare('SELECT * FROM client_jobs WHERE id=?').get(id);
      return {...publicJob(saved, now()), saved: true, token, stub: submittedChoice === 'card', processor: submittedChoice === 'card' ? 'stripe-later' : ''};
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* already closed */ }
      throw error;
    }
  }
  function readFields(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Check the form and try again.');
    return {
      service: input.service,
      area: input.area,
      date: typeof input.date === 'string' ? input.date : '',
      time: typeof input.time === 'string' ? input.time : '',
      fields: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        postcode: input.postcode,
        address: input.address,
        message: input.message,
      },
    };
  }
  function jobByToken(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(400, 'This link has expired.');
    const row = store.db.prepare('SELECT * FROM client_jobs WHERE token_hash=?').get(tokenHash(secret, token));
    if (!row) throw new HttpError(410, 'This link has expired.');
    return row;
  }
  async function handlePublic(req, res, url) {
    const path = url.pathname;
    const method = req.method;
    if (path === '/api/client/config' && method === 'GET') return json(res, 200, viewConfig());
    if (path === '/api/client/slots' && method === 'GET') {
      if (!limiter.allow(`client-slots:${clientKey(req)}`, 60, 60000, now())) throw new HttpError(429, 'Too many requests. Please try again later.');
      const area = Number(url.searchParams.get('area'));
      if (!Number.isInteger(area)) throw new HttpError(400, 'Enter the area in whole square metres.');
      return json(res, 200, freeSlots({db: store.db, area, settings: slotSettings(), now: now(), timeZone: config.timeZone || 'Europe/Berlin'}));
    }
    if (path === '/api/client/booking' && method === 'GET') return json(res, 200, publicJob(jobByToken(url.searchParams.get('token')), now()));
    if (path === '/api/client/magic-link' && method === 'GET') throw new HttpError(410, 'This link has expired.');
    if (path === '/api/client/magic-link' && method === 'POST') {
      checkOrigin(req);
      if (!limiter.allow(`client-magic:${clientKey(req)}`, 8, 900000, now())) throw new HttpError(429, 'Too many sign-in attempts.');
      const body = await readJson(req);
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
      return json(res, 202, {
        ok: true,
        stub: true,
        plugIn: 'wave1-shared-auth',
        expiresMinutes: 15,
        message: 'When shared sign-in is connected, we email a link that expires in 15 minutes. No session was created.',
      });
    }
    if (path === '/api/client/requests' && method === 'POST') {
      checkOrigin(req);
      const body = await readJson(req);
      if (body?.website) throw new HttpError(400, 'Check the form and try again.');
      if (body?.privacy !== true) throw new HttpError(400, 'Agree to the privacy policy to continue.');
      if (!validFormToken(body?.token, secret, now())) throw new HttpError(400, 'Reload the page and try again.');
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/i.test(key)) throw new HttpError(400, 'Reload the page and try again.');
      const choice = body?.paymentChoice === 'onsite' ? 'onsite' : 'request';
      const fields = readFields(body);
      const saved = insertBooking(req, {...fields, key}, choice);
      return json(res, 201, saved);
    }
    if (path === '/api/client/pay' && method === 'POST') {
      checkOrigin(req);
      const body = await readJson(req);
      if (body?.website) throw new HttpError(400, 'Check the form and try again.');
      if (body?.privacy !== true) throw new HttpError(400, 'Agree to the privacy policy to continue.');
      if (!validFormToken(body?.token, secret, now())) throw new HttpError(400, 'Reload the page and try again.');
      if (body?.card) throw new HttpError(400, 'Card numbers are not accepted by this demo.');
      const outcome = body?.outcome === 'fail' ? 'fail' : body?.outcome === 'success' ? 'success' : '';
      if (!outcome) throw new HttpError(400, 'Choose a demo card result.');
      if (outcome === 'fail') {
        const booking = active().booking;
        if (booking.bookingMode !== 'instant') throw new HttpError(400, 'Card pay is only for instant booking.');
        if (!allowsCard(booking)) throw new HttpError(409, 'Online card pay is unavailable.');
        return json(res, 402, {ok: false, stub: true, processor: 'stripe-later', code: 'card_declined', message: 'Try another method or card.'});
      }
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/i.test(key)) throw new HttpError(400, 'Reload the page and try again.');
      const saved = insertBooking(req, {...readFields(body), key}, 'card');
      return json(res, 201, saved);
    }
    if (path === '/api/client/cancel' && method === 'POST') {
      checkOrigin(req);
      const body = await readJson(req);
      const row = jobByToken(body?.token);
      if (['In progress','Done','Declined','Cancelled'].includes(row.job_status)) throw new HttpError(409, 'This booking can no longer be cancelled.');
      let payment = row.payment_status;
      let note = '';
      if (payment === 'Paid online') {
        if (row.visit_at - now() > DAY_MS) {
          payment = 'Refunded';
          note = 'Refund is marked automatically. No card refund is sent in this demo.';
        } else note = 'Refund is decided by the company';
      }
      store.db.prepare('UPDATE client_jobs SET job_status=?, payment_status=?, refund_note=?, hold_until=NULL WHERE id=?').run('Cancelled', payment, note, row.id);
      const inquiry = store.get(row.inquiry_id);
      if (inquiry) {
        const payload = JSON.parse(inquiry.payload);
        payload.jobStatus = 'Cancelled';
        payload.paymentStatus = payment;
        store.db.prepare('UPDATE inquiries SET payload=? WHERE id=?').run(JSON.stringify(payload), row.inquiry_id);
      }
      const saved = store.db.prepare('SELECT * FROM client_jobs WHERE id=?').get(row.id);
      return json(res, 200, publicJob(saved, now()));
    }
    throw new HttpError(404, 'Not found.');
  }
  async function handleAdmin(req, res, url) {
    const path = url.pathname;
    const method = req.method;
    if (path === '/api/admin/client-booking' && method === 'GET') {
      const resolved = active();
      return json(res, 200, {capacity: settings().capacity, bookingMode: resolved.booking.bookingMode, source: resolved.source, stub: resolved.stub === true});
    }
    if (path === '/api/admin/client-booking' && method === 'PUT') {
      const body = await readJson(req);
      const next = normalizeBookingSettings({...settings(), capacity: body?.capacity === undefined ? settings().capacity : body.capacity});
      saveSettings(next);
      const resolved = active();
      return json(res, 200, {capacity: next.capacity, bookingMode: resolved.booking.bookingMode, source: resolved.source, stub: resolved.stub === true});
    }
    if (path === '/api/admin/client-jobs' && method === 'GET') {
      const items = store.db.prepare('SELECT * FROM client_jobs ORDER BY created_at DESC, id LIMIT 50').all().map(row => publicJob(row, now()));
      return json(res, 200, {items, total: items.length});
    }
    const match = path.match(/^\/api\/admin\/client-jobs\/([a-f0-9-]{36})$/i);
    if (match && method === 'PATCH') {
      const body = await readJson(req);
      const row = store.db.prepare('SELECT * FROM client_jobs WHERE id=?').get(match[1]);
      if (!row) throw new HttpError(404, 'Booking not found.');
      const jobStatus = JOB.includes(body?.jobStatus) ? body.jobStatus : row.job_status;
      const paymentStatus = PAY.includes(body?.paymentStatus) ? body.paymentStatus : row.payment_status;
      const holdUntil = jobStatus === 'New request' ? row.hold_until || now() + DAY_MS : null;
      store.db.prepare('UPDATE client_jobs SET job_status=?, payment_status=?, hold_until=? WHERE id=?').run(jobStatus, paymentStatus, holdUntil, row.id);
      return json(res, 200, publicJob(store.db.prepare('SELECT * FROM client_jobs WHERE id=?').get(row.id), now()));
    }
    throw new HttpError(404, 'Not found.');
  }
  return {handlePublic, handleAdmin, settings, active};
}
