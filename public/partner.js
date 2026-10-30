import { translate } from './partner-i18n.js';

const app = document.querySelector('#app');
const toastNode = document.querySelector('#toast');
const sheet = document.querySelector('#sheet');
const CATALOGUE = [
  {key:'starter', name:'Starter', cents:4900, seats:2, support:'Email and the Help thread'},
  {key:'pro', name:'Pro', cents:8900, seats:5, support:'Priority support'},
  {key:'plus', name:'Plus', cents:14900, seats:10, support:'Priority support and a personal contact'},
];
const SHARED = [
  'Branded booking site and calculator',
  'Jobs, assignment, worker app, photos and reports (12 months)',
  'Booking mode: Paused, Request or Instant',
  'Pay on site and Stripe Connect',
  'English, Deutsch and Russian',
  'Reports and export',
];
const roleName = {cleaner:'Cleaner', helper:'Helper', admin:'Admin'};
const langName = {en:'English', de:'Deutsch', ru:'Русский'};
const modeName = {paused:'Paused', request:'Request', instant:'Instant'};
const modeCopy = {
  paused:['Paused', 'Online booking OFF. Clients see Booking paused.'],
  request:['Request', 'Accept requests. You accept or decline each one.'],
  instant:['Instant', 'Instant book. Booking is confirmed right away.'],
};
let model = null;
let csrf = '';
let wide = false;
let toastTimer = 0;
let looked = {};
let drafts = {};
let todayBoard = null;
let jobView = null;
let jobProblem = null;
let inboxView = null;
let inboxLoading = false;
let planCarouselKey = '';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function uiLocale() {
  const lang = model?.company?.language;
  return lang === 'de' ? 'de-DE' : lang === 'ru' ? 'ru-RU' : 'en-US';
}
function tr(text, vars) {
  let value = translate(model?.company?.language, text);
  if (vars) for (const [key, item] of Object.entries(vars)) value = value.replaceAll(`{${key}}`, String(item ?? ''));
  return value;
}
function roleLabel(role) {
  return tr({cleaner:'Cleaner', helper:'Helper', admin:'Admin'}[role] || role || '');
}
const money = (amount, currency = 'EUR') => `${currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '€'}${Number(amount).toFixed(2)}`;
const planPrice = (cents, currency = model?.company?.currency || 'EUR') => `${currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '€'}${Number(cents) / 100}/mo`;
const unitLabel = unit => unit === 'sqft' ? 'sq ft' : 'm²';
const durationLabel = minutes => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours} h ${mins} min`;
  return hours ? `${hours} h` : `${mins} min`;
};
function partsOf() {
  return (location.hash.replace(/^#/, '').split('?')[0] || '').split('/').filter(Boolean);
}
function googleTokenFromHash() {
  return new URLSearchParams(location.hash.replace(/^#/, '')).get('google') || '';
}
function hashQuery() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}
function toast(message) {
  toastNode.hidden = false;
  toastNode.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastNode.hidden = true; }, 2400);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const node = document.createElement('textarea');
    node.value = text;
    document.body.append(node);
    node.select();
    document.execCommand('copy');
    node.remove();
  }
  toast(tr('Copied'));
}
function workers() {
  return (model?.team || []).filter(person => (person.role === 'cleaner' || person.role === 'helper') && person.active && !['revoked', 'expired', 'declined'].includes(person.invite));
}
function highlights(plan) {
  const items = plan.highlights || [`${plan.seats} seats (cleaners and helpers)`, 'Branded booking site', 'Jobs, photos and reports (12 months)', plan.support];
  return items.map(item => {
    const seats = String(item).match(/^(\d+) seats \(cleaners and helpers\)$/);
    if (seats) return tr('{n} seats (cleaners and helpers)', {n: seats[1]});
    return tr(item);
  });
}

async function api(path, {method = 'GET', body, quiet = false} = {}) {
  const headers = {'Content-Type':'application/json', Accept:'application/json'};
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  const response = await fetch(path, {method, headers, credentials:'same-origin', body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await response.json().catch(() => ({error:'The server did not answer.'}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.code = data.code || '';
    error.status = response.status;
    error.payload = data;
    if (response.status === 401 && !quiet) {
      model = null;
      csrf = '';
      if (partsOf()[0] !== 'login') location.hash = 'login';
    }
    throw error;
  }
  return data;
}
function apply(data) {
  if (!data?.workspace) return data;
  model = data.workspace;
  csrf = data.workspace.csrf || csrf;
  return data;
}
function signedInHome() {
  if (!model) return 'login';
  if (model.access.mode === 'onboarding') return 'onboarding';
  if (model.access.mode === 'readonly') return 'trial';
  return 'today';
}
function todayDate() {
  const zone = model?.company?.timeZone || 'UTC';
  try {
    return new Intl.DateTimeFormat(uiLocale(), {weekday:'long', month:'long', day:'numeric', timeZone: zone}).format(new Date());
  } catch {
    return new Intl.DateTimeFormat(uiLocale(), {weekday:'long', month:'long', day:'numeric'}).format(new Date());
  }
}
function handleError(error) {
  if (error.status === 401 || error.code === 'auth') return;
  if (error.code === 'seat_limit') {
    const reason = error.payload?.reason || 'invite';
    const plan = error.payload?.plan || model?.plan?.key || '';
    location.hash = `team/limit?reason=${encodeURIComponent(reason)}&plan=${encodeURIComponent(plan)}`;
    return;
  }
  if (error.code === 'expired' || error.status === 410) {
    location.hash = 'expired';
    return;
  }
  toast(error.message || tr('Something went wrong.'));
}
function openSheet({title, text, confirm, danger = false, cancel = 'Cancel', onConfirm}) {
  sheet.innerHTML = `<div class="panel"><div class="grab"></div><h2>${esc(tr(title))}</h2><p>${esc(tr(text))}</p><div class="stack"><button class="btn secondary" type="button" data-sheet="cancel">${esc(tr(cancel))}</button>${confirm ? `<button class="btn ${danger ? 'danger' : ''}" type="button" data-sheet="ok">${esc(tr(confirm))}</button>` : ''}</div></div>`;
  if (!sheet.open) sheet.showModal();
  sheet.querySelector('[data-sheet="cancel"]').onclick = () => sheet.close();
  const ok = sheet.querySelector('[data-sheet="ok"]');
  if (ok) ok.onclick = async () => {
    ok.disabled = true;
    try { await onConfirm(); sheet.close(); }
    catch (error) { handleError(error); if (sheet.open) sheet.close(); }
  };
}

function icon(name) {
  const common = 'viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"';
  const paths = {
    menu:`<path d="M4 7h16M4 12h16M4 17h16"/>`,
    back:`<path d="M15 5 8 12l7 7"/>`,
    bell:`<path d="M6 16V10a6 6 0 1 1 12 0v6l1.5 2h-15Z"/><path d="M10 19a2 2 0 0 0 4 0"/>`,
    home:`<path d="M4 11 12 4l8 7"/><path d="M7 10.5V20h10v-9.5"/>`,
    today:`<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>`,
    jobs:`<path d="M8 7V5h8v2"/><rect x="4" y="7" width="16" height="13" rx="2"/>`,
    team:`<circle cx="9" cy="9" r="3"/><circle cx="16" cy="10" r="2"/><path d="M4 19c1-3 3-4 5-4s4 1 5 4M14 19c.4-1.6 1.4-2.6 3-3"/>`,
    reports:`<path d="M6 20V10M12 20V6M18 20v-7"/>`,
    settings:`<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>`,
    card:`<rect x="2" y="6" width="14" height="10" rx="2"/><path d="M2 10h14M5 13h4"/><path d="M10 8h10v9a2 2 0 0 1-2 2H8"/>`,
  };
  return `<svg ${common}>${paths[name] || ''}</svg>`;
}

function topbar(title, {back = '', plain = false} = {}) {
  if (!model || plain) {
    return `<header class="plain-top"><a class="brand" href="./">${icon('home')} KlarraumApp</a></header>`;
  }
  const letter = esc(model.account.name.slice(0, 1).toUpperCase());
  const backLink = back ? `<a class="back mobile-only" href="${esc(back)}" aria-label="${esc(tr('Back'))}">${icon('back')}</a>` : `<a class="icon-btn" href="#menu" aria-label="${esc(tr('Menu'))}">${icon('menu')}</a>`;
  return `<header class="top"><div class="top-actions">${backLink}</div><h1>${esc(title)}</h1><div class="top-actions"><a class="bell" href="#inbox" aria-label="${esc(tr('Inbox'))}">${icon('bell')}</a><a class="avatar" href="#settings/billing/plan" aria-label="${esc(tr('Your plan'))}">${letter}</a><button class="signout" type="button" data-action="logout">${esc(tr('Sign out'))}</button></div></header>`;
}
function sidebar(active) {
  const items = [
    ['today', '#today', tr('Today'), ''],
    ['jobs', '#jobs', tr('Jobs'), ''],
    ['team', '#team', tr('Team'), ''],
    ['reports', '#reports', tr('Reports'), ''],
    ['settings', '#settings', tr('Settings'), ''],
  ];
  return `<aside class="side"><a class="brand" href="#${esc(signedInHome())}">${icon('home')} KlarraumApp</a><nav>${items.map(([key, href, label, note]) => `<a class="${active === key ? 'active' : ''}" href="${href}">${icon(key === 'today' ? 'today' : key === 'jobs' ? 'jobs' : key)}${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</a>`).join('')}</nav></aside>`;
}
function frame({title, screen, back = '', body, active = '', plain = false}) {
  const heading = tr(title);
  document.documentElement.lang = uiLocale().slice(0, 2);
  document.title = `${heading} · KlarraumApp`;
  if (plain || !model) return `<main class="plain" data-screen="${screen}">${topbar(heading, {plain:true})}${body}</main>`;
  if (wide) {
    const letter = esc(model.account.name.slice(0, 1).toUpperCase());
    return `<div class="desk" data-screen="${screen}">${sidebar(active)}<div class="desk-main"><header class="desk-top"><h1>${esc(heading)}</h1><div class="top-actions"><a class="bell" href="#inbox" aria-label="${esc(tr('Inbox'))}">${icon('bell')}</a><span class="pill">${esc(model.plan.name)}</span><a class="avatar" href="#settings/billing/plan" aria-label="${esc(tr('Your plan'))}">${letter}</a><button class="signout" type="button" data-action="logout">${esc(tr('Sign out'))}</button></div></header>${body}</div></div>`;
  }
  return `<main class="phone" data-screen="${screen}">${topbar(heading, {back})}${body}</main>`;
}
function ownerNote() {
  return model.account.owner ? '' : `<p class="tiny">${esc(tr('Only the company owner can change the plan or Connect. You can view both.'))}</p>`;
}
function planCards(plans, {current = '', action = 'choose-plan'} = {}) {
  return `<div class="plan-grid three">${plans.map(plan => `<article class="plan-card ${plan.key === current ? 'current' : ''}"><div class="plan-top"><div><strong>${esc(plan.name)}</strong>${plan.key === current ? ` <span class="badge on">${esc(tr('Current plan'))}</span>` : ''}</div><span class="price">${planPrice(plan.cents)}</span></div><ul>${highlights(plan).map(item => `<li>✓ ${esc(item)}</li>`).join('')}</ul>${plan.key === current ? `<button class="btn secondary" type="button" disabled>${esc(tr('Current plan'))}</button>` : `<button class="btn ${plan.cents > (plans.find(item => item.key === current)?.cents || 0) ? '' : 'secondary'}" type="button" data-action="${action}" data-plan="${esc(plan.key)}" ${model && !model.account.owner ? 'disabled' : ''}>${current && plan.cents < (plans.find(item => item.key === current)?.cents || 0) ? esc(tr('Downgrade')) : current ? esc(tr('Upgrade')) : esc(tr('Choose')) + ' ' + esc(plan.name)}</button>`}</article>`).join('')}</div><p class="tiny">${esc(tr('Prices include VAT. Photos and reports are kept for 12 months. A trial is 5 days on Pro, with no card at the start. Admins do not use a seat.'))}</p>`;
}

function settingsLinks() {
  const connect = model.connect.status === 'connected' ? tr('Connected') : model.connect.status === 'incomplete' ? tr('Setup not finished') : tr('Not connected');
  const rate = `${money(model.prices.homeDisplay, model.prices.currency)} / ${tr(unitLabel(model.prices.areaUnit))}`;
  return [
    ['profile', tr('Company profile'), model.company.name || tr('Add the company')],
    ['area', tr('Service area'), model.serviceArea.length ? tr('{n} postcodes', {n: model.serviceArea.length}) : tr('Add postcodes')],
    ['prices', tr('Service prices'), rate],
    ['site', tr('Booking site'), model.bookingSite.slug || tr('Set the link')],
    ['booking-mode', tr('Booking mode'), tr(modeName[model.bookingMode] || 'Request')],
    ['billing', tr('Billing / Connect'), connect],
    ['language', tr('Language'), langName[model.company.language] || 'English'],
    ['legal', tr('Legal'), ''],
    ['notifications', tr('Notifications'), ''],
    ['calendar', tr('Google Calendar'), model.calendar?.connected ? tr('Connected') : model.integrations.googleCalendar ? tr('Keys saved') : tr('Not connected')],
    ['help', tr('Help'), ''],
  ];
}
function settingsList(active) {
  return `<div class="rows settings-list">${settingsLinks().map(([key, label, detail]) => `<a class="${active === key ? 'active' : ''}" href="#settings/${key === 'billing' ? 'billing' : key}"><span>${esc(label)}${detail ? `<small>${esc(detail)}</small>` : ''}</span><span class="chev"></span></a>`).join('')}</div>`;
}

function requestCard(job, {label, open = false} = {}) {
  const amount = Number.isInteger(job.priceCents) ? job.priceCents / 100 : Number(job.quote || 0);
  const currency = model.company?.currency || job.currency || 'EUR';
  const control = open
    ? `<a class="btn" href="#jobs/${esc(job.id)}">${esc(tr('Assign'))}</a>`
    : `<button class="btn" type="button" data-action="confirm-job"${job.id ? ` data-id="${esc(job.id)}"` : ''}>${esc(tr('Confirm'))}</button>`;
  return `<article class="card job-card"><p class="tiny">${esc(tr(label))}</p><h2>${esc(job.address || '')}</h2><p>${esc(job.areaM2 || '')} m² · ${money(amount, currency)}</p>${control}</article>`;
}
function viewToday() {
  const workersOut = (model.team || []).filter(person => person.active && person.availability === 'on_job').length;
  const plan = model.plan?.name || 'Starter';
  const preview = !todayBoard || todayBoard.preview;
  const newCount = preview ? 1 : todayBoard.counts.newRequests;
  const jobsCount = preview ? 1 : todayBoard.counts.jobsToday;
  const cards = preview
    ? requestCard(model.report || {}, {label:'New request'})
    : [
      ...(todayBoard.attention || []).map(job => requestCard(job, {label:'New request'})),
      ...(todayBoard.assign || []).map(job => requestCard(job, {label:'Accepted', open:true})),
    ].join('') || `<article class="card"><h2>${esc(tr('No new requests'))}</h2><p class="lead">${esc(tr('Jobs from your booking site appear here.'))}</p></article>`;
  const body = `<section class="today-screen"><div class="today-meta"><p class="lead" id="today-date">${esc(todayDate())}</p><span class="badge plan">${esc(plan)}</span></div><div class="kpis"><article class="kpi"><span>${esc(tr('New requests'))}</span><strong>${esc(newCount)}</strong></article><article class="kpi"><span>${esc(tr('Jobs today'))}</span><strong>${esc(jobsCount)}</strong></article><article class="kpi"><span>${esc(tr('Workers out'))}</span><strong>${workersOut}</strong></article></div>${cards}</section>`;
  return frame({screen:'today', title:'Today', active:'today', body});
}
function visitWhen(job) {
  if (!job?.date || !job?.time) return '';
  const [year, month, day] = job.date.split('-').map(Number);
  const date = new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', timeZone:'UTC'}).format(new Date(Date.UTC(year, month - 1, day, 12)));
  const [hour, minute] = job.time.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${date} ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}
function viewJob(id) {
  const job = jobView?.id === id ? jobView : null;
  if (!job) {
    const failed = jobProblem?.id === id;
    const body = failed
      ? `<section class="card"><h2>${esc(tr('Job Detail'))}</h2><p class="lead">${esc(jobProblem.message || tr('Something went wrong.'))}</p><p><a href="#today">${esc(tr('‹ Jobs'))}</a></p></section>`
      : `<p class="lead">${esc(tr('Loading…'))}</p>`;
    return frame({screen:'job-detail', title:'Job Detail', back:'#today', active:'today', body});
  }
  const amount = (Number(job.priceCents) || 0) / 100;
  const currency = model.company?.currency || job.currency || 'EUR';
  const picking = !job.worker || job.reassign;
  const people = picking ? (job.workers || []) : (job.workers || []).filter(worker => worker.id === job.worker.id);
  const rows = people.map(worker => {
    const current = job.worker?.id === worker.id;
    const control = !picking
      ? '<span class="pill">Assigned</span>'
      : `<button class="btn" type="button" data-action="assign-worker" data-job="${esc(job.id)}" data-worker="${esc(worker.id)}" data-version="${esc(job.version)}" ${current ? 'disabled' : ''}>${esc(tr(current ? 'Assigned' : 'Assign'))}</button>`;
    return `<article class="card worker-row"><span class="person-avatar" aria-hidden="true">${esc((worker.name || '?').slice(0, 1))}</span><span class="worker-meta"><strong>${esc(worker.name)}</strong><small>${esc(tr(worker.role || 'Cleaner'))}</small></span>${control}</article>`;
  }).join('') || `<p class="lead">${esc(tr('No workers yet. Invite a cleaner from Team.'))}</p>`;
  const again = picking ? '' : `<button class="btn ghost" type="button" data-action="reassign-worker">${esc(tr('Reassign'))}</button>`;
  const body = `<p><a href="#today">${esc(tr('‹ Jobs'))}</a></p><article class="card job-summary"><div><h2>${esc(tr(job.serviceTitle || 'Home cleaning'))}</h2><p>${esc(visitWhen(job))}</p><p>${esc(job.address || '')}</p></div><strong class="price">${money(amount, currency)}</strong></article><h2 class="section-title">${esc(tr(picking ? 'Assign worker' : 'Assigned worker'))}</h2><div class="stack">${rows}</div>${again}`;
  return frame({screen: picking ? 'job-assign' : 'job-assigned', title:'Job Detail', back:'#today', active:'today', body});
}
function viewLogin() {
  return frame({plain:true, screen:'login', title:'Sign in', body:`<section class="center"><h1>Sign in</h1><p class="lead">For cleaning companies</p><button class="btn" type="button" data-action="google"><span class="google-mark">G</span> Continue with Google</button><div class="or">or</div><form data-form="magic"><label class="field">Email<input name="email" type="email" autocomplete="username" required maxlength="254" placeholder="Email"></label><button class="btn secondary" type="submit">Send sign-in link</button></form><p><a href="#plans">See plans</a></p><p class="tiny">Demo owner: sam@linden.example. Continue with Google stays inside KlarraumApp and does not open a Google account. The free trial is 5 days on Pro.</p></section>`});
}
function viewCheckEmail() {
  const pending = JSON.parse(sessionStorage.getItem('klarraum-pending') || 'null');
  const token = pending?.continueToken;
  return frame({plain:true, screen:'check-email', title:'Check your email', body:`<section><h1>Check your email</h1><p class="lead">${pending?.matched ? `A sign-in link for <strong>${esc(pending.email)}</strong> expires in 15 minutes.` : 'If this email can open the company, the link expires in 15 minutes.'} This demo does not send email.</p>${token ? '<button class="btn" type="button" data-action="open-link">Open sign-in link</button>' : '<a class="btn" href="#login">Back to sign in</a>'}<p><a href="#login">Use a different email</a></p></section>`});
}
function viewExpired() {
  return frame({plain:true, screen:'link-expired', title:'Link expired', body:'<section class="center"><div class="warn">!</div><h1>This link has expired</h1><p class="lead">Sign-in links last 15 minutes. Worker invites last 24 hours.</p><a class="btn" href="#login">Back to sign in</a></section>'});
}
function viewPlans() {
  return frame({plain:true, screen:'plans', title:'Plans', body:`<section><h1>Plans</h1><p class="lead">Starter ${planPrice(4900)} / 2 seats · Pro ${planPrice(8900)} / 5 · Plus ${planPrice(14900)} / 10. The trial is 5 days on Pro. No card at the start.</p>${planCards(CATALOGUE, {action:'plan-signup'})}<p><a href="#login">Back to sign in</a></p></section>`});
}
function viewOnboarding(step) {
  const countries = model?.countries || [{key:'DE', label:'Germany', currency:'EUR', areaUnit:'m2', timeZone:'Europe/Berlin'}];
  if (step === 'site') {
    return frame({plain:true, screen:'onboarding-site', title:'Booking site', body:`<section><p class="tiny">Step 2 of 2</p><h1>Your booking site</h1><p class="lead">Clients will use this link. You can change it later.</p><form data-form="site"><label class="field">Your name<input name="person" maxlength="80" value="${esc(model.account.name)}"></label><label class="field">Company name<input name="name" required maxlength="80" value="${esc(model.company.name)}"></label><label class="field">Booking link<input name="slug" required maxlength="40" pattern="[a-z0-9-]+" value="${esc(model.bookingSite.slug)}" placeholder="linden"></label><button class="btn" type="submit">Finish</button></form></section>`});
  }
  const selected = model.company.country || 'DE';
  return frame({plain:true, screen:'onboarding', title:'Set up your company', body:`<section><p class="tiny">Step 1 of 2</p><h1>Where do you work?</h1><p class="lead">The country sets the currency, area unit and time zone. A 5-day Pro trial starts with no card.</p><form data-form="country"><label class="field">Country<select name="country">${countries.map(country => `<option value="${esc(country.key)}" ${country.key === selected ? 'selected' : ''}>${esc(country.label)}</option>`).join('')}</select></label><p class="tiny" id="country-hint"></p><button class="btn" type="submit">Continue</button></form></section>`});
}
function viewMenu() {
  const items = [
    ['#today', 'today', tr('Today'), ''],
    ['#jobs', 'jobs', tr('Jobs'), ''],
    ['#team', 'team', tr('Team'), ''],
    ['#reports', 'reports', tr('Reports'), ''],
    ['#settings', 'settings', tr('Settings'), ''],
  ];
  return frame({screen:'menu', title:'Menu', back:'#today', active:'', body:`<nav class="nav-list" aria-label="${esc(tr('Menu'))}">${items.map(([href, key, label, note]) => `<a href="${href}">${icon(key === 'today' ? 'today' : key)}<span>${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</span></a>`).join('')}</nav>`});
}
function viewSettings(section) {
  const showPanel = section && !(section === 'hub' && !wide);
  const active = section === 'hub' && wide ? 'prices' : section;
  const panelKey = section === 'hub' ? (wide ? 'prices' : '') : section;
  const body = `<div class="settings-split ${showPanel && panelKey ? 'show-panel' : 'show-list'}">${settingsList(active)}<div class="settings-panel">${panelKey ? settingsPanel(panelKey) : ''}</div></div>`;
  const titles = {hub:'Settings', profile:'Company profile', area:'Service area', prices:'Service prices', site:'Booking site', 'booking-mode':'Booking mode', language:'Language', legal:'Legal', notifications:'Notifications', calendar:'Google Calendar', help:'Help'};
  const child = Boolean(panelKey);
  const title = wide ? 'Settings' : (titles[panelKey] || titles[section] || 'Settings');
  return frame({screen: panelKey && panelKey !== 'prices' ? panelKey : 'settings', title, back: child ? '#settings' : '', active:'settings', body});
}
function settingsPanel(section) {
  if (section === 'profile') {
    const company = model.company;
    const hours = company.workingHours || {days:'mon-sat', start:'08:00', end:'18:00'};
    const zones = ['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles'];
    return `<form data-form="profile" class="card"><h2>Company profile</h2><label class="field">Company name<input name="name" required maxlength="80" value="${esc(company.name)}"></label><label class="field">Country<select name="country">${(model.countries || []).map(country => `<option value="${esc(country.key)}" ${country.key === company.country ? 'selected' : ''}>${esc(country.label)}</option>`).join('')}</select></label><label class="field">Currency<select name="currency">${['EUR', 'USD', 'GBP'].map(item => `<option ${item === company.currency ? 'selected' : ''}>${item}</option>`).join('')}</select></label><label class="field">Area unit<select name="areaUnit"><option value="m2" ${company.areaUnit === 'm2' ? 'selected' : ''}>m²</option><option value="sqft" ${company.areaUnit === 'sqft' ? 'selected' : ''}>sq ft</option></select></label><label class="field">Time zone<select name="timeZone">${zones.map(zone => `<option ${zone === company.timeZone ? 'selected' : ''}>${esc(zone)}</option>`).join('')}</select></label><label class="field">Working days<select name="days"><option value="mon-sat" ${hours.days === 'mon-sat' ? 'selected' : ''}>Monday–Saturday</option><option value="mon-fri" ${hours.days === 'mon-fri' ? 'selected' : ''}>Monday–Friday</option><option value="daily" ${hours.days === 'daily' ? 'selected' : ''}>Every day</option></select></label><label class="field">Opens<input name="start" required value="${esc(hours.start)}" pattern="[0-2][0-9]:[0-5][0-9]"></label><label class="field">Closes<input name="end" required value="${esc(hours.end)}" pattern="[0-2][0-9]:[0-5][0-9]"></label><label class="field">Public phone<input name="phone" maxlength="40" value="${esc(company.phone)}"></label><label class="field">Public email<input name="email" type="email" required maxlength="254" value="${esc(company.email)}"></label><label class="field">Address<input name="address" maxlength="160" value="${esc(company.address)}"></label><p class="tiny">Sign-in email: ${esc(model.account.email)}. <a href="#onboarding">Review country, currency and units</a></p><button class="btn" type="submit">Save</button></form>`;
  }
  if (section === 'area') {
    const codes = drafts.area || model.serviceArea;
    return `<form data-form="area" class="card"><h2>Service area</h2><p class="lead">Clients outside these postcodes are asked to contact the company.</p><div class="chips">${codes.map(code => `<button class="chip" type="button" data-action="remove-postcode" data-code="${esc(code)}">${esc(code)} ×</button>`).join('') || '<span class="tiny">No postcodes yet.</span>'}</div><label class="field">Add a postcode<input name="postcode" maxlength="12" placeholder="10115"></label><button class="btn secondary" type="button" data-action="add-postcode">Add</button><button class="btn" type="submit">Save</button></form>`;
  }
  if (section === 'prices') {
    const prices = model.prices;
    const unit = unitLabel(prices.areaUnit);
    return `<form data-form="prices" class="card" data-panel="service-prices"><h2>Service prices</h2><label class="field">Home cleaning<input name="home" type="number" min="0.01" max="500" step="0.01" required value="${esc(prices.homeDisplay)}"></label><label class="field">Office cleaning<input name="office" type="number" min="0.01" max="500" step="0.01" required value="${esc(prices.officeDisplay)}"></label><label class="field">Deep cleaning<input name="deep" type="number" min="0.01" max="500" step="0.01" required value="${esc(prices.deepDisplay)}"></label><p class="tiny">Prices are ${esc(prices.currency)} per ${esc(unit)}.</p><label class="field">Minimum price <span class="tiny">(optional)</span><input name="minimum" type="number" min="0" max="100000" step="0.01" value="${prices.minimum ?? ''}" placeholder="No minimum"></label><label class="field">Max area <span class="tiny">(optional, ${esc(unit)})</span><input name="maxArea" type="number" min="1" step="1" value="${prices.maxAreaDisplay ?? ''}" placeholder="No limit"></label><label class="field">Speed, ${esc(unit)}/h<input name="speed" type="number" min="1" max="10000" step="1" required value="${esc(prices.speedDisplay)}"></label><p class="tiny">Sample job ${esc(model.report.address)} · ${model.report.areaM2} m² · home rate ${money(prices.home, prices.currency)}/m² = ${money(prices.sampleQuote, prices.currency)}. At ${prices.speedM2PerHour} m²/h that is ${durationLabel(prices.sampleDurationMinutes)}. Quote = max(rate × area, minimum price).</p><button class="btn" type="submit">Save</button></form>`;
  }
  if (section === 'site') {
    const url = `${location.origin}/`;
    return `<section class="card" data-panel="booking-site"><h2>Booking site</h2><p class="lead">Share this page with clients. The public site shows your company brand.</p><p><strong>${esc(url)}</strong></p><p class="tiny">Link name: ${esc(model.bookingSite.slug || 'not set')}</p><div class="stack"><button class="btn" type="button" data-action="copy" data-value="${esc(url)}">Copy link</button><a class="btn secondary" href="./" target="_blank" rel="noopener">Preview</a></div></section>`;
  }
  if (section === 'booking-mode') {
    return `<form data-form="booking" data-panel="booking-mode"><p class="tiny">${esc(tr('How clients book'))}</p><div class="card flush">${['paused', 'request', 'instant'].map(mode => `<label class="mode"><input type="radio" name="bookingMode" value="${mode}" ${model.bookingMode === mode ? 'checked' : ''}><span aria-hidden="true">${mode === 'paused' ? '❚❚' : mode === 'instant' ? '⚡' : ''}</span><span><strong>${esc(tr(modeCopy[mode][0]))}${mode === 'request' ? ` <span class="badge on">${esc(tr('Default'))}</span>` : ''}</strong><small>${esc(tr(modeCopy[mode][1]))}</small></span></label>`).join('')}</div><div class="note"><span aria-hidden="true">▦</span><p>${esc(tr('Only free calendar slots are shown to clients. Busy times cannot be booked.'))}</p></div><p class="tiny">${esc(tr('Existing jobs are not affected.'))}</p><button class="btn" type="submit">${esc(tr('Save'))}</button></form>`;
  }
  if (section === 'language') {
    return `<form data-form="language" class="card"><h2>${esc(tr('Language'))}</h2><p class="lead">${esc(tr('English, Deutsch or Русский. This sets the language of KlarraumApp. Customer pages use it too.'))}</p>${['en', 'de', 'ru'].map(code => `<label class="mode"><input type="radio" name="language" value="${code}" ${model.company.language === code ? 'checked' : ''}><span></span><span><strong>${langName[code]}</strong></span></label>`).join('')}<button class="btn" type="submit">${esc(tr('Save'))}</button></form>`;
  }
  if (section === 'legal') {
    return `<form data-form="legal" class="card"><h2>Legal</h2><div class="rows"><a href="./impressum.html" target="_blank" rel="noopener">Impressum <span class="chev"></span></a><a href="./datenschutz.html" target="_blank" rel="noopener">Privacy <span class="chev"></span></a><a href="./customer-terms.html" target="_blank" rel="noopener">Terms <span class="chev"></span></a></div><label class="field">Note for your customers<textarea name="note" maxlength="2000">${esc(model.legal.note || '')}</textarea></label><button class="btn" type="submit">Save</button></form>`;
  }
  if (section === 'notifications') {
    const item = model.notifications;
    const box = (name, label) => `<label class="mode"><input type="checkbox" name="${name}" ${item[name] ? 'checked' : ''}><span></span><span><strong>${label}</strong></span></label>`;
    return `<form data-form="notifications" class="card"><h2>Notifications</h2>${box('requests', 'New requests')}${box('schedule', 'Schedule changes')}${box('payments', 'Payments')}${box('trial', 'Trial reminders')}<button class="btn" type="submit">Save</button></form>`;
  }
  if (section === 'calendar') {
    const ready = Boolean(model.integrations.googleCalendar);
    const connected = Boolean(model.calendar?.connected);
    const status = connected
      ? tr('Google Calendar is connected.')
      : ready
        ? tr('Google keys are saved on this server. Connect a calendar to copy job times. Busy times are not read back.')
        : tr('Google Calendar is not set up on this server. Busy times are not read from a calendar.');
    const actions = !ready ? '' : `<div class="stack"><button class="btn" type="button" data-action="connect-calendar">${esc(tr('Connect Google Calendar'))}</button>${connected ? `<button class="btn secondary" type="button" data-action="sync-calendar">${esc(tr('Sync jobs'))}</button><button class="btn ghost" type="button" data-action="disconnect-calendar">${esc(tr('Disconnect'))}</button>` : ''}</div>`;
    return `<section class="card"><h2>${esc(tr('Google Calendar'))}</h2><p class="lead">${esc(status)}</p>${actions}</section>`;
  }
  if (section === 'help') {
    const messages = model.help.length ? `<div class="thread">${model.help.map(message => `<article class="bubble"><b>${esc(message.name || 'You')}</b>${esc(message.body)}</article>`).join('')}</div>` : '<p class="lead">Send a message to KlarraumApp. An operator replies in this thread.</p>';
    return `<section class="card"><h2>Help</h2>${messages}<form data-form="help"><label class="field">Message<textarea name="message" required maxlength="2000" placeholder="How can we help?"></textarea></label><button class="btn" type="submit">Send</button></form><p class="tiny">Email copies are not sent in the pilot.</p></section>`;
  }
  return '';
}

function connectArt() {
  return `<svg class="icon-art" viewBox="0 0 120 80" aria-hidden="true"><rect x="8" y="28" width="52" height="36" rx="6" fill="#fff" stroke="#3d6848" stroke-width="3"/><rect x="8" y="38" width="52" height="10" fill="#3d6848"/><rect x="16" y="54" width="18" height="4" fill="#3d6848"/><path d="M58 18h40v34H70" fill="none" stroke="#3d6848" stroke-width="3"/><path d="M70 18v44M86 18v28M102 18v28" stroke="#3d6848" stroke-width="3"/><path d="M64 62h40v8H64z" fill="#3d6848"/></svg>`;
}
function connectCard() {
  const connect = model.connect;
  if (connect.status === 'connected') {
    return `<section class="card"><div class="connect-head"><span class="ok-bubble">✓</span><h2>Stripe connected</h2><span class="badge on">Active</span></div><div class="kv"><span>Account</span><span>${esc(connect.accountLabel)}</span></div><div class="kv"><span>Payouts</span><span>To your bank</span></div><div class="kv"><span>Bank</span><span>${esc(connect.bankLabel)}</span></div><div class="kv"><span>Card payments</span><span>On</span></div><p class="tiny center">Customer payments go to your Stripe account.<br>KlarraumApp billing is separate.</p></section><div class="stack"><button class="btn" type="button" data-action="manage-connect" ${model.account.owner ? '' : 'disabled'}>Manage</button><button class="btn secondary" type="button" data-action="ask-disconnect" ${model.account.owner ? '' : 'disabled'}>Disconnect</button></div>`;
  }
  if (connect.status === 'incomplete') {
    return `<section class="card center"><div class="warn">!</div><h2>Stripe setup not finished</h2><p><span class="badge wait">Incomplete</span></p><p>Stripe needs a few more details before you can take card payments. Nothing was charged.</p><div class="stack"><button class="btn" type="button" data-action="connect" ${model.account.owner ? '' : 'disabled'}>Retry setup</button><a class="btn ghost" href="#settings">Do it later</a></div></section><p class="tiny center">Cash on site still works for all jobs.</p>`;
  }
  const steps = wide ? `<ol class="steps"><li class="step"><span class="num">1</span> Connect Stripe</li><li class="step"><span class="num">2</span> Add bank details</li><li class="step"><span class="num">3</span> Card pay turns on for bookings</li></ol>` : '';
  return `<div class="connect-layout"><section class="card">${connectArt()}<h2 class="center">Take card payments online</h2><ul class="checks"><li>Customers pay by card when booking</li><li>Payouts go to your bank</li><li>Cash on site keeps working</li></ul><p><span class="badge">Not connected</span></p><button class="btn" type="button" data-action="connect" ${model.account.owner ? '' : 'disabled'}>Connect Stripe</button><p class="tiny center">KlarraumApp billing is separate. Cash on site keeps working.</p></section>${steps}</div>`;
}
function billingTabs(active) {
  return `<div class="tabs" role="tablist"><a class="${active === 'plan' ? 'active' : ''}" href="#settings/billing/plan">Plan</a><a class="${active === 'payments' ? 'active' : ''}" href="#settings/billing">Customer payments</a></div>`;
}
function viewBilling(which) {
  const plan = model.plan;
  const summary = `<div class="plan-line"><span>Your KlarraumApp plan: <strong>${esc(plan.name)} · ${planPrice(plan.cents)}</strong>${plan.nextInvoice ? ` · next invoice ${esc(plan.nextInvoice.shortLabel)}` : ''}</span><a href="#settings/billing/plan">View plan</a></div>`;
  if (which === 'plan') {
    const catalogue = model.plans || CATALOGUE;
    if (!catalogue.some(item => item.key === planCarouselKey)) planCarouselKey = plan.key;
    const index = Math.max(0, catalogue.findIndex(item => item.key === planCarouselKey));
    const shown = catalogue[index] || plan;
    const features = [...(shown.highlights || highlights(shown)), ...(model.sharedFeatures || SHARED)].filter((item, pos, all) => all.indexOf(item) === pos);
    const body = `${billingTabs('plan')}${ownerNote()}<section class="card plan-detail"><p class="tiny">Your KlarraumApp plan</p><div class="plan-carousel" data-plan-carousel><div class="carousel-top"><button class="icon-btn" type="button" data-action="plan-prev" ${index === 0 ? 'disabled' : ''} aria-label="Previous plan">←</button><span>${index + 1} / ${catalogue.length}</span><button class="icon-btn" type="button" data-action="plan-next" ${index === catalogue.length - 1 ? 'disabled' : ''} aria-label="Next plan">→</button></div><h2>${esc(shown.name)} ${planPrice(shown.cents)}</h2>${shown.key === plan.key ? '<span class="badge on">Current plan</span>' : ''}<ul class="checks">${features.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div><a class="btn ${shown.key === plan.key ? 'secondary' : ''}" href="#settings/billing/change">${shown.key === plan.key ? 'Compare plans' : `Choose ${esc(shown.name)}`}</a><p class="tiny center">Swipe or use the arrows to see every plan. Plan changes are confirmed before any payment setup.</p></section>${demoTools()}`;
    return frame({screen:'billing-plan', title:'Billing', back:'#settings', active:'settings', body});
  }
  if (which === 'change') {
    const used = model.seats.used;
    const included = model.seats.included;
    return frame({screen:'change-plan', title:'Your plan', back:'#settings/billing/plan', active:'settings', body:`${ownerNote()}${planCards(model.plans, {current:model.plan.key})}<p class="seat-foot"><span>Seats used: ${used} of ${included}</span></p><div class="bar" aria-hidden="true"><i data-pct="${Math.round(Math.min(100, included ? (used / included) * 100 : 0))}"></i></div><p class="tiny">Admins do not use a seat. <a href="#settings/billing/plan">Manage billing</a></p>`});
  }
  return frame({screen:'billing-payments', title:'Customer payments', back:'#settings', active:'settings', body:`${billingTabs('payments')}${summary}${ownerNote()}${connectCard()}`});
}
function demoTools() {
  if (!model.demoControls) return '';
  return `<details class="demo"><summary>Demo tools</summary><div class="stack"><button class="btn secondary" type="button" data-action="preview-trial">Preview trial ended</button><button class="btn secondary" type="button" data-action="restore-demo">Restore Pro demo</button><button class="btn secondary" type="button" data-action="demo-as" data-account="alex">View as Alex (admin)</button><button class="btn secondary" type="button" data-action="demo-as" data-account="sam">View as Sam (owner)</button></div></details>`;
}
function viewTrial() {
  const pro = (model.plans || CATALOGUE).find(plan => plan.key === 'pro') || CATALOGUE[1];
  return frame({screen:'trial-ended', title:'KlarraumApp', active:'settings', body:`<div class="tabs"><a class="active" href="#trial">Your plan</a><a href="#settings/billing">Billing</a></div><section class="center"><div class="hero-icon" aria-hidden="true">◷</div><h1>Your free trial has ended</h1><p class="lead">Choose a plan to keep receiving bookings. Your jobs and team are saved. The trial was 5 days.</p></section><article class="card"><div class="plan-top"><strong>Pro</strong><span class="price">${planPrice(pro.cents)}</span></div><ul class="checks">${highlights(pro).map(item => `<li>${esc(item)}</li>`).join('')}</ul></article><p class="tiny center">Public booking page is paused until you subscribe. Your booking mode setting is kept.</p><div class="stack"><button class="btn" type="button" data-action="choose-plan" data-plan="pro" ${model.account.owner ? '' : 'disabled'}>Choose Pro</button><a class="btn secondary" href="#settings/billing/change">See all plans</a><a class="btn ghost" href="#settings/help">Contact support</a></div>${ownerNote()}${demoTools()}`});
}
function viewConnectMock() {
  const manage = hashQuery().get('manage') === '1';
  const body = manage
    ? `<section class="card center"><h2>Stripe Express</h2><p class="lead">The Express dashboard is not opened in this demo. Payouts and bank details stay on the company’s own Stripe account later. Nothing is charged.</p><a class="btn secondary" href="#settings/billing">Back</a></section>`
    : `<section class="card center"><h2>Stripe Connect demo</h2><p class="lead">This stays inside KlarraumApp. No Stripe account is created and nothing is charged. Customer card payments will later be direct charges on your own Express account.</p><div class="stack"><button class="btn" type="button" data-action="finish-connect" data-result="connected">Finish setup</button><button class="btn secondary" type="button" data-action="finish-connect" data-result="incomplete">Leave setup unfinished</button><a href="#settings/billing">Back</a></div></section>`;
  return frame({screen:'connect-mock', title:'Connect Stripe', back:'#settings/billing', active:'settings', body});
}
function viewTeam() {
  const people = workers();
  const list = people.length ? people.map(person => `<a class="card person" href="#team/person/${esc(person.id)}"><span class="person-main"><span class="person-avatar">${esc(person.name.slice(0, 1))}</span><span><strong>${esc(person.name)}</strong><small class="tiny">${esc(roleLabel(person.role))}</small></span></span><span class="badge ${person.invite === 'pending' ? 'wait' : person.availability === 'on_job' ? '' : 'on'}">${esc(person.invite === 'pending' ? tr('Invited') : person.availability === 'on_job' ? tr('On job') : tr('Available'))}</span></a>`).join('') : `<section class="card center" data-empty="team"><h2>${esc(tr('No workers yet'))}</h2><p class="lead">${esc(tr('Invite a cleaner or a helper when you are ready. Admins do not use a seat.'))}</p></section>`;
  const admins = model.admins.map(person => `<p class="tiny">${esc(person.name)} · ${esc(tr('Admin'))}${person.owner ? ' · Owner' : ''}</p>`).join('');
  return frame({screen: people.length ? 'team' : 'team-empty', title:'Team', active:'team', body:`<p><a class="badge plan" href="#settings/billing/plan">${esc(tr('Plan'))}</a> <span class="tiny">${esc(tr('{used} of {included} seats · admins free', {used: model.seats.used, included: model.seats.included}))}</span></p><a class="btn" href="#team/invite">${esc(tr('Invite worker'))}</a><div class="stack">${list}</div><section class="card"><h2>${esc(tr('Admins'))}</h2><p class="tiny">${esc(tr('Admins do not use a seat and do not take jobs. {used} of {included} seats are used by cleaners and helpers.', {used: model.seats.used, included: model.seats.included}))}</p>${admins}</section>`});
}
function viewInvite() {
  return frame({screen:'invite', title:'Invite worker', back:'#team', active:'team', body:`<p><a href="#team">← Back to Team</a></p><form data-form="invite" class="card"><label class="field">Name<input name="name" required maxlength="80"></label><label class="field">Email<input name="email" type="email" required maxlength="254"></label><label class="field">Role<select name="role"><option value="cleaner">Cleaner</option><option value="helper">Helper</option><option value="admin">Admin</option></select></label><label class="field">Invite language<select name="language"><option value="en">English</option><option value="de">Deutsch</option><option value="ru">Русский</option></select></label><p class="tiny">Cleaners and helpers use a seat. Admins do not. The link expires in 24 hours. This demo does not send email.</p><button class="btn" type="submit">Send invite</button></form>`});
}
function viewInviteSent() {
  const invite = JSON.parse(sessionStorage.getItem('klarraum-invite') || 'null');
  if (!invite) return frame({screen:'invite-sent', title:'Invite sent', back:'#team', active:'team', body:'<p class="lead">Send an invite from the team page.</p>'});
  return frame({screen:'invite-sent', title:'Invite sent', back:'#team', active:'team', body:`<section class="card center"><div class="hero-icon">✉</div><h2>Invite ready</h2><p class="lead">${esc(invite.name)} · ${esc(roleName[invite.role] || invite.role)} · ${esc(langName[invite.language] || invite.language)}</p><p class="tiny">The link expires in 24 hours. Cleaners and helpers accept it in the worker app. Admins can open it here.</p><p><strong>${esc(invite.url)}</strong></p><button class="btn" type="button" data-action="copy" data-value="${esc(invite.url)}">Copy link</button></section>`});
}
function viewPerson() {
  const person = model.team.find(item => item.id === partsOf()[2]);
  if (!person) return frame({screen:'worker', title:'Team', back:'#team', active:'team', body:'<p>That person is not on the team.</p>'});
  const pending = person.invite === 'pending';
  return frame({screen:'worker', title:person.name, back:'#team', active:'team', body:`<p><a href="#team">← Back to Team</a></p><section class="card"><div class="person-main"><span class="person-avatar">${esc(person.name.slice(0, 1))}</span><div><h2>${esc(person.name)}</h2><p>${esc(roleName[person.role] || person.role)} · ${esc(person.email)}</p><p class="tiny">${pending ? 'Invite pending' : person.availability === 'on_job' ? 'On job' : 'Available'} · ${esc(langName[person.language] || '')}</p></div></div><button class="btn danger" type="button" data-action="ask-deactivate" data-id="${esc(person.id)}" data-name="${esc(person.name)}" data-pending="${pending ? '1' : ''}">${pending ? 'Cancel invite' : 'Deactivate'}</button></section>`});
}
function viewSeatLimit() {
  const query = hashQuery();
  const reason = query.get('reason') || 'invite';
  const target = (model.plans || []).find(plan => plan.key === query.get('plan')) || model.plan;
  const current = model.plan;
  const used = model.seats.used;
  const included = reason === 'downgrade' ? target.seats : current.seats;
  const width = Math.min(100, included ? (used / included) * 100 : 100);
  const next = model.seats.next;
  const upgrade = reason === 'invite' && next ? `<section class="card"><h2>Upgrade to add more</h2><p>${esc(next.name)} — ${next.seats} seats — ${planPrice(next.cents)}</p></section><a class="btn" href="#settings/billing/change">Upgrade plan</a>` : `<a class="btn" href="#settings/billing/change">Stay on ${esc(current.name)}</a>`;
  const title = reason === 'downgrade' ? `${target.name} includes ${included} seats` : 'All seats are in use';
  const copy = reason === 'downgrade' ? `${used} cleaners and helpers are active. Deactivate someone before moving to ${target.name}.` : `Your ${current.name} plan includes ${included} seats. ${used} of ${included} are taken.`;
  return frame({screen:'seat-limit', title:'Invite worker', back:'#team', active:'team', body:`<p><a href="#team">← Back to Team</a></p><section class="card center"><div class="hero-icon">${icon('team')}</div><h2>${esc(title)}</h2><p class="lead">${esc(copy)}</p><div class="bar"><i data-pct="${Math.round(width)}"></i></div><p class="seat-foot"><span>${used} / ${included} seats</span></p></section><div class="stack">${upgrade}<a class="btn secondary" href="#team">Manage team</a></div><p class="tiny center">Or deactivate a worker to free a seat. Admins do not use a seat.</p>`});
}
function viewJobs() {
  if (!todayBoard) {
    refreshToday();
    return frame({screen:'jobs', title:'Jobs', active:'jobs', body:`<p class="lead">${esc(tr('Loading…'))}</p>`});
  }
  const jobs = [
    ...(todayBoard.attention || []).map(job => ({job, label:'New request'})),
    ...(todayBoard.assign || []).map(job => ({job, label:'Accepted', open:true})),
    ...(todayBoard.today || []).map(job => ({job, label:job.status || 'Scheduled', open:true})),
  ].filter(({job}, index, rows) => job?.id && rows.findIndex(row => row.job.id === job.id) === index);
  const empty = `<section class="card center"><h2>${esc(tr('No jobs yet'))}</h2><p class="lead">${esc(tr('New requests and scheduled work appear here.'))}</p></section>`;
  return frame({screen:'jobs', title:'Jobs', active:'jobs', body:`<div class="stack">${jobs.length ? jobs.map(({job, label, open}) => requestCard(job, {label, open})).join('') : empty}</div>`});
}
function viewReports() {
  const job = model.report;
  if (!job) return frame({screen:'reports-empty', title:'Reports', active:'reports', body:`<section class="card center"><h2>No reports yet</h2><p class="lead">Completed jobs will appear here. There is nothing to export until your company has real completed work.</p></section>`});
  return frame({screen:'reports', title:'Reports', active:'reports', body:`<section class="card"><p class="tiny">${esc(tr('This month · demo job'))}</p><h2>${esc(job.address)}</h2><p class="lead">${job.areaM2} m² · ${money(job.ratePerM2)}/m²</p><p><strong>${money(job.quote)}</strong> · ${esc(tr(job.payment))} · ${esc(tr(job.status))}</p><button class="btn" type="button" data-action="export-open">${esc(tr('Export'))}</button></section>`});
}
function viewInbox() {
  if (!inboxView) return frame({screen:'inbox', title:'Inbox', back:'#today', active:'today', body:`<p class="lead">${esc(tr('Loading…'))}</p>`});
  const items = inboxView.items || [];
  const locale = uiLocale();
  const cards = items.map(item => {
    const when = item.createdAt ? new Intl.DateTimeFormat(locale, {dateStyle:'medium', timeStyle:'short'}).format(new Date(item.createdAt)) : '';
    const title = item.kind === 'job_completed' ? tr('Report submitted') : item.kind === 'worker_unavailable' ? tr('Worker unavailable') : item.kind === 'invite_declined' ? tr('Invite declined') : tr('Notification');
    const body = `<article class="card"><p class="tiny">${esc(when)}</p><h2>${esc(title)}</h2><p>${esc(item.note || '')}</p></article>`;
    return item.jobId ? `<a href="#jobs/${esc(item.jobId)}">${body}</a>` : body;
  }).join('');
  const empty = `<section class="card center" data-empty="inbox"><h2>${esc(tr('No notifications yet'))}</h2><p class="lead">${esc(tr('Job reports and worker updates show up here.'))}</p></section>`;
  const out = inboxView.workersOut ? `<p class="tiny">${esc(tr('Workers out'))}: ${esc(inboxView.workersOut)}</p>` : '';
  return frame({screen:'inbox', title:'Inbox', back:'#today', active:'today', body:`${out}<div class="stack">${items.length ? cards : empty}</div>`});
}
function viewInviteOpen(token) {
  const entry = looked['invite:' + token];
  if (!entry || entry.loading) {
    ensureInvite(token);
    return frame({plain:true, screen:'invite-open', title:'Invite', body:'<p class="lead">Checking the invite…</p>'});
  }
  if (!entry.ok) return viewExpired();
  const admin = entry.role === 'admin';
  return frame({plain:true, screen:'invite-open', title:'Invite', body:`<section class="card center"><h1>${esc(entry.name)}</h1><p class="lead">${esc(roleName[entry.role] || entry.role)} · ${esc(langName[entry.language] || entry.language)} · ${esc(entry.emailMasked)}</p><p class="tiny">${admin ? 'Open this invite to join as an admin. Admins do not use a seat.' : 'The worker app accepts this invite in a later wave. You can reserve the seat now or decline it.'}</p><div class="stack"><button class="btn" type="button" data-action="accept-invite" data-token="${esc(token)}">${admin ? 'Join as admin' : 'Reserve seat'}</button><button class="btn ghost" type="button" data-action="decline-invite" data-token="${esc(token)}">Decline</button></div></section>`});
}

function ensureInvite(token) {
  const key = 'invite:' + token;
  if (looked[key]) return;
  looked[key] = {loading:true};
  api('api/partner/invites/lookup', {method:'POST', body:{token}, quiet:true}).then(data => { looked[key] = data; render(); }).catch(error => { looked[key] = {ok:false, error:error.message}; render(); });
}
function ensureMagic(token) {
  const key = 'link:' + token;
  if (looked[key]) return;
  looked[key] = 'loading';
  api('api/partner/auth/consume', {method:'POST', body:{token}, quiet:true}).then(data => {
    apply(data);
    sessionStorage.removeItem('klarraum-pending');
    location.hash = data.next || signedInHome();
  }).catch(() => { location.hash = 'expired'; });
}
function ensurePlatformGoogle(token) {
  const key = 'google:' + token;
  if (looked[key]) return;
  looked[key] = 'loading';
  api('api/partner/auth/platform-google', {method:'POST', body:{token}, quiet:true}).then(data => {
    apply(data);
    history.replaceState(null, '', location.pathname + location.search + '#' + (data.next || signedInHome()));
    render();
  }).catch(error => {
    looked[key] = {error:error.message};
    location.hash = 'login';
    toast(error.message || 'Google sign-in could not be completed.');
  });
}

function render() {
  wide = matchMedia('(min-width:960px)').matches;
  document.body.classList.toggle('wide', wide);
  const platformGoogleToken = !model ? googleTokenFromHash() : '';
  if (platformGoogleToken) {
    app.innerHTML = frame({plain:true, screen:'google-signin', title:'Signing you in', body:'<p class="lead">Opening your company workspace…</p>'});
    ensurePlatformGoogle(platformGoogleToken);
    return;
  }
  let parts = partsOf();
  if (!allowed(parts)) {
    const dest = !model ? 'login' : model.access.mode === 'onboarding' ? 'onboarding' : 'trial';
    if ((parts[0] || '') !== dest) { location.hash = dest; return; }
    parts = [dest];
  }
  if (!parts.length) parts = [signedInHome()];
  const [head, second] = parts;
  let html = '';
  if (!model && head === 'link' && second) html = frame({plain:true, screen:'check-email', title:'Check your email', body:'<p class="lead">Opening your link…</p>'});
  else if (head === 'login') html = viewLogin();
  else if (head === 'check-email') html = viewCheckEmail();
  else if (head === 'expired') html = viewExpired();
  else if (head === 'plans') html = viewPlans();
  else if (head === 'link' && second) { html = frame({plain:true, screen:'check-email', title:'Check your email', body:'<p class="lead">Opening your link…</p>'}); ensureMagic(second); }
  else if (head === 'invite' && second) html = viewInviteOpen(second);
  else if (head === 'onboarding') html = viewOnboarding(second === 'site' ? 'site' : 'country');
  else if (head === 'today') html = viewToday();
  else if (head === 'jobs' && second) html = viewJob(second);
  else if (head === 'jobs') html = viewJobs();
  else if (head === 'menu' && wide) { showHomeInstead(); return; }
  else if (head === 'menu') html = viewMenu();
  else if (head === 'team' && second === 'invite') html = viewInvite();
  else if (head === 'team' && second === 'sent') html = viewInviteSent();
  else if (head === 'team' && second === 'limit') html = viewSeatLimit();
  else if (head === 'team' && second === 'person') html = viewPerson();
  else if (head === 'team') html = viewTeam();
  else if (head === 'reports') html = viewReports();
  else if (head === 'inbox') html = viewInbox();
  else if (head === 'trial') html = viewTrial();
  else if (head === 'connect') html = viewConnectMock();
  else if (head === 'settings' && second === 'billing') html = viewBilling(parts[2] === 'plan' ? 'plan' : parts[2] === 'change' ? 'change' : 'payments');
  else if (head === 'settings') html = viewSettings(second || 'hub');
  else if (wide) { showHomeInstead(); return; }
  else html = viewMenu();
  app.innerHTML = html;
  const carousel = app.querySelector('[data-plan-carousel]');
  if (carousel) {
    let startX = null;
    carousel.addEventListener('pointerdown', event => { startX = event.clientX; });
    carousel.addEventListener('pointerup', event => {
      if (startX == null || Math.abs(event.clientX - startX) < 42) return;
      const plans = model.plans || CATALOGUE;
      const index = Math.max(0, plans.findIndex(item => item.key === planCarouselKey));
      const next = Math.max(0, Math.min(plans.length - 1, index + (event.clientX < startX ? 1 : -1)));
      planCarouselKey = plans[next].key;
      render();
    });
  }
  const hint = document.querySelector('#country-hint');
  const select = document.querySelector('select[name="country"]');
  if (hint && select && model?.countries) {
    const write = () => {
      const country = model.countries.find(item => item.key === select.value);
      hint.textContent = country ? `${country.label} uses ${country.currency}, ${country.areaUnit === 'sqft' ? 'sq ft' : 'm²'} and ${country.timeZone}.` : '';
    };
    select.addEventListener('change', write);
    write();
  }
  if (head === 'today' && model && !todayBoard) refreshToday();
  if (head === 'jobs' && second && jobView?.id !== second && jobProblem?.id !== second) loadJob(second);
  if (head === 'inbox' && model && !inboxView) loadInbox();
}
function showHomeInstead() {
  const next = '#' + signedInHome();
  if (location.hash === next) return;
  history.replaceState(null, '', location.pathname + location.search + next);
  if (location.hash === next) render();
}
function allowed(parts) {
  const head = parts[0] || '';
  if (!head) return true;
  if (!model) return ['login', 'check-email', 'expired', 'plans', 'link', 'invite'].includes(head);
  if (model.access.mode === 'onboarding') return ['onboarding', 'login', 'expired', 'link'].includes(head);
  if (model.access.mode === 'readonly') {
    if (['trial', 'reports', 'inbox', 'login', 'expired', 'help'].includes(head)) return true;
    if (head === 'settings' && (parts[1] === 'billing' || parts[1] === 'help')) return true;
    return false;
  }
  return true;
}

const forms = {
  async magic(form) {
    const data = await api('api/partner/auth/start', {method:'POST', body:{mode:'signin', email:form.email.value}});
    sessionStorage.setItem('klarraum-pending', JSON.stringify(data));
    location.hash = 'check-email';
  },
  async country(form) {
    apply(await api('api/partner/onboarding', {method:'POST', body:{country:form.country.value}}));
    location.hash = 'onboarding/site';
  },
  async site(form) {
    apply(await api('api/partner/onboarding/site', {method:'POST', body:{name:form.name.value, slug:form.slug.value, person:form.person.value}}));
    toast(tr('Saved'));
    location.hash = signedInHome();
  },
  async profile(form) {
    const field = name => form.elements[name].value;
    apply(await api('api/partner/company', {method:'PUT', body:{name:field('name'), country:field('country'), currency:field('currency'), areaUnit:field('areaUnit'), timeZone:field('timeZone'), days:field('days'), start:field('start'), end:field('end'), phone:field('phone'), email:field('email'), address:field('address')}}));
    toast(tr('Saved'));
    render();
  },
  async area(form) {
    const codes = drafts.area || [...model.serviceArea];
    if (form.postcode.value.trim()) codes.push(form.postcode.value.trim());
    apply(await api('api/partner/area', {method:'PUT', body:{postcodes:codes}}));
    delete drafts.area;
    toast(tr('Saved'));
    render();
  },
  async prices(form) {
    const value = name => form.elements[name].value;
    apply(await api('api/partner/prices', {method:'PUT', body:{home:value('home'), office:value('office'), deep:value('deep'), minimum:value('minimum'), maxArea:value('maxArea'), speed:value('speed')}}));
    toast(tr('Saved'));
    render();
  },
  async booking(form) {
    apply(await api('api/partner/booking-mode', {method:'PUT', body:{bookingMode:form.bookingMode.value}}));
    toast(tr('Saved'));
    render();
  },
  async language(form) {
    apply(await api('api/partner/language', {method:'PUT', body:{language:form.language.value}}));
    toast(tr('Saved'));
    render();
  },
  async notifications(form) {
    apply(await api('api/partner/notifications', {method:'PUT', body:{requests:form.requests.checked, schedule:form.schedule.checked, payments:form.payments.checked, trial:form.trial.checked}}));
    toast(tr('Saved'));
    render();
  },
  async legal(form) {
    apply(await api('api/partner/legal', {method:'PUT', body:{note:form.note.value}}));
    toast(tr('Saved'));
    render();
  },
  async help(form) {
    apply(await api('api/partner/help', {method:'POST', body:{message:form.message.value}}));
    toast(tr('Saved'));
    render();
  },
  async invite(form) {
    const data = apply(await api('api/partner/team/invites', {method:'POST', body:{name:form.name.value, email:form.email.value, role:form.role.value, language:form.language.value}}));
    sessionStorage.setItem('klarraum-invite', JSON.stringify(data.invite));
    location.hash = 'team/sent';
  },
};

function reportCsv() {
  const job = model.report;
  const currency = job.currency || model.company?.currency || 'EUR';
  const cells = [job.address, job.areaM2, job.ratePerM2, job.quote, currency, job.payment, job.status].map(value => {
    const text = String(value ?? '');
    const guarded = /^[\t\r\n \uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${guarded.replaceAll('"', '""')}"`;
  });
  return `address,area_m2,rate_per_m2,quote,currency,payment,status\n${cells.join(',')}\n`;
}
function clickAttachment(href, filename, contents) {
  const link = document.createElement('a');
  if (href) link.href = href;
  else {
    link.href = URL.createObjectURL(new Blob([contents], {type: 'application/octet-stream'}));
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  }
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}
function saveFile({filename, contents, type, href}) {
  // iOS Safari ignores blob: URLs and the download attribute for text/csv and JSON,
  // and revoking the URL immediately cancels the save. Share a File when the browser
  // can open the system sheet; otherwise navigate to a same-origin attachment.
  const file = new File([contents], filename, {type: type || 'application/octet-stream'});
  if (navigator.canShare && navigator.canShare({files: [file]})) {
    navigator.share({files: [file], title: filename}).catch(error => {
      if (error?.name !== 'AbortError') clickAttachment(href, filename, contents);
    });
    return;
  }
  clickAttachment(href, filename, contents);
}

