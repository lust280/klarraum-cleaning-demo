let csrf = '';
let draftEnabled = null;
let selectedCompany = null;
let logFilter = 'all';
const $ = selector => document.querySelector(selector);
const viewRoot = () => $('#view');

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function error(message = '') {
  const node = $('#error');
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}
async function api(path, options = {}) {
  const response = await fetch('/api/director/' + path, {
    ...options,
    headers: {'Content-Type':'application/json', 'X-CSRF-Token':csrf, ...options.headers},
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}
function viewName() {
  const hash = location.hash.slice(1);
  if (hash === 'log' || hash === 'review' || hash === 'support' || hash === 'settings') return hash;
  return 'attention';
}
function markNav() {
  const current = viewName();
  const key = current === 'log' || current === 'review' ? 'attention' : current;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === key) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}
function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
}
function titleRow(text, badge) {
  const row = el('div', null, 'title-row');
  row.append(el('h1', text));
  if (badge) row.append(el('span', badge, 'badge'));
  return row;
}
function primary(label, onClick) {
  const button = el('button', label, 'primary');
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

async function render() {
  if (viewName() !== 'settings') draftEnabled = null;
  markNav();
  error();
  const root = viewRoot();
  root.replaceChildren(el('p', 'Loading…', 'muted'));
  try {
    const name = viewName();
    if (name === 'settings') await renderSettings();
    else if (name === 'support') await renderSupport();
    else if (name === 'log') await renderLog();
    else if (name === 'review') await renderReview();
    else await renderAttention();
  } catch (err) {
    root.replaceChildren();
    error(err.message);
  }
}

async function renderAttention() {
  const data = await api('ai/attention');
  const root = viewRoot();
  root.replaceChildren(titleRow('Attention', data.badge));
  const cards = el('div', null, 'cards');
  cards.append(handledCard(data.handled), escalatedCard(data.escalated), reviewCard(data.review));
  root.append(cards, shellBlock(data.shell), el('p', data.note, 'foot-note'));
}
function handledCard(handled) {
  const card = el('article', null, 'card');
  const head = el('div', null, 'card-head');
  head.append(el('h2', 'Handled by AI'), el('span', String(handled.count), 'count'));
  card.append(head);
  if (!handled.items.length) card.append(el('p', 'No AI replies yet today.', 'muted'));
  for (const item of handled.items) {
    const row = el('div', null, 'row');
    const text = el('div');
    text.append(el('strong', `${item.company} — ${item.topic} `), el('span', '✓', 'ok'));
    text.append(el('div', `${item.statusLabel} · ${item.timeLabel}`, 'muted'));
    row.append(text);
    card.append(row);
  }
  const open = el('button', 'Open log', 'linkish quiet');
  open.type = 'button';
  open.addEventListener('click', () => { location.hash = 'log'; });
  card.append(open);
  return card;
}
function escalatedCard(escalated) {
  const card = el('article', null, 'card');
  const head = el('div', null, 'card-head');
  head.append(el('h2', 'Escalated to you'), el('span', String(escalated.count), 'count'));
  card.append(head);
  if (!escalated.items.length) card.append(el('p', 'Nothing is waiting.', 'muted'));
  for (const item of escalated.items) {
    const row = el('div', null, 'row');
    const text = el('div');
    text.append(el('div', null));
    const line = el('strong');
    line.append(el('span', '', 'dot warn'), document.createTextNode(`${item.company} — ${item.topic}`));
    text.append(line, el('div', item.dueLabel, 'muted'));
    const open = primary('Open', () => { selectedCompany = item.companyId; location.hash = 'support'; });
    row.append(text, open);
    card.append(row);
  }
  return card;
}
function reviewCard(review) {
  const card = el('article', null, 'card');
  const head = el('div', null, 'card-head');
  head.append(el('h2', 'Weekly review'), el('span', String(review.count), 'count'));
  card.append(head);
  const box = el('div', null, 'note');
  box.append(el('div', `${review.count} AI ${review.count === 1 ? 'reply' : 'replies'} this week`), el('div', `${review.complaints} ${review.complaints === 1 ? 'complaint' : 'complaints'}`));
  card.append(box, primary('Start review', () => { location.hash = 'review'; }));
  return card;
}
function shellBlock(shell) {
  const wrap = el('section', null, 'shell');
  wrap.append(shellList('Trials ending', (shell.trials || []).map(item => `${item.name} · ends ${item.label}`), 'No trials ending in the next 7 days.'));
  wrap.append(shellList('Storage', (shell.storage || []).map(item => `${item.name} · ${item.level}`), 'No storage alerts.'));
  return wrap;
}
function shellList(title, lines, empty) {
  const card = el('article');
  card.append(el('h2', title));
  if (!lines.length) card.append(el('p', empty, 'muted'));
  for (const line of lines) card.append(el('p', line));
  return card;
}

async function renderSettings() {
  const data = await api('ai/settings');
  if (draftEnabled === null) draftEnabled = data.enabled;
  const on = draftEnabled;
  const root = viewRoot();
  root.replaceChildren(el('h1', 'AI settings'));
  const card = el('article', null, 'card settings-card');
  const head = el('div', null, 'settings-head');
  head.append(el('h2', 'AI replies to partners'));
  const controls = switchRow(on);
  head.append(controls);
  card.append(head);
  const legend = el('div', null, 'legend desktop-only');
  legend.append(legendLine(true, 'ON — Replies send automatically. You review weekly.'));
  legend.append(legendLine(false, 'OFF — You reply manually.'));
  const mobileOn = el('p', 'Replies send automatically. You review weekly.', 'mobile-only');
  const mobileOff = el('p', 'When OFF: You reply manually.', 'mobile-only');
  if (!on) mobileOn.hidden = true;
  card.append(legend, mobileOn, el('hr', null, 'mobile-only'), mobileOff);
  const note = el('div', null, 'note');
  note.append(el('p', 'Unknown or risky questions are escalated to you within 24h.', 'desktop-only'));
  note.append(el('p', 'Unknown questions are escalated to you within 24h.', 'mobile-only'));
  note.append(el('p', 'AI never promises refunds, discounts or money.', 'desktop-only'));
  note.append(el('p', 'AI never promises refunds or money.', 'mobile-only'));
  const foot = el('div', null, 'settings-foot');
  const last = data.lastReviewLabel ? `Last review ${data.lastReviewLabel}` : 'No review yet';
  foot.append(el('p', `Weekly review: every Monday · ${last}`, 'muted desktop-only'));
  foot.append(el('p', 'Weekly review · Mondays', 'muted mobile-only'));
  const save = el('button', 'Save', 'save');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const saved = await api('ai/settings', {method:'PUT', body:{enabled:draftEnabled}});
      draftEnabled = saved.enabled;
      error();
      await renderSettings();
      const note = el('p', 'Saved.', 'muted');
      viewRoot().append(note);
    } catch (err) { error(err.message); }
    finally { save.disabled = false; }
  });
  foot.append(save);
  card.append(note, foot);
  root.append(card);
}
function switchRow(on) {
  const row = el('div', null, 'switch-row');
  const button = el('button', null, 'switch');
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', on ? 'true' : 'false');
  button.setAttribute('aria-label', 'AI replies');
  button.append(el('span', null, 'knob'));
  button.addEventListener('click', () => { draftEnabled = !draftEnabled; renderSettings(); });
  row.append(button, el('span', 'AI replies', 'switch-label'), el('span', on ? 'ON' : 'OFF', on ? 'pill' : 'pill off'));
  return row;
}
function legendLine(on, text) {
  const line = el('div');
  line.append(el('span', '', on ? 'dot on' : 'dot'), document.createTextNode(text));
  return line;
}

