import {applySite} from './site.js';
import {resolveBooking, allowsCard} from './booking-contract.js';

const $ = selector => document.querySelector(selector);
const DRAFT = 'klarraumClientDraft';
const RESULT = 'klarraumClientResult';
const TOKEN = 'klarraumClientToken';
const screens = ['quote','contacts','pay','sent','confirmed','paid','failed','paused','blocked','plans','check-email','cancel','cancelled','expired'];
const paths = {
  '/':'quote','/contacts':'contacts','/pay':'pay','/sent':'sent','/confirmed':'confirmed','/paid':'paid',
  '/pay-failed':'failed','/paused':'paused','/pay-blocked':'blocked','/plans':'plans','/check-email':'check-email',
  '/cancel':'cancel','/cancelled':'cancelled','/link-expired':'expired',
};
// A public company page can be mounted below /companies/:id.  Keep that
// prefix on every customer-facing transition so a request never jumps to a
// different company's booking site.
const mountedCompanyBase = (location.pathname.match(/^(\/companies\/[a-f0-9-]{36})(?:\/|$)/i) || [])[1] || '';
const customerPath = path => `${mountedCompanyBase}${path}`;
const goCustomer = path => location.assign(customerPath(path));
const replaceCustomer = path => location.replace(customerPath(path));
const state = {
  live:false, demoMode:false, bookingMode:'request', connect:false, currency:'EUR', maxArea:null,
  pricing:{rates:{home:2.2,office:1.5,deep:3.2},minimum:60}, company:{}, slots:null, result:null, dateValue:'',
};
let slotGen = 0;
let requestKey = crypto.randomUUID();