app.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !forms[form.dataset.form]) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try { await forms[form.dataset.form](form); }
  catch (error) { handleError(error); }
  finally { if (button?.isConnected) button.disabled = false; }
});
app.addEventListener('click', async event => {
  const node = event.target.closest('[data-action]');
  if (!node || !app.contains(node)) return;
  const action = node.dataset.action;
  try {
    if (action === 'confirm-job') {
      node.disabled = true;
      try {
        const body = node.dataset.id ? {id: node.dataset.id} : {};
        const data = await api('api/partner/jobs/confirm', {method:'POST', body});
        jobView = data.job;
        todayBoard = null;
        const next = `jobs/${data.job.id}`;
        if (location.hash === `#${next}`) render();
        else location.hash = next;
      } catch (error) {
        node.disabled = false;
        throw error;
      }
    } else if (action === 'assign-worker') {
      node.disabled = true;
      try {
        const data = await api(`api/partner/jobs/${node.dataset.job}/assign`, {method:'POST', body:{employeeId: node.dataset.worker, version: Number(node.dataset.version)}});
        jobView = data.job;
        toast(tr('Saved'));
        render();
      } catch (error) {
        node.disabled = false;
        throw error;
      }
    } else if (action === 'reassign-worker') {
      if (jobView) jobView.reassign = true;
      render();
    } else if (action === 'inbox') location.hash = 'inbox';
    else if (action === 'logout') {
      await api('api/partner/auth/logout', {method:'POST', body:{}});
      model = null; csrf = ''; location.hash = 'login';
    } else if (action === 'plan-signup') location.hash = 'login';
    else if (action === 'google') {
      apply(await api('api/partner/auth/google', {method:'POST', body:{}}));
      location.hash = signedInHome();
    } else if (action === 'open-link') {
      const pending = JSON.parse(sessionStorage.getItem('klarraum-pending') || 'null');
      if (!pending?.continueToken) throw new Error('Request a new sign-in link.');
      apply(await api('api/partner/auth/consume', {method:'POST', body:{token:pending.continueToken}}));
      sessionStorage.removeItem('klarraum-pending');
      location.hash = signedInHome();
    } else if (action === 'copy') await copyText(node.dataset.value || '');
    else if (action === 'connect') {
      const data = await api('api/partner/connect/start', {method:'POST', body:{}});
      location.href = data.url;
    } else if (action === 'finish-connect') {
      apply(await api('api/partner/connect/finish', {method:'POST', body:{result:node.dataset.result}}));
      toast(tr('Saved'));
      location.hash = 'settings/billing';
    } else if (action === 'manage-connect') location.hash = 'connect/mock?manage=1';
    else if (action === 'connect-calendar') {
      const data = await api('api/partner/calendar/connect', {method:'POST', body:{}});
      if (!data.url) throw new Error(tr('Google Calendar is not set up on this server.'));
      location.assign(data.url);
    } else if (action === 'sync-calendar') {
      const data = await api('api/partner/calendar/sync', {method:'POST', body:{}});
      toast(tr('Copied {n} jobs.', {n: data.copied ?? 0}));
    } else if (action === 'disconnect-calendar') {
      await api('api/partner/calendar/disconnect', {method:'POST', body:{}});
      model.calendar = {connected:false, email:''};
      toast(tr('Saved'));
      render();
    } else if (action === 'ask-disconnect') openSheet({title:'Disconnect Stripe?', text:'Online card payments will pause. Cash on site keeps working.', confirm:'Disconnect', danger:true, onConfirm: async () => { apply(await api('api/partner/connect/disconnect', {method:'POST', body:{}})); toast(tr('Saved')); render(); }});
    else if (action === 'manage-billing') openSheet({title:'Manage billing with Stripe', text:'Stripe Billing is not connected in this demo. Plan charges stay with the operator. Nothing is charged from this page.', confirm:'Close', cancel:'Back', onConfirm: async () => {}});
    else if (action === 'plan-prev' || action === 'plan-next') {
      const plans = model.plans || CATALOGUE;
      const index = Math.max(0, plans.findIndex(item => item.key === planCarouselKey));
      const next = Math.max(0, Math.min(plans.length - 1, index + (action === 'plan-next' ? 1 : -1)));
      planCarouselKey = plans[next].key;
      render();
    }
    else if (action === 'ask-cancel') openSheet({title:'Cancel subscription?', text:'The workspace stays open until the end of this period. This demo does not call Stripe.', confirm:'Cancel subscription', danger:true, cancel:'Keep plan', onConfirm: async () => { apply(await api('api/partner/plan/cancel', {method:'POST', body:{}})); toast(tr('Saved')); render(); }});
    else if (action === 'choose-plan') {
      apply(await api('api/partner/plan', {method:'POST', body:{key:node.dataset.plan}}));
      toast(tr('Saved'));
      location.hash = 'settings/billing/plan';
    } else if (action === 'preview-trial') {
      apply(await api('api/partner/plan/preview-trial', {method:'POST', body:{}}));
      location.hash = 'trial';
    } else if (action === 'restore-demo') {
      apply(await api('api/partner/plan/restore-demo', {method:'POST', body:{}}));
      toast(tr('Saved'));
      location.hash = 'settings/billing/plan';
    } else if (action === 'demo-as') {
      apply(await api('api/partner/auth/demo-as', {method:'POST', body:{accountId:node.dataset.account}}));
      toast(tr('Saved'));
      render();
    } else if (action === 'add-postcode') {
      const form = node.closest('form');
      const code = form.postcode.value.trim();
      if (!code) return;
      drafts.area = [...(drafts.area || model.serviceArea), code];
      render();
    } else if (action === 'remove-postcode') {
      drafts.area = (drafts.area || [...model.serviceArea]).filter(code => code !== node.dataset.code);
      render();
    } else if (action === 'ask-deactivate') {
      const pending = node.dataset.pending === '1';
      openSheet({title: pending ? 'Cancel invite?' : tr('Deactivate {name}?', {name: node.dataset.name}), text: pending ? 'The seat is freed. The link stops working.' : 'They lose access. Their seat is freed. Existing jobs are not deleted.', confirm: pending ? 'Cancel invite' : 'Deactivate', danger:true, onConfirm: async () => { apply(await api('api/partner/team/deactivate', {method:'POST', body:{id:node.dataset.id}})); toast(tr('Saved')); location.hash = 'team'; }});
    } else if (action === 'export-open') {
      openSheet({title:'Export report', text:'Download the demo month as CSV or JSON. This is not an invoice.', confirm:'Download CSV', cancel:'Download JSON', onConfirm: async () => saveFile({filename:'klarraum-report.csv', contents: reportCsv(), type:'text/csv', href:'api/partner/export?format=csv'})});
      sheet.querySelector('[data-sheet="cancel"]').onclick = () => { saveFile({filename:'klarraum-report.json', contents: JSON.stringify(model.report, null, 2), type:'application/json', href:'api/partner/export?format=json'}); sheet.close(); };
    } else if (action === 'download-invoice') {
      const invoice = model.invoices.find(item => item.id === node.dataset.id);
      if (invoice) saveFile({filename:`${invoice.id}.txt`, contents:`KlarraumApp\n${invoice.label}\n${model.plan.name}\n${money(invoice.cents / 100)}\n${invoice.status}\nDemo invoice. Nothing was charged from this file.\n`, type:'text/plain', href:`api/partner/export?format=invoice&id=${encodeURIComponent(invoice.id)}`});
    } else if (action === 'accept-invite') {
      const data = await api('api/partner/invites/accept', {method:'POST', body:{token:node.dataset.token}});
      if (data.workspace) { apply(data); location.hash = signedInHome(); }
      else { toast(tr('Saved')); app.innerHTML = frame({plain:true, screen:'invite-open', title:'Invite', body:`<section class="card center"><h1>${esc(tr('Seat reserved'))}</h1><p class="lead">${esc(tr(data.note || 'The worker signs in from the worker app.'))}</p></section>`}); }
    } else if (action === 'decline-invite') {
      await api('api/partner/invites/decline', {method:'POST', body:{token:node.dataset.token}});
      app.innerHTML = frame({plain:true, screen:'invite-open', title:'Invite', body:'<section class="card center"><h1>Invite declined</h1><p class="lead">The seat is free. The company sees this in Team.</p></section>'});
    }
  } catch (error) { handleError(error); }
});