async function renderSupport() {
  const list = await api('ai/threads');
  if (!selectedCompany && list.items[0]) selectedCompany = list.items[0].companyId;
  const root = viewRoot();
  root.replaceChildren(el('h1', 'KlarraumApp Director'));
  const layout = el('div', null, 'support-layout');
  const listCard = el('article', null, 'card thread-list');
  listCard.append(el('h2', 'Support'));
  if (!list.items.length) listCard.append(el('p', 'No partner messages yet.', 'muted'));
  for (const item of list.items) {
    const button = document.createElement('button');
    button.type = 'button';
    if (item.companyId === selectedCompany) button.setAttribute('aria-current', 'true');
    const top = el('div', null, 'thread-top');
    const name = el('span', `${item.company} — ${item.topic}`);
    if (item.unread) name.append(el('span', '', 'dot on'));
    top.append(name, el('span', item.timeLabel, 'muted'));
    button.append(top);
    button.addEventListener('click', () => { selectedCompany = item.companyId; renderSupport(); });
    listCard.append(button);
  }
  const threadCard = el('article', null, 'card');
  layout.append(listCard, threadCard);
  root.append(layout);
  if (!selectedCompany) {
    threadCard.append(el('p', 'Choose a company.', 'muted'));
    return;
  }
  const thread = await api('ai/threads/' + selectedCompany);
  const head = el('div', null, 'thread-head');
  head.append(el('h2', `${thread.company} · ${thread.topic}`));
  if (thread.enabled) head.append(el('span', 'AI · Auto', 'badge'));
  threadCard.append(head);
  if (thread.escalation) {
    const banner = el('div', null, 'banner');
    banner.append(el('strong', `Escalated · ${thread.escalation.dueLabel}`));
    banner.append(el('p', 'Suggested holding reply. It is not sent until you press Send.', 'muted'));
    banner.append(el('p', thread.escalation.template));
    const use = el('button', 'Use this reply', 'ghost');
    use.type = 'button';
    use.addEventListener('click', () => {
      const field = threadCard.querySelector('textarea');
      if (field) field.value = thread.escalation.template;
    });
    banner.append(use);
    threadCard.append(banner);
  }
  if (!thread.messages.length) threadCard.append(el('p', 'No messages yet.', 'muted'));
  for (const message of thread.messages) threadCard.append(messageBlock(message));
  const form = el('form', null, 'composer');
  const field = document.createElement('textarea');
  field.maxLength = 4000;
  field.required = true;
  field.placeholder = 'Write a reply...';
  field.setAttribute('aria-label', 'Write a reply');
  const send = el('button', 'Send', 'primary send');
  send.type = 'submit';
  form.append(field, send);
  form.addEventListener('submit', event => {
    event.preventDefault();
    send.disabled = true;
    api('companies/' + selectedCompany + '/support', {method:'POST', body:{message:field.value}}).then(() => renderSupport()).catch(err => error(err.message)).finally(() => { send.disabled = false; });
  });
  threadCard.append(form);
}
function messageBlock(message) {
  if (message.kind === 'ai') {
    const block = el('article', null, 'ai-bubble');
    block.append(el('p', `✦ AI reply · Sent ${message.timeLabel}`, 'meta'));
    block.append(el('p', message.body));
    const bits = [`Sent automatically by AI · ${message.timeLabel}`];
    if (message.reviewLabel) bits.push(message.reviewLabel);
    block.append(el('p', bits.join(' · '), 'muted'));
    return block;
  }
  const block = el('div', null, 'bubble');
  const who = message.sender === 'company' ? 'Partner' : 'Operator';
  block.append(el('p', message.body), el('p', `${who} · ${message.timeLabel}`, 'muted'));
  return block;
}