function screenName() {
  const localPath = mountedCompanyBase && location.pathname.startsWith(mountedCompanyBase)
    ? location.pathname.slice(mountedCompanyBase.length)
    : location.pathname;
  const path = localPath.replace(/\/$/, '') || '/';
  return paths[path] || 'quote';
}
function money(value) {
  return new Intl.NumberFormat('en-US', {style:'currency', currency:state.currency || 'EUR'}).format(value);
}
function quote(area, service) {
  const rate = state.pricing?.rates?.[service];
  if (!Number.isInteger(area) || typeof rate !== 'number') return null;
  const raw = Math.round(area * rate * 100) / 100;
  return Math.round(Math.max(raw, Number(state.pricing.minimum) || 0) * 100) / 100;
}
function readStore(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeStore(key, value) { sessionStorage.setItem(key, JSON.stringify(value)); }
async function api(path, options = {}) {
  const response = await fetch(new URL(path, location.href), {
    ...options, credentials:'same-origin',
    headers:{'Content-Type':'application/json', ...options.headers},
  });
  const data = await response.json().catch(() => ({error:'The service is unavailable. Please try again later.'}));
  if (!response.ok) throw Object.assign(new Error(data.error || data.message || 'Something went wrong.'), {status:response.status, data});
  return data;
}
function showError(id, error) {
  const node = $(id);
  if (!node) return;
  node.hidden = !error;
  node.textContent = error ? error.message || String(error) : '';
}
function serviceTitle() {
  return $('#service')?.selectedOptions[0]?.textContent || 'Cleaning';
}
function selectedLabel(id) {
  const select = $(id);
  return select?.selectedOptions[0]?.textContent || '';
}
function kept(selector, previous = '') {
  const value = $(selector)?.value?.trim();
  return value || previous || '';
}
function draftFromForm(extra = {}) {
  const previous = readStore(DRAFT) || {};
  return {
    ...previous,
    service:kept('#service', previous.service),
    area:Number($('#area').value) || previous.area,
    date:kept('#date', previous.date),
    time:kept('#preferred-time', previous.time),
    name:kept('#customer-name', previous.name),
    email:kept('#customer-email', previous.email),
    phone:kept('#customer-phone', previous.phone),
    postcode:kept('#postcode', previous.postcode),
    address:kept('#address', previous.address),
    message:kept('#comments', previous.message),
    ...extra,
  };
}
function saveDraft(extra) { const draft = draftFromForm(extra); writeStore(DRAFT, draft); return draft; }
function areaProblem() {
  const area = Number($('#area').value);
  if (!Number.isInteger(area) || area < 20) return 'Enter at least 20 m².';
  if ((state.maxArea != null && area > state.maxArea) || area > 1000) return 'Contact the company for larger areas';
  return '';
}
function refreshPrice() {
  const problem = areaProblem();
  const error = $('#area-error');
  if (error) { error.hidden = !problem; error.textContent = problem; }
  const area = Number($('#area').value);
  const amount = quote(area, $('#service').value);
  const text = amount == null || problem ? '—' : money(amount);
  const price = $('#price');
  if (price) { price.textContent = text; price.value = text; }
  const total = $('#price-total');
  if (total) total.textContent = text;
  const slider = $('#area-range');
  if (slider && Number.isInteger(area)) slider.value = String(Math.min(200, Math.max(20, area)));
  const button = $('#continue-quote');
  if (button) button.disabled = Boolean(problem);
  return amount;
}
function fillSelect(select, items, placeholder, current) {
  if (!select) return;
  const keep = current ?? select.value;
  select.replaceChildren(new Option(placeholder, ''));
  for (const item of items) select.append(new Option(item.label, item.value));
  if ([...select.options].some(option => option.value === keep)) select.value = keep;
}
function refreshPicker(select) {
  const parent = select?.parentNode;
  if (!parent) return;
  const next = select.nextSibling;
  parent.removeChild(select);
  parent.insertBefore(select, next);
}
function renderTimeSlots(times, selected) {
  const host = $('#time-slots');
  if (!host) return;
  host.replaceChildren(...times.map(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label;
    button.setAttribute('aria-pressed', String(item.value === selected));
    button.addEventListener('click', () => {
      const select = $('#preferred-time');
      if (!select) return;
      select.disabled = false;
      select.value = item.value;
      renderTimeSlots(times, item.value);
    });
    return button;
  }));
}
function setTimeOptions(times, current = '') {
  const select = $('#preferred-time');
  const open = times.length > 0;
  fillSelect(select, times, open ? 'Select a time' : 'Choose a date first', open ? current : '');
  if (!select) return;
  select.disabled = !open;
  refreshPicker(select);
  renderTimeSlots(times, select.value);
}
function selectedDay() {
  return state.slots?.dates?.find(item => item.value === $('#date')?.value);
}
async function loadSlots() {
  const gen = ++slotGen;
  const area = Number($('#area').value);
  if (!Number.isInteger(area) || area < 20) return;
  try {
    const data = await api(`api/client/slots?area=${area}`);
    if (gen !== slotGen) return;
    state.slots = data;
    fillSelect($('#date'), data.dates, 'Select a date');
    setTimeOptions(selectedDay()?.times || [], $('#preferred-time')?.value || '');
    state.dateValue = $('#date')?.value || '';
  } catch (error) {
    if (gen === slotGen) showError('#quote-error', error);
  }
}
function syncService() {
  const value = $('#service').value;
  document.querySelectorAll('[data-service-card]').forEach(button => button.classList.toggle('active', button.dataset.service === value));
}
function summaryLines(draft, amount) {
  const day = state.slots?.dates?.find(item => item.value === draft.date);
  const time = day?.times?.find(item => item.value === draft.time);
  return [
    serviceTitle(),
    [day?.label || draft.date, time?.label || draft.time].filter(Boolean).join(' '),
    Number.isInteger(draft.area) ? `${draft.area} m²` : '',
    amount == null ? '' : money(amount),
    [draft.address, draft.postcode].filter(Boolean).join(', '),
  ].filter(Boolean);
}
function fillCard(node, lines) {
  if (!node) return;
  node.replaceChildren(...lines.filter(Boolean).map(line => {
    const row = document.createElement('div');
    row.textContent = line;
    return row;
  }));
}
function resultLines(data) {
  const pay = data.paymentStatus === 'Paid online' ? `${money(data.price)} paid` : data.paymentStatus === 'Unpaid' && data.jobStatus === 'Accepted' ? `${money(data.price)} — pay on site` : `${money(data.price)} estimate`;
  return [data.serviceTitle, data.dateLabel, data.timeLabel, `${data.area} m²`, pay, [data.address, data.postcode].filter(Boolean).join(', '), data.reference ? `Booking ${data.reference}` : ''];
}
function revealBrand() {
  document.documentElement.classList.remove('brand-pending');
}
function showScreens() {
  for (const name of screens) {
    const node = document.getElementById(`screen-${name}`);
    if (node) node.hidden = true;
  }
  const name = screenName();
  if (state.bookingMode === 'paused' && ['quote','contacts','pay'].includes(name)) {
    $('#screen-paused').hidden = false;
    const phone = $('#paused-phone'), email = $('#paused-email');
    phone.hidden = !state.company.phone; phone.textContent = state.company.phone ? `Phone: ${state.company.phone}` : '';
    email.hidden = !state.company.email; email.textContent = state.company.email ? `Email: ${state.company.email}` : '';
    return;
  }
  const node = document.getElementById(`screen-${name}`);
  if (node) node.hidden = false;
}
async function readyToken() {
  let saved = readStore(TOKEN);
  if (!saved?.token || Date.now() - saved.at > 50 * 60 * 1000) {
    saved = {token:(await api('api/form-token')).token, at:Date.now()};
    writeStore(TOKEN, saved);
  }
  const wait = 2100 - (Date.now() - saved.at);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  return saved.token;
}
function payloadFrom(draft, token, extra = {}) {
  return {
    service:draft.service, area:draft.area, date:draft.date, time:draft.time,
    name:draft.name, email:draft.email, phone:draft.phone, postcode:draft.postcode,
    address:draft.address, message:draft.message, privacy:true, website:$('#website')?.value || '', token, ...extra,
  };
}
async function createBooking(draft, choice) {
  const token = await readyToken();
  const data = await api('api/client/requests', {
    method:'POST', headers:{'Idempotency-Key':requestKey},
    body:JSON.stringify(payloadFrom(draft, token, {paymentChoice:choice})),
  });
  writeStore(RESULT, data);
  state.result = data;
  requestKey = crypto.randomUUID();
  return data;
}
function goResult(data) {
  sessionStorage.removeItem(DRAFT);
  if (data.paymentStatus === 'Paid online') goCustomer(`/paid?token=${encodeURIComponent(data.token || '')}`);
  else if (data.jobStatus === 'Accepted') goCustomer(`/confirmed?token=${encodeURIComponent(data.token || '')}`);
  else goCustomer(`/sent?token=${encodeURIComponent(data.token || '')}`);
}
function paintResult() {
  const data = state.result || readStore(RESULT);
  if (!data) return;
  const lines = resultLines(data);
  fillCard($('#sent-card'), lines);
  fillCard($('#confirmed-card'), lines);
  fillCard($('#paid-card'), lines);
  const success = $('#success-message');
  if (success && data.jobStatus === 'New request') success.textContent = `We got your request. The cleaning company will confirm the time. Estimate: ${money(data.price)}.`;
  for (const link of ['#cancel-link','#confirmed-cancel']) {
    const node = $(link);
    if (!node) continue;
    if (data.token) node.href = customerPath(`/cancel?token=${encodeURIComponent(data.token)}`);
    else node.hidden = true;
  }
  const amount = $('#failed-amount');
  if (amount) amount.textContent = `${serviceTitle()} · ${money(quote(Number($('#area').value), $('#service').value) ?? data.price)}`;
}
function paintDraft() {
  const draft = readStore(DRAFT);
  if (!draft) return;
  if ($('#service') && draft.service) $('#service').value = draft.service;
  if ($('#area') && draft.area) $('#area').value = draft.area;
  for (const [selector, key] of [['#customer-name','name'],['#customer-email','email'],['#customer-phone','phone'],['#postcode','postcode'],['#address','address'],['#comments','message']]) {
    if ($(selector) && draft[key]) $(selector).value = draft[key];
  }
  refreshPrice();
  const amount = quote(Number(draft.area), draft.service);
  const lines = summaryLines(draft, amount);
  const pill = lines.join(' · ');
  const summary = $('#draft-summary');
  if (summary) summary.textContent = pill;
  fillCard($('#contacts-side'), lines);
  fillCard($('#pay-summary'), lines);
  fillCard($('#pay-side'), lines);
  fillCard($('#blocked-summary'), lines);
  const pay = $('#pay-card');
  if (pay && amount != null) pay.textContent = `Pay ${money(amount)}`;
  $('#card-box').hidden = !state.connect;
  const phone = $('#blocked-phone');
  if (phone) phone.textContent = state.company.phone || '';
  const contact = $('#blocked-contact');
  if (contact && state.company.email) contact.href = `mailto:${state.company.email}`;
}
function downloadCalendar(data) {
  if (!data?.date || !data?.time) return;
  const stamp = value => `${data.date.replaceAll('-','')}T${value.replace(':','')}00`;
  const body = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nDTSTART;TZID=Europe/Berlin:${stamp(data.time)}\r\nDTEND;TZID=Europe/Berlin:${stamp(data.endTime || data.time)}\r\nSUMMARY:${data.serviceTitle || 'Cleaning'}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const filename = `${data.reference || 'cleaning'}.ics`;
  const file = new File([body], filename, {type:'text/calendar'});
  if (navigator.canShare && navigator.canShare({files:[file]})) {
    navigator.share({files:[file], title:filename}).catch(error => { if (error?.name !== 'AbortError') saveCalendarFile(body, filename); });
    return;
  }
  saveCalendarFile(body, filename);
}
function saveCalendarFile(body, filename) {
  const url = URL.createObjectURL(new Blob([body], {type:'application/octet-stream'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function onQuoteContinue() {
  showError('#quote-error', null);
  const problem = areaProblem();
  if (problem) return showError('#quote-error', new Error(problem));
  if (!$('#date').value || !$('#preferred-time').value) return showError('#quote-error', new Error('Choose an open date and time.'));
  saveDraft();
  goCustomer('/contacts');
}
async function onContactsSubmit(event) {
  event.preventDefault();
  showError('#contacts-error', null);
  const email = $('#customer-email'), phone = $('#customer-phone');
  email.setCustomValidity('');
  if (!email.value.trim() && !phone.value.trim()) {
    email.setCustomValidity('Please provide an email address or phone number.');
    email.reportValidity();
    email.setCustomValidity('');
    return;
  }
  const draft = saveDraft();
  if (!state.live && !state.demoMode) {
    $('#message').value = `DEMO — NOT SENT\n\nName: ${draft.name}\nEmail: ${draft.email || '—'}\nPhone: ${draft.phone || '—'}\nPostal code: ${draft.postcode}\nAddress: ${draft.address || 'To be agreed'}\nService: ${serviceTitle()}\nArea: ${draft.area} m²\nEstimate: ${$('#price').textContent}\nMessage: ${draft.message || '—'}`;
    $('#preview-status').hidden = false;
    $('#preview-status').textContent = 'Demo: your details were prepared as a preview. Nothing was sent or saved on the server. This preview does not appear in administration.';
    $('#demo-text').hidden = false;
    return;
  }
  if (state.demoMode) {
    try {
      const token = await readyToken();
      const data = await api('api/demo/inquiries', {
        method:'POST', headers:{'Idempotency-Key':requestKey},
        body:JSON.stringify({service:draft.service, area:draft.area, frequency:'once', windows:false, privacy:true, website:$('#website').value, token}),
      });
      $('#preview-status').hidden = false;
      $('#preview-status').textContent = `Fictional test saved. Reference: ${data.id.slice(0,8)}. It is visible in administration as “Demo customer”. No contact details were sent.`;
      $('#demo-text').hidden = true;
    } catch (error) { showError('#contacts-error', error); }
    return;
  }
  if (state.bookingMode === 'instant') {
    goCustomer('/pay');
    return;
  }
  $('#submit-inquiry').disabled = true;
  try {
    goResult(await createBooking(draft, 'request'));
  } catch (error) {
    $('#submit-inquiry').disabled = false;
    showError('#contacts-error', error);
  }
}
async function pay(choice, outcome) {
  showError('#pay-error', null);
  const draft = saveDraft();
  if (choice === 'card' && outcome === 'fail') {
    try {
      const token = await readyToken();
      await api('api/client/pay', {method:'POST', headers:{'Idempotency-Key':requestKey}, body:JSON.stringify(payloadFrom(draft, token, {outcome:'fail'}))});
    } catch (error) {
      if (error.status === 409) return goCustomer('/pay-blocked');
      if (error.status !== 402) return showError('#pay-error', error);
    }
    requestKey = crypto.randomUUID();
    return goCustomer('/pay-failed');
  }
  try {
    if (choice === 'card') {
      const token = await readyToken();
      const data = await api('api/client/pay', {method:'POST', headers:{'Idempotency-Key':requestKey}, body:JSON.stringify(payloadFrom(draft, token, {outcome:'success'}))});
      writeStore(RESULT, data);
      goResult(data);
      return;
    }
    goResult(await createBooking(draft, state.bookingMode === 'instant' ? 'onsite' : 'request'));
  } catch (error) {
    if (error.status === 409 && /unavailable/i.test(error.message)) goCustomer('/pay-blocked');
    else showError('#pay-error', error);
  }
}
async function loadBooking(token) {
  if (!token) return null;
  try { return await api(`api/client/booking?token=${encodeURIComponent(token)}`); }
  catch (error) {
    if (error.status === 410 || error.status === 400) { replaceCustomer('/link-expired'); return null; }
    throw error;
  }
}
function explainPricing(site) {
  const node = $('#pricing-explanation');
  if (!node || !site?.services) return;
  const parts = Object.entries(state.pricing.rates || {}).filter(([key]) => site.services[key]?.enabled !== false).map(([key, rate]) => `${site.services[key].title} ${money(rate)}/m²`);
  node.textContent = parts.join(', ');
}
function bind() {
  if (mountedCompanyBase) {
    document.querySelectorAll('a[href^="/"]').forEach(link => {
      const href = link.getAttribute('href');
      if (href && (paths[href.split('?')[0]] || href.startsWith('/cancel?'))) link.setAttribute('href', customerPath(href));
    });
  }
  $('#get-quote')?.addEventListener('click', () => $('#quote')?.scrollIntoView({behavior:'smooth'}));
  document.querySelectorAll('[data-service-card]').forEach(button => button.addEventListener('click', () => {
    if (button.hidden) return;
    $('#service').value = button.dataset.service;
    syncService();
    refreshPrice();
    loadSlots();
  }));
  $('#area')?.addEventListener('input', () => { requestKey = crypto.randomUUID(); refreshPrice(); loadSlots(); });
  $('#area-range')?.addEventListener('input', () => { $('#area').value = $('#area-range').value; refreshPrice(); loadSlots(); });
  const onDate = () => {
    const value = $('#date')?.value || '';
    if (value === state.dateValue) return;
    state.dateValue = value;
    setTimeOptions(selectedDay()?.times || [], '');
  };
  $('#date')?.addEventListener('change', onDate);
  $('#date')?.addEventListener('input', onDate);
  $('#preferred-time')?.addEventListener('change', () => renderTimeSlots(selectedDay()?.times || [], $('#preferred-time').value));
  document.querySelectorAll('.field-row').forEach(row => {
    row.addEventListener('click', event => {
      const select = row.querySelector('select');
      if (!select || select.disabled || event.target === select) return;
      select.focus();
      try { select.showPicker(); } catch { /* The select opens from its own tap. */ }
    });
  });
  $('#quote')?.addEventListener('submit', event => { event.preventDefault(); onQuoteContinue(); });
  $('#continue-quote')?.addEventListener('click', onQuoteContinue);
  $('#contacts')?.addEventListener('submit', onContactsSubmit);
  $('#pay-form')?.addEventListener('submit', event => {
    event.preventDefault();
    if (!state.connect) return pay('onsite');
    if (!$('#card-number').value.trim() || !$('#card-expiry').value.trim() || !$('#card-cvc').value.trim() || !$('#card-name').value.trim()) {
      return showError('#pay-error', new Error('Enter the card details, or choose pay on site.'));
    }
    pay('card', $('#card-decline').checked ? 'fail' : 'success');
  });
  $('#pay-onsite')?.addEventListener('click', () => pay('onsite'));
  $('#blocked-onsite')?.addEventListener('click', () => pay('onsite'));
  $('#fail-onsite')?.addEventListener('click', () => pay('onsite'));
  $('#try-again')?.addEventListener('click', () => goCustomer('/pay'));
  $('#add-calendar')?.addEventListener('click', () => downloadCalendar(readStore(RESULT)));
  $('#add-calendar-paid')?.addEventListener('click', () => downloadCalendar(readStore(RESULT)));
  $('#confirm-cancel')?.addEventListener('click', async () => {
    const token = new URLSearchParams(location.search).get('token');
    showError('#cancel-error', null);
    try {
      await api('api/client/cancel', {method:'POST', body:JSON.stringify({token})});
      goCustomer(`/cancelled?token=${encodeURIComponent(token)}`);
    } catch (error) { showError('#cancel-error', error); }
  });
  $('#magic-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const data = await api('api/client/magic-link', {method:'POST', body:JSON.stringify({email:$('#magic-email').value})});
      $('#magic-status').textContent = data.message;
    } catch (error) { $('#magic-status').textContent = error.message; }
  });
}
async function init() {
  bind();
  try {
    const pub = await api('api/config');
    state.currency = pub.currency || state.currency;
    if (pub.site) applySite(pub.site);
    let partner = null;
    if (!pub.partnerBooking) {
      try { partner = await api('api/partner/booking-mode'); } catch { partner = null; }
    }
    const resolved = resolveBooking({config: pub, partner, company: pub.site?.company, pricing: pub.pricing});
    const booking = resolved.booking;
    state.live = Boolean(pub.live);
    state.demoMode = Boolean(pub.demoMode);
    state.bookingMode = booking.bookingMode;
    state.connect = allowsCard(booking);
    state.currency = booking.currency || pub.currency || state.currency;
    state.maxArea = booking.prices.maxAreaM2;
    state.pricing = {rates:{home:booking.prices.home, office:booking.prices.office, deep:booking.prices.deep}, minimum:booking.prices.minimum || 0, discounts: pub.pricing?.discounts || {once:1}};
    state.company = booking.company.name ? booking.company : (pub.site?.company || {});
    if (state.company.name) document.querySelectorAll('[data-company]').forEach(node => { node.textContent = state.company.name; });
    const unit = booking.areaUnit === 'sqft' ? 'sq ft' : 'm²';
    const unitNode = $('#area-unit');
    if (unitNode) unitNode.textContent = unit;
    if (state.bookingMode !== 'paused' && $('#quote')) $('#quote').hidden = false;
    const footer = $('#footer-mode');
    if (footer) footer.textContent = state.bookingMode === 'instant' ? 'Instant booking · Pay online or on site' : state.bookingMode === 'paused' ? 'Online booking is paused' : 'No payment now · The company confirms your request';
    explainPricing(pub.site);
    syncService();
    refreshPrice();
    revealBrand();
    if (state.demoMode) {
      $('#customer-name').value = 'Demo customer';
      $('#customer-email').value = 'demo@example.invalid';
      $('#postcode').value = '10001';
      $('#address').value = '123 Example Street (fictional)';
      $('#submit-inquiry').textContent = 'Send fictional test to owner';
    }
    await loadSlots();
    const draft = readStore(DRAFT);
    if (draft?.date) {
      fillSelect($('#date'), state.slots?.dates || [], 'Select a date', draft.date);
      setTimeOptions(selectedDay()?.times || [], draft.time || '');
      state.dateValue = $('#date')?.value || '';
    }
  } catch {
    state.live = false;
    refreshPrice();
    revealBrand();
    $('#footer-mode').textContent = 'Preview only. Nothing is sent.';
  }
  if (screenName() === 'pay' && new URLSearchParams(location.search).get('card') === '1' && !state.connect) {
    replaceCustomer('/pay-blocked');
    return;
  }
  showScreens();
  paintDraft();
  paintResult();
  const token = new URLSearchParams(location.search).get('token');
  if (token && ['cancel','cancelled','sent','confirmed','paid'].includes(screenName())) {
    const booking = await loadBooking(token);
    if (booking) {
      writeStore(RESULT, {...readStore(RESULT), ...booking, token});
      state.result = {...booking, token};
      paintResult();
      fillCard($('#cancel-card'), resultLines(booking));
      fillCard($('#cancelled-card'), resultLines(booking));
      const notice = $('#refund-notice');
      if (notice) notice.hidden = booking.refundNotice !== 'Refund is decided by the company';
      if (!booking.cancellable) $('#confirm-cancel').disabled = true;
      if (booking.jobStatus === 'Cancelled') {
        $('#cancelled-copy').textContent = booking.refundNotice || 'The time is free again.';
      }
    }
  }
}
init();
