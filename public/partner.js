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

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = (amount, currency = 'EUR') => `${currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '€'}${Number(amount).toFixed(2)}`;
const planPrice = cents => `€${Number(cents) / 100}/mo`;
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
  toast('Copied');
}
function workers() {
  return (model?.team || []).filter(person => (person.role === 'cleaner' || person.role === 'helper') && person.active && !['revoked', 'expired', 'declined'].includes(person.invite));
}
function highlights(plan) {
  return plan.highlights || [`${plan.seats} seats (cleaners and helpers)`, 'Branded booking site', 'Jobs, photos and reports (12 months)', plan.support];
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
function handleError(error) {
  if (error.code === 'seat_limit') {
    const reason = error.payload?.reason || 'invite';
    const plan = error.payload?.plan || model?.plan?.key || '';
    location.hash = `team/limit?reason=${encodeURIComponent(reason)}&plan=${encodeURIComponent(plan)}`;
    return;
  }
  toast(error.message || 'Something went wrong.');
}
function openSheet({title, text, confirm, danger = false, cancel = 'Cancel', onConfirm}) {
  sheet.innerHTML = `<div class="panel"><div class="grab"></div><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="stack"><button class="btn secondary" type="button" data-sheet="cancel">${esc(cancel)}</button>${confirm ? `<button class="btn ${danger ? 'danger' : ''}" type="button" data-sheet="ok">${esc(confirm)}</button>` : ''}</div></div>`;
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
  const backLink = back ? `<a class="back mobile-only" href="${esc(back)}" aria-label="Back">${icon('back')}</a>` : `<a class="icon-btn" href="#menu" aria-label="Menu">${icon('menu')}</a>`;
  return `<header class="top"><div class="top-actions">${backLink}</div><h1>${esc(title)}</h1><div class="top-actions"><button class="bell" type="button" data-action="inbox" aria-label="Inbox">${icon('bell')}</button><span class="avatar" aria-hidden="true">${letter}</span><button class="signout" type="button" data-action="logout">Sign out</button></div></header>`;
}
function sidebar(active) {
  const items = [
    ['today', '/admin.html', 'Today', ''],
    ['jobs', '/operations.html', 'Jobs', ''],
    ['team', '#team', 'Team', ''],
    ['reports', '#reports', 'Reports', ''],
    ['settings', '#settings', 'Settings', ''],
  ];
  return `<aside class="side"><a class="brand" href="#menu">${icon('home')} KlarraumApp</a><nav>${items.map(([key, href, label, note]) => `<a class="${active === key ? 'active' : ''}" href="${href}">${icon(key === 'today' ? 'today' : key === 'jobs' ? 'jobs' : key)}${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</a>`).join('')}</nav></aside>`;
}
function frame({title, screen, back = '', body, active = '', plain = false}) {
  document.title = `${title} · KlarraumApp`;
  if (plain || !model) return `<main class="plain" data-screen="${screen}">${topbar(title, {plain:true})}${body}</main>`;
  if (wide) {
    return `<div class="desk" data-screen="${screen}">${sidebar(active)}<div class="desk-main"><header class="desk-top"><h1>${esc(title)}</h1><div class="top-actions"><button class="bell" type="button" data-action="inbox" aria-label="Inbox">${icon('bell')}</button><span class="pill">${esc(model.plan.name)}</span><span class="avatar">${esc(model.account.name.slice(0, 1).toUpperCase())}</span><button class="signout" type="button" data-action="logout">Sign out</button></div></header>${body}</div></div>`;
  }
  return `<main class="phone" data-screen="${screen}">${topbar(title, {back})}${body}</main>`;
}
function ownerNote() {
  return model.account.owner ? '' : '<p class="tiny">Only the company owner can change the plan or Connect. You can view both.</p>';
}
function planCards(plans, {current = '', action = 'choose-plan'} = {}) {
  return `<div class="plan-grid three">${plans.map(plan => `<article class="plan-card ${plan.key === current ? 'current' : ''}"><div class="plan-top"><div><strong>${esc(plan.name)}</strong>${plan.key === current ? ' <span class="badge on">Current plan</span>' : ''}</div><span class="price">${planPrice(plan.cents)}</span></div><ul>${highlights(plan).map(item => `<li>✓ ${esc(item)}</li>`).join('')}</ul>${plan.key === current ? '<button class="btn secondary" type="button" disabled>Current plan</button>' : `<button class="btn ${plan.cents > (plans.find(item => item.key === current)?.cents || 0) ? '' : 'secondary'}" type="button" data-action="${action}" data-plan="${esc(plan.key)}" ${model && !model.account.owner ? 'disabled' : ''}>${current && plan.cents < (plans.find(item => item.key === current)?.cents || 0) ? 'Downgrade' : current ? 'Upgrade' : 'Choose ' + esc(plan.name)}</button>`}</article>`).join('')}</div><p class="tiny">Prices include VAT. Photos and reports are kept for 12 months. A trial is 5 days on Pro, with no card at the start. Admins do not use a seat.</p>`;
}

function settingsLinks() {
  const connect = model.connect.status === 'connected' ? 'Connected' : model.connect.status === 'incomplete' ? 'Setup not finished' : 'Not connected';
  const rate = `${money(model.prices.homeDisplay, model.prices.currency)} / ${unitLabel(model.prices.areaUnit)}`;
  return [
    ['profile', 'Company profile', model.company.name || 'Add the company'],
    ['area', 'Service area', model.serviceArea.length ? `${model.serviceArea.length} postcodes` : 'Add postcodes'],
    ['prices', 'Service prices', rate],
    ['site', 'Booking site', model.bookingSite.slug || 'Set the link'],
    ['booking-mode', 'Booking mode', modeName[model.bookingMode] || 'Request'],
    ['billing', 'Billing / Connect', connect],
    ['language', 'Language', langName[model.company.language] || 'English'],
    ['legal', 'Legal', ''],
    ['notifications', 'Notifications', ''],
    ['calendar', 'Google Calendar', model.integrations.googleCalendar ? 'Keys saved' : 'Not connected'],
    ['help', 'Help', ''],
  ];
}
function settingsList(active) {
  return `<div class="rows settings-list">${settingsLinks().map(([key, label, detail]) => `<a class="${active === key ? 'active' : ''}" href="#settings/${key === 'billing' ? 'billing' : key}"><span>${esc(label)}${detail ? `<small>${esc(detail)}</small>` : ''}</span><span class="chev"></span></a>`).join('')}</div>`;
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
  return frame({plain:true, screen:'plans', title:'Plans', body:`<section><h1>Plans</h1><p class="lead">Starter €49 / 2 seats · Pro €89 / 5 · Plus €149 / 10. The trial is 5 days on Pro. No card at the start.</p>${planCards(CATALOGUE, {action:'plan-signup'})}<p><a href="#login">Back to sign in</a></p></section>`});
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
    ['/admin.html', 'today', 'Today', ''],
    ['/operations.html', 'jobs', 'Jobs', ''],
    ['#team', 'team', 'Team', ''],
    ['#reports', 'reports', 'Reports', ''],
    ['#settings', 'settings', 'Settings', ''],
  ];
  return frame({screen:'menu', title:'Menu', active:'', body:`<nav class="nav-list">${items.map(([href, key, label, note]) => `<a href="${href}">${icon(key === 'today' ? 'today' : key)}<span>${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</span></a>`).join('')}</nav>`});
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
    return `<form data-form="booking" data-panel="booking-mode"><p class="tiny">How clients book</p><div class="card flush">${['paused', 'request', 'instant'].map(mode => `<label class="mode"><input type="radio" name="bookingMode" value="${mode}" ${model.bookingMode === mode ? 'checked' : ''}><span aria-hidden="true">${mode === 'paused' ? '❚❚' : mode === 'instant' ? '⚡' : ''}</span><span><strong>${modeCopy[mode][0]}${mode === 'request' ? ' <span class="badge on">Default</span>' : ''}</strong><small>${modeCopy[mode][1]}</small></span></label>`).join('')}</div><div class="note"><span aria-hidden="true">▦</span><p>Only free calendar slots are shown to clients. Busy times cannot be booked.</p></div><p class="tiny">Existing jobs are not affected.</p><button class="btn" type="submit">Save</button></form>`;
  }
  if (section === 'language') {
    return `<form data-form="language" class="card"><h2>Language</h2><p class="lead">English, Deutsch or Русский. Customer pages and emails use this language.</p>${['en', 'de', 'ru'].map(code => `<label class="mode"><input type="radio" name="language" value="${code}" ${model.company.language === code ? 'checked' : ''}><span></span><span><strong>${langName[code]}</strong></span></label>`).join('')}<button class="btn" type="submit">Save</button></form>`;
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
    return `<section class="card"><h2>Google Calendar</h2><p class="lead">${model.integrations.googleCalendar ? 'Google keys are saved on this server.' : 'Google Calendar is not connected.'} Jobs can be exported later. Busy times are not read from the calendar.</p><button class="btn" type="button" disabled>Connect Google Calendar</button></section>`;
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
    const method = plan.paymentMethod ? `${esc(plan.paymentMethod.brand)} ···· ${esc(plan.paymentMethod.last4)}` : 'No card on file';
    const invoices = model.invoices.length ? model.invoices.map(invoice => `<div class="invoice"><span>${esc(invoice.label)}</span><span>${money(invoice.cents / 100)}</span><span class="badge paid">${esc(invoice.status)}</span><button class="btn ghost" type="button" data-action="download-invoice" data-id="${esc(invoice.id)}">Download</button></div>`).join('') : '<p>No invoices yet. The trial does not charge a card.</p>';
    const body = `${billingTabs('plan')}${ownerNote()}<div class="billing-grid"><section class="card"><p class="tiny">Current plan</p><h2>${esc(plan.name)} ${planPrice(plan.cents)}</h2><p class="lead">${plan.nextInvoice ? `Next invoice: ${esc(plan.nextInvoice.label)}` : 'No invoice scheduled.'}<br>Payment method: ${method}</p>${plan.cancelAtPeriodEnd ? '<p class="tiny">Cancellation is noted for the end of the period. Stripe was not called.</p>' : ''}<button class="btn" type="button" data-action="manage-billing" ${model.account.owner ? '' : 'disabled'}>Manage billing with Stripe</button><button class="btn ghost" type="button" data-action="ask-cancel" ${model.account.owner ? '' : 'disabled'}>Cancel subscription</button><p><a href="#settings/billing/change">Change plan</a></p></section><section class="card"><h2>Invoices</h2>${invoices}</section></div><p class="tiny">Prices include VAT. ${plan.paymentMethod?.demo ? 'The card shown is a demo. Nothing is charged.' : ''}</p>${demoTools()}`;
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
  const list = people.length ? people.map(person => `<a class="card person" href="#team/person/${esc(person.id)}"><span class="person-main"><span class="person-avatar">${esc(person.name.slice(0, 1))}</span><span><strong>${esc(person.name)}</strong><small class="tiny">${esc(roleName[person.role] || person.role)}</small></span></span><span class="badge ${person.invite === 'pending' ? 'wait' : person.availability === 'on_job' ? '' : 'on'}">${person.invite === 'pending' ? 'Invited' : person.availability === 'on_job' ? 'On job' : 'Available'}</span></a>`).join('') : `<section class="card center" data-empty="team"><h2>No workers yet</h2><p class="lead">Invite a cleaner or a helper when you are ready. Admins do not use a seat.</p></section>`;
  const admins = model.admins.map(person => `<p class="tiny">${esc(person.name)} · Admin${person.owner ? ' · Owner' : ''}</p>`).join('');
  return frame({screen: people.length ? 'team' : 'team-empty', title:'Team', active:'team', body:`<p><a class="badge plan" href="#settings/billing/plan">Plan</a> <span class="tiny">${model.seats.used} of ${model.seats.included} seats · admins free</span></p><a class="btn" href="#team/invite">Invite worker</a><div class="stack">${list}</div><section class="card"><h2>Admins</h2><p class="tiny">Admins do not use a seat and do not take jobs. ${model.seats.used} of ${model.seats.included} seats are used by cleaners and helpers.</p>${admins}</section>`});
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
function viewReports() {
  const job = model.report;
  return frame({screen:'reports', title:'Reports', active:'reports', body:`<section class="card"><p class="tiny">This month · demo job</p><h2>${esc(job.address)}</h2><p class="lead">${job.areaM2} m² · ${money(job.ratePerM2)}/m²</p><p><strong>${money(job.quote)}</strong> · ${esc(job.payment)} · ${esc(job.status)}</p><button class="btn" type="button" data-action="export-open">Export</button></section><p class="tiny">The same demo job is used across KlarraumApp. This is an internal report, not an invoice. Export stays available after a trial ends.</p>`});
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
    location.hash = data.next || 'menu';
  }).catch(() => { location.hash = 'expired'; });
}

function render() {
  wide = matchMedia('(min-width:960px)').matches;
  document.body.classList.toggle('wide', wide);
  let parts = partsOf();
  if (!allowed(parts)) {
    const dest = !model ? 'login' : model.access.mode === 'onboarding' ? 'onboarding' : 'trial';
    if ((parts[0] || '') !== dest) { location.hash = dest; return; }
    parts = [dest];
  }
  if (!parts.length) parts = !model ? ['login'] : model.access.mode === 'onboarding' ? ['onboarding'] : model.access.mode === 'readonly' ? ['trial'] : ['menu'];
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
  else if (head === 'menu') html = viewMenu();
  else if (head === 'team' && second === 'invite') html = viewInvite();
  else if (head === 'team' && second === 'sent') html = viewInviteSent();
  else if (head === 'team' && second === 'limit') html = viewSeatLimit();
  else if (head === 'team' && second === 'person') html = viewPerson();
  else if (head === 'team') html = viewTeam();
  else if (head === 'reports') html = viewReports();
  else if (head === 'trial') html = viewTrial();
  else if (head === 'connect') html = viewConnectMock();
  else if (head === 'settings' && second === 'billing') html = viewBilling(parts[2] === 'plan' ? 'plan' : parts[2] === 'change' ? 'change' : 'payments');
  else if (head === 'settings') html = viewSettings(second || 'hub');
  else html = viewMenu();
  app.innerHTML = html;
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
}
function allowed(parts) {
  const head = parts[0] || '';
  if (!head) return true;
  if (!model) return ['login', 'check-email', 'expired', 'plans', 'link', 'invite'].includes(head);
  if (model.access.mode === 'onboarding') return ['onboarding', 'login', 'expired', 'link'].includes(head);
  if (model.access.mode === 'readonly') {
    if (['trial', 'reports', 'login', 'expired', 'help'].includes(head)) return true;
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
    toast('Saved');
    location.hash = 'menu';
  },
  async profile(form) {
    const field = name => form.elements[name].value;
    apply(await api('api/partner/company', {method:'PUT', body:{name:field('name'), country:field('country'), currency:field('currency'), areaUnit:field('areaUnit'), timeZone:field('timeZone'), days:field('days'), start:field('start'), end:field('end'), phone:field('phone'), email:field('email'), address:field('address')}}));
    toast('Saved');
    render();
  },
  async area(form) {
    const codes = drafts.area || [...model.serviceArea];
    if (form.postcode.value.trim()) codes.push(form.postcode.value.trim());
    apply(await api('api/partner/area', {method:'PUT', body:{postcodes:codes}}));
    delete drafts.area;
    toast('Saved');
    render();
  },
  async prices(form) {
    const value = name => form.elements[name].value;
    apply(await api('api/partner/prices', {method:'PUT', body:{home:value('home'), office:value('office'), deep:value('deep'), minimum:value('minimum'), maxArea:value('maxArea'), speed:value('speed')}}));
    toast('Saved');
    render();
  },
  async booking(form) {
    apply(await api('api/partner/booking-mode', {method:'PUT', body:{bookingMode:form.bookingMode.value}}));
    toast('Saved');
    render();
  },
  async language(form) {
    apply(await api('api/partner/language', {method:'PUT', body:{language:form.language.value}}));
    toast('Saved');
    render();
  },
  async notifications(form) {
    apply(await api('api/partner/notifications', {method:'PUT', body:{requests:form.requests.checked, schedule:form.schedule.checked, payments:form.payments.checked, trial:form.trial.checked}}));
    toast('Saved');
    render();
  },
  async legal(form) {
    apply(await api('api/partner/legal', {method:'PUT', body:{note:form.note.value}}));
    toast('Saved');
    render();
  },
  async help(form) {
    apply(await api('api/partner/help', {method:'POST', body:{message:form.message.value}}));
    toast('Saved');
    render();
  },
  async invite(form) {
    const data = apply(await api('api/partner/team/invites', {method:'POST', body:{name:form.name.value, email:form.email.value, role:form.role.value, language:form.language.value}}));
    sessionStorage.setItem('klarraum-invite', JSON.stringify(data.invite));
    location.hash = 'team/sent';
  },
};

async function download(filename, contents, type) {
  const blob = new Blob([contents], {type});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  toast('Saved');
}
function reportCsv() {
  const job = model.report;
  return `address,area_m2,rate_eur_per_m2,quote_eur,payment,status\n"${job.address}",${job.areaM2},${job.ratePerM2},${job.quote},${job.payment},${job.status}\n`;
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
    if (action === 'inbox') toast('Inbox opens with Partner Ops.');
    else if (action === 'logout') {
      await api('api/partner/auth/logout', {method:'POST', body:{}});
      model = null; csrf = ''; location.hash = 'login';
    } else if (action === 'plan-signup') location.hash = 'login';
    else if (action === 'google') {
      apply(await api('api/partner/auth/google', {method:'POST', body:{}}));
      location.hash = model.access.mode === 'onboarding' ? 'onboarding' : model.access.mode === 'readonly' ? 'trial' : 'menu';
    } else if (action === 'open-link') {
      const pending = JSON.parse(sessionStorage.getItem('klarraum-pending') || 'null');
      if (!pending?.continueToken) throw new Error('Request a new sign-in link.');
      apply(await api('api/partner/auth/consume', {method:'POST', body:{token:pending.continueToken}}));
      sessionStorage.removeItem('klarraum-pending');
      location.hash = model.access.mode === 'onboarding' ? 'onboarding' : 'menu';
    } else if (action === 'copy') await copyText(node.dataset.value || '');
    else if (action === 'connect') {
      const data = await api('api/partner/connect/start', {method:'POST', body:{}});
      location.href = data.url;
    } else if (action === 'finish-connect') {
      apply(await api('api/partner/connect/finish', {method:'POST', body:{result:node.dataset.result}}));
      toast('Saved');
      location.hash = 'settings/billing';
    } else if (action === 'manage-connect') location.hash = 'connect/mock?manage=1';
    else if (action === 'ask-disconnect') openSheet({title:'Disconnect Stripe?', text:'Online card payments will pause. Cash on site keeps working.', confirm:'Disconnect', danger:true, onConfirm: async () => { apply(await api('api/partner/connect/disconnect', {method:'POST', body:{}})); toast('Saved'); render(); }});
    else if (action === 'manage-billing') openSheet({title:'Manage billing with Stripe', text:'Stripe Billing is not connected in this demo. Plan charges stay with the operator. Nothing is charged from this page.', confirm:'Close', cancel:'Back', onConfirm: async () => {}});
    else if (action === 'ask-cancel') openSheet({title:'Cancel subscription?', text:'The workspace stays open until the end of this period. This demo does not call Stripe.', confirm:'Cancel subscription', danger:true, cancel:'Keep plan', onConfirm: async () => { apply(await api('api/partner/plan/cancel', {method:'POST', body:{}})); toast('Saved'); render(); }});
    else if (action === 'choose-plan') {
      apply(await api('api/partner/plan', {method:'POST', body:{key:node.dataset.plan}}));
      toast('Saved');
      location.hash = 'settings/billing/plan';
    } else if (action === 'preview-trial') {
      apply(await api('api/partner/plan/preview-trial', {method:'POST', body:{}}));
      location.hash = 'trial';
    } else if (action === 'restore-demo') {
      apply(await api('api/partner/plan/restore-demo', {method:'POST', body:{}}));
      toast('Saved');
      location.hash = 'settings/billing/plan';
    } else if (action === 'demo-as') {
      apply(await api('api/partner/auth/demo-as', {method:'POST', body:{accountId:node.dataset.account}}));
      toast('Saved');
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
      openSheet({title: pending ? 'Cancel invite?' : `Deactivate ${node.dataset.name}?`, text: pending ? 'The seat is freed. The link stops working.' : 'They lose access. Their seat is freed. Existing jobs are not deleted.', confirm: pending ? 'Cancel invite' : 'Deactivate', danger:true, onConfirm: async () => { apply(await api('api/partner/team/deactivate', {method:'POST', body:{id:node.dataset.id}})); toast('Saved'); location.hash = 'team'; }});
    } else if (action === 'export-open') {
      openSheet({title:'Export report', text:'Download the demo month as CSV or JSON. This is not an invoice.', confirm:'Download CSV', cancel:'Download JSON', onConfirm: async () => download('klarraum-report.csv', reportCsv(), 'text/csv')});
      sheet.querySelector('[data-sheet="cancel"]').onclick = () => { download('klarraum-report.json', JSON.stringify(model.report, null, 2), 'application/json'); sheet.close(); };
    } else if (action === 'download-invoice') {
      const invoice = model.invoices.find(item => item.id === node.dataset.id);
      if (invoice) await download(`${invoice.id}.txt`, `KlarraumApp\n${invoice.label}\n${model.plan.name}\n${money(invoice.cents / 100)}\n${invoice.status}\nDemo invoice. Nothing was charged from this file.\n`, 'text/plain');
    } else if (action === 'accept-invite') {
      const data = await api('api/partner/invites/accept', {method:'POST', body:{token:node.dataset.token}});
      if (data.workspace) { apply(data); location.hash = 'menu'; }
      else { toast('Saved'); app.innerHTML = frame({plain:true, screen:'invite-open', title:'Invite', body:`<section class="card center"><h1>Seat reserved</h1><p class="lead">${esc(data.note || 'The worker signs in from the worker app.')}</p></section>`}); }
    } else if (action === 'decline-invite') {
      await api('api/partner/invites/decline', {method:'POST', body:{token:node.dataset.token}});
      app.innerHTML = frame({plain:true, screen:'invite-open', title:'Invite', body:'<section class="card center"><h1>Invite declined</h1><p class="lead">The seat is free. The company sees this in Team.</p></section>'});
    }
  } catch (error) { handleError(error); }
});

matchMedia('(min-width:960px)').addEventListener('change', render);
window.addEventListener('hashchange', render);
api('api/partner/session', {quiet:true}).then(data => { model = data; csrf = data.csrf; render(); }).catch(() => { model = null; render(); });