async function refreshToday() {
  if (refreshToday.running) return;
  refreshToday.running = true;
  try {
    todayBoard = await api('api/partner/today');
    if ((partsOf()[0] || '') === 'today') render();
  } catch (error) { handleError(error); }
  finally { refreshToday.running = false; }
}
async function loadInbox() {
  if (inboxLoading) return;
  inboxLoading = true;
  try {
    inboxView = await api('api/partner/inbox');
    if ((partsOf()[0] || '') === 'inbox') render();
  } catch (error) { handleError(error); }
  finally { inboxLoading = false; }
}
async function loadJob(id) {
  try {
    const data = await api(`api/partner/jobs/${id}`);
    if (data?.job?.id !== id) throw new Error(tr('Something went wrong.'));
    jobProblem = null;
    jobView = data.job;
    const [head, second] = partsOf();
    if (head === 'jobs' && second === id) render();
  } catch (error) {
    jobProblem = {id, message: error.message || ''};
    handleError(error);
    const [head, second] = partsOf();
    if (head === 'jobs' && second === id) render();
  }
}
matchMedia('(min-width:960px)').addEventListener('change', render);
window.addEventListener('hashchange', () => {
  const head = partsOf()[0] || '';
  if (head === 'today') todayBoard = null;
  if (head === 'inbox') inboxView = null;
  render();
});
api('api/partner/session', {quiet:true}).then(data => {
  model = data;
  csrf = data.csrf;
  const google = new URLSearchParams(location.search).get('google');
  if (google) {
    history.replaceState(null, '', location.pathname + location.hash);
    toast(google === 'connected' ? tr('Google Calendar connected.') : tr('Google Calendar was not connected.'));
  }
  render();
}).catch(() => { model = null; render(); });