async function renderLog() {
  const data = await api('ai/log?filter=' + encodeURIComponent(logFilter));
  const attention = await api('ai/attention');
  const root = viewRoot();
  root.replaceChildren(titleRow('AI log', attention.badge));
  const filters = el('div', null, 'filters');
  for (const [key, label] of [['all','All'],['sent','Sent by AI'],['escalated','Escalated'],['week','This week']]) {
    const button = el('button', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', logFilter === key ? 'true' : 'false');
    button.addEventListener('click', () => { logFilter = key; renderLog(); });
    filters.append(button);
  }
  const card = el('article', null, 'card');
  const head = el('div', null, 'log-head');
  for (const label of ['Time','Company','Topic','AI reply','Status','']) head.append(el('span', label));
  card.append(head);
  if (!data.items.length) card.append(el('p', 'No log entries for this filter.', 'muted'));
  for (const item of data.items) {
    const row = el('div', null, 'log-row');
    row.append(el('span', item.timeLabel), el('span', item.company), el('span', item.topic, 'topic'), el('span', item.aiReply, 'reply'));
    const status = el('span', item.statusLabel, 'status');
    if (item.status === 'escalated') status.prepend(el('span', '', 'dot warn'));
    else status.prepend(el('span', '✓ ', 'ok'));
    const open = primary('Open', () => { selectedCompany = item.companyId; location.hash = 'support'; });
    row.append(status, open);
    card.append(row);
  }
  root.append(filters, card, el('p', data.note, 'foot-note'));
}

async function renderReview() {
  const data = await api('ai/review');
  const root = viewRoot();
  root.replaceChildren(el('h1', 'Weekly review'));
  root.append(el('p', `${data.weekLabel} · ${data.total} AI ${data.total === 1 ? 'reply' : 'replies'} · ${data.complaints} ${data.complaints === 1 ? 'complaint' : 'complaints'}`));
  root.append(el('p', `${data.reviewed} of ${data.total} reviewed`, 'muted'));
  const card = el('article', null, 'card');
  if (!data.items.length) card.append(el('p', 'No AI replies this week.', 'muted'));
  for (const item of data.items) card.append(reviewRow(item));
  root.append(card);
  const finish = el('button', 'Finish review', 'save');
  finish.type = 'button';
  finish.style.float = 'right';
  finish.addEventListener('click', async () => {
    finish.disabled = true;
    try { await api('ai/review/finish', {method:'POST', body:{}}); location.hash = 'settings'; }
    catch (err) { error(err.message); finish.disabled = false; }
  });
  root.append(finish);
}
function reviewRow(item) {
  const row = el('div', null, 'review-item');
  const text = el('div');
  const title = el('strong', `${item.company} — ${item.topic} `);
  if (item.reviewState === 'ok') title.append(el('span', '✓', 'ok'));
  if (item.reviewState === 'flagged') title.append(el('span', 'Flagged', 'muted'));
  text.append(title, el('div', item.summary, 'muted'));
  const actions = el('div', null, 'review-actions');
  const ok = el('button', 'OK', 'ghost');
  ok.type = 'button';
  if (item.reviewState === 'ok') ok.setAttribute('aria-pressed', 'true');
  ok.addEventListener('click', () => mark(item.id, 'ok'));
  actions.append(ok);
  if (item.reviewState !== 'ok') {
    const flag = el('button', 'Flag', 'ghost');
    flag.type = 'button';
    if (item.reviewState === 'flagged') flag.setAttribute('aria-pressed', 'true');
    flag.addEventListener('click', () => mark(item.id, 'flag'));
    actions.append(flag);
  }
  row.append(text, actions);
  return row;
}
async function mark(id, action) {
  try { await api('ai/review/' + id, {method:'POST', body:{action}}); await renderReview(); }
  catch (err) { error(err.message); }
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('#login-error').hidden = true;
  try {
    const data = await api('login', {method:'POST', body:{password:event.target.elements.password.value}});
    csrf = data.csrf;
    event.target.reset();
    showApp();
    if (!location.hash) location.hash = 'attention';
    await render();
  } catch (err) {
    $('#login-error').textContent = err.message;
    $('#login-error').hidden = false;
  } finally { button.disabled = false; }
});
$('#signout').addEventListener('click', async () => {
  try { await api('logout', {method:'POST', body:{}}); } catch { /* session already ended */ }
  csrf = '';
  showLogin();
});
window.addEventListener('hashchange', () => { if (!$('#app').hidden) render(); });

fetch('/api/director/session').then(async response => {
  if (!response.ok) return showLogin();
  csrf = (await response.json()).csrf;
  showApp();
  if (!location.hash) location.replace('#attention');
  await render();
}).catch(() => showLogin());
