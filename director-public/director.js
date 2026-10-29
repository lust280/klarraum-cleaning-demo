import {
  attention, cleared, companyById, createConsole, filterCompanies, formatDate,
  formatGb, groupByPlan, isSupportFlag, markRead, paymentsView, planPrice, replyToThread,
  saasPlans, seatsUsed, statusLabel, storageRatio, supportBadge, threadByCompany, trialDaysLeft,
} from '/director-console.mjs';

const $ = selector => document.querySelector(selector);
const screen = () => $('#screen');
let csrf = '';
let model = createConsole();
let search = '';
let statusFilter = 'all';
let supportFilter = 'all';
const mobileQuery = matchMedia('(max-width: 860px)');

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

function svgCheck() {
  const ns = 'http://www.w3.org/2000/svg';
  const node = document.createElementNS(ns, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M5 12.5 10 17.5 19 7.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  node.append(path);
  return node;
}

function parseRoute() {
  const parts = (location.hash.replace(/^#/, '') || '/attention').split('/').filter(Boolean);
  if (parts[0] === 'attention') return {name:'attention', clear:parts[1] === 'clear'};
  if (parts[0] === 'companies' && parts[1]) return {name:'company', id:parts[1], tab:parts[2] || 'overview'};
  if (parts[0] === 'companies') return {name:'companies'};
  if (parts[0] === 'support') return {name:'support', id:parts[1] || null};
  return {name:'attention', clear:false};
}

function viewedModel(route) {
  return route.name === 'attention' && route.clear ? cleared(model) : model;
}

function syncChrome(route) {
  const view = viewedModel(route);
  const board = attention(view);
  for (const badge of document.querySelectorAll('[data-badge="attention"]')) {
    badge.hidden = board.total === 0;
    badge.textContent = String(board.total);
  }
  const threads = supportBadge(view);
  for (const badge of document.querySelectorAll('[data-badge="support"]')) {
    badge.hidden = threads === 0;
    badge.textContent = String(threads);
  }
  const current = route.name === 'company' ? 'companies' : route.name;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const titles = {attention:'Attention', companies:'Companies', company:'Company', support:'Support'};
  document.title = `KlarraumApp · ${titles[route.name] || 'Director'}`;
}

function restoreFocus(id, caret) {
  if (!id) return;
  const next = document.getElementById(id);
  if (!next) return;
  next.focus();
  if (caret != null && next.setSelectionRange) next.setSelectionRange(caret, caret);
}

function render() {
  const active = document.activeElement;
  const focusId = active?.id || '';
  const caret = active && 'selectionStart' in active ? active.selectionStart : null;
  const route = parseRoute();
  syncChrome(route);
  const root = screen();
  root.replaceChildren();
  if (route.name === 'attention') paintAttention(root, attention(viewedModel(route)));
  else if (route.name === 'companies') paintCompanies(root);
  else if (route.name === 'company') paintCompany(root, route);
  else if (route.name === 'support') paintSupport(root, route);
  else paintAttention(root, attention(model));
  restoreFocus(focusId, caret);
}

function paintAttention(root, board) {
  const page = el('section', {class:'page', 'data-screen':'attention'});
  page.append(el('h1', {}, ['Attention']));
  const grid = el('div', {class:'attention-grid'});
  grid.append(attentionCard('Trials ending', board.trials.length, board.trials.length ? board.trials.map(trialRow) : [el('p', {class:'empty-line'}, ['None this week'])]));
  grid.append(attentionCard('Support flags', board.support.length, board.support.length ? board.support.map(flagRow) : [el('p', {class:'empty-line'}, ['No open flags'])]));
  grid.append(attentionCard('Storage alerts', board.storage.length, board.storage.length ? board.storage.map(storageRow) : [el('p', {class:'empty-line'}, ['All under 80%'])]));
  page.append(grid);
  if (board.clear) {
    const clear = el('div', {class:'all-clear'});
    clear.append(el('div', {class:'check'}, [svgCheck()]));
    clear.append(el('h2', {}, ['All clear']));
    clear.append(el('p', {}, ['Nothing needs your attention right now.']));
    clear.append(el('p', {class:'muted'}, [`Last checked ${board.checkedAt}`]));
    clear.append(el('a', {class:'outline button-link', href:'#/companies'}, ['View companies']));
    page.append(clear);
  }
  root.append(page);
}

function attentionCard(title, count, rows) {
  const card = el('article', {class:'panel'});
  const head = el('div', {class:'panel-head'});
  head.append(el('h2', {}, [title]));
  head.append(el('span', {class:count ? 'count' : 'count zero'}, [String(count)]));
  card.append(head);
  for (const row of rows) card.append(row);
  return card;
}

function trialRow(trial) {
  const row = el('a', {class:'flag-row', href:`#/companies/${trial.companyId}`});
  row.append(el('span', {}, [`${trial.name} — ${trial.days} ${trial.days === 1 ? 'day' : 'days'} left`]));
  row.append(el('span', {class:'open'}, ['Open']));
  return row;
}

function flagRow(flag) {
  const row = el('a', {class:'flag-row', href:`#/support/${flag.companyId}`});
  const label = el('span', {class:'flag-label'});
  label.append(el('i', {class:'dot', 'aria-hidden':'true'}));
  label.append(`${flag.name} — ${flag.topic}`);
  row.append(label);
  return row;
}

function storageRow(item) {
  const row = el('a', {class:'storage-row', href:`#/companies/${item.companyId}`});
  const percent = Math.round(item.ratio * 100);
  row.append(el('span', {}, [`${item.name} — ${percent}% of ${formatGb(item.limit)} GB`]));
  row.append(bar(item.ratio));
  return row;
}

function bar(ratio) {
  const track = el('span', {class:ratio >= 0.8 ? 'bar warn' : 'bar'});
  const fill = el('span');
  fill.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
  track.append(fill);
  return track;
}

function paintCompanies(root) {
  const page = el('section', {class:'page', 'data-screen':'companies'});
  const head = el('div', {class:'page-head'});
  head.append(el('h1', {}, ['Companies']));
  const tools = el('div', {class:'company-tools'});
  tools.append(el('input', {id:'company-search', type:'search', placeholder:'Search companies', 'aria-label':'Search companies', value:search}));
  const status = el('select', {id:'company-status', class:'status-filter', 'aria-label':'Status'});
  for (const [value, label] of [['all','All statuses'], ['active','Active'], ['trial','Trial'], ['past_due','Past due'], ['readonly','Read-only']]) {
    const option = el('option', {value}, [label]);
    if (value === statusFilter) option.setAttribute('selected', '');
    status.append(option);
  }
  tools.append(status);
  head.append(tools);
  page.append(head);
  page.append(el('div', {id:'company-results'}));
  root.append(page);
  fillCompanyResults();
}

function fillCompanyResults() {
  const slot = document.getElementById('company-results');
  if (!slot) return;
  const visible = filterCompanies(model.companies, {query:search, status:statusFilter});
  slot.replaceChildren(companyTable(visible), companyCards(visible));
  if (!visible.length) slot.append(el('p', {class:'muted'}, ['No companies match.']));
}

function companyTable(list) {
  const wrap = el('div', {class:'table-card desk-only'});
  const table = el('table');
  const thead = el('thead');
  const header = el('tr');
  for (const label of ['Company', 'Plan', 'Users', 'Status']) header.append(el('th', {}, [label]));
  thead.append(header);
  table.append(thead);
  const body = el('tbody');
  for (const company of list) {
    const row = el('tr');
    const name = el('td');
    name.append(el('a', {href:`#/companies/${company.id}`}, [company.listName || company.name]));
    row.append(name);
    row.append(el('td', {}, [saasPlans[company.plan].name]));
    row.append(el('td', {}, [String(seatsUsed(company))]));
    row.append(el('td', {}, [pill(company.status)]));
    body.append(row);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

function companyCards(list) {
  const wrap = el('div', {class:'plan-groups mob-only'});
  for (const group of groupByPlan(list)) {
    const card = el('section', {class:'group-card'});
    card.append(el('h2', {}, [`${group.plan.name} · ${group.companies.length}`]));
    for (const company of group.companies) {
      const link = el('a', {class:'company-row', href:`#/companies/${company.id}`});
      const text = el('span', {class:'company-row-text'});
      text.append(el('strong', {}, [company.listName || company.name]));
      text.append(el('span', {}, [company.city]));
      text.append(el('span', {}, [`${seatsUsed(company)} users`]));
      link.append(text);
      link.append(pill(company.status));
      link.append(el('span', {class:'chevron', 'aria-hidden':'true'}, ['›']));
      card.append(link);
    }
    wrap.append(card);
  }
  return wrap;
}

function pill(status, days = null) {
  const label = status === 'trial' && days != null ? `Trial · ${days} ${days === 1 ? 'day' : 'days'} left` : statusLabel(status);
  return el('span', {class:`pill pill-${status}`}, [label]);
}

function paintCompany(root, route) {
  const company = companyById(model, route.id);
  const page = el('section', {class:'page', 'data-screen':'company'});
  if (!company) {
    page.append(el('h1', {}, ['Company not found']));
    page.append(el('a', {href:'#/companies'}, ['Back to companies']));
    root.append(page);
    return;
  }
  const tab = ['overview', 'payments', 'team'].includes(route.tab) ? route.tab : 'overview';
  page.append(el('a', {class:'back', href:'#/companies'}, ['‹ Companies']));
  const title = el('div', {class:'detail-title'});
  const heading = el('div', {class:'title-line'});
  heading.append(el('h1', {}, [company.name]));
  const days = trialDaysLeft(company, model.now);
  heading.append(pill(company.status, days));
  title.append(heading);
  page.append(title);
  page.append(tabs(company.id, tab));
  if (tab === 'payments') page.append(paintPayments(company));
  else if (tab === 'team') page.append(paintTeam(company));
  else page.append(paintOverview(company));
  page.append(el('a', {class:'open-support button-link', href:`#/support/${company.id}`}, ['Open support']));
  root.append(page);
}

function tabs(id, current) {
  const nav = el('div', {class:'tabs', role:'tablist', 'aria-label':'Company'});
  for (const [key, label] of [['overview','Overview'], ['payments','Payments'], ['team','Team']]) {
    const link = el('a', {href:`#/companies/${id}/${key}`, role:'tab'}, [label]);
    if (key === current) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return nav;
}

function paintOverview(company) {
  const plan = saasPlans[company.plan];
  const ratio = storageRatio(company);
  const wrap = el('div', {'data-panel':'overview'});
  const stats = el('div', {class:'stat-grid desk-only'});
  stats.append(stat('Plan', plan.name));
  stats.append(stat('Seats used', `${seatsUsed(company)} / ${plan.seats}`));
  const statusValue = company.status === 'trial'
    ? `Trial ends ${formatDate(company.trialEnds)}`
    : company.status === 'readonly'
      ? 'Trial ended · booking paused'
      : company.subscription?.nextInvoice
        ? `Next invoice ${formatDate(company.subscription.nextInvoice)}`
        : statusLabel(company.status);
  stats.append(stat('Status', statusValue));
  const storage = stat('Storage', `${formatGb(company.storageUsedGb)} GB / ${formatGb(company.storageLimitGb)} GB`);
  storage.append(bar(ratio));
  stats.append(storage);
  wrap.append(stats);
  const mobile = el('div', {class:'kv-card mob-only'});
  mobile.append(kv('Plan', `${plan.name} · ${planPrice(plan).replace('/mo', ' / month')}`));
  mobile.append(kv('Seats', `${seatsUsed(company)} of ${plan.seats} used`));
  mobile.append(kv('Status', company.status === 'trial' ? `Trial ends ${formatDate(company.trialEnds)}` : company.status === 'readonly' ? 'Trial ended · booking paused' : statusLabel(company.status)));
  mobile.append(kv('Owner', company.owner));
  wrap.append(mobile);
  const storageCard = el('section', {class:'kv-card storage-card mob-only'});
  storageCard.append(el('h2', {}, ['Storage']));
  storageCard.append(el('p', {}, [`${formatGb(company.storageUsedGb)} GB of ${formatGb(company.storageLimitGb)} GB (${Math.round(ratio * 100)}%)`]));
  const row = el('div', {class:'storage-inline'});
  row.append(bar(ratio));
  row.append(el('span', {}, [`${Math.round(ratio * 100)}%`]));
  storageCard.append(row);
  wrap.append(storageCard);
  const details = el('section', {class:'kv-card details-card desk-only'});
  details.append(el('h2', {}, ['Details']));
  details.append(kv('Owner', company.owner));
  details.append(kv('Created', formatDate(company.created)));
  details.append(kv('Jobs this month', String(company.jobsThisMonth)));
  details.append(kv('City', company.city));
  wrap.append(details);
  return wrap;
}

function stat(label, value) {
  const card = el('article', {class:'stat'});
  card.append(el('h2', {}, [label]));
  card.append(el('p', {}, [value]));
  return card;
}

function kv(label, value) {
  const row = el('div', {class:'kv'});
  row.append(el('span', {}, [label]));
  row.append(el('strong', {}, [value]));
  return row;
}

function paintPayments(company) {
  const view = paymentsView(company);
  const grid = el('div', {class:'pay-grid', 'data-panel':'payments'});
  grid.append(payCard(view.saas, company.status));
  grid.append(payCard(view.connect, company.connect?.status));
  return grid;
}

function payCard(block, tone) {
  const card = el('article', {class:'kv-card'});
  card.append(el('h2', {}, [block.heading]));
  card.append(el('p', {class:'muted'}, [block.note]));
  for (const [label, value] of block.rows) {
    const row = el('div', {class:'kv'});
    row.append(el('span', {}, [label]));
    const strong = el('strong', {}, [value]);
    if (label === 'Status' && value === 'Active') strong.classList.add('ok-text');
    if (label === 'Status' && value === 'Trial') strong.classList.add('trial-text');
    if (label === 'Status' && value === 'Past due') strong.classList.add('pill', 'pill-past_due');
    if (label === 'Connect status') strong.classList.add('pill', `pill-connect-${String(tone || '').replaceAll('_', '-')}`);
    row.append(strong);
    card.append(row);
  }
  return card;
}

function paintTeam(company) {
  const plan = saasPlans[company.plan];
  const card = el('section', {class:'kv-card', 'data-panel':'team'});
  card.append(el('h2', {}, ['Team']));
  card.append(el('p', {class:'muted'}, [`${seatsUsed(company)} of ${plan.seats} seats used. Admin does not use a seat.`]));
  for (const member of company.team) {
    const row = el('div', {class:'kv'});
    row.append(el('span', {}, [member.name]));
    row.append(el('strong', {}, [member.note ? `${member.role} · ${member.note}` : member.role]));
    card.append(row);
  }
  return card;
}

function paintSupport(root, route) {
  const page = el('section', {class:'page', 'data-screen':'support'});
  const selectedId = route.id || (mobileQuery.matches ? null : model.threads[0]?.companyId);
  if (selectedId && mobileQuery.matches) page.classList.add('thread-open');
  page.append(el('h1', {class:'support-heading'}, ['Support']));
  if (selectedId) markRead(model, selectedId);
  syncChrome(route);
  const layout = el('div', {class:selectedId ? 'support-layout is-open' : 'support-layout'});
  layout.append(threadList(selectedId));
  if (selectedId) layout.append(threadPane(selectedId));
  else if (!mobileQuery.matches) layout.append(el('p', {class:'muted'}, ['Choose a thread.']));
  page.append(layout);
  root.append(page);
}

function threadList(selectedId) {
  const card = el('div', {class:'thread-list'});
  const filters = el('div', {class:'segment', role:'tablist', 'aria-label':'Threads'});
  for (const [value, label] of [['all','All'], ['unread','Unread']]) {
    const button = el('button', {type:'button', 'data-support-filter':value}, [label]);
    if (value === supportFilter) button.setAttribute('aria-current', 'true');
    filters.append(button);
  }
  card.append(filters);
  const threads = model.threads.filter(thread => supportFilter === 'all' || thread.unread > 0 || isSupportFlag(thread));
  if (!threads.length) card.append(el('p', {class:'muted empty-threads'}, [supportFilter === 'unread' ? 'No unread threads.' : 'No support threads yet.']));
  for (const thread of threads) {
    const company = companyById(model, thread.companyId);
    const link = el('a', {class:thread.companyId === selectedId ? 'thread-link is-selected' : 'thread-link', href:`#/support/${thread.companyId}`});
    const text = el('span', {class:'thread-copy'});
    text.append(el('strong', {class:'desk-only'}, [`${company?.name || thread.companyId} — ${thread.topic}`]));
    const stack = el('span', {class:'mob-only thread-stack'});
    stack.append(el('strong', {}, [company?.name || thread.companyId]));
    stack.append(el('span', {}, [thread.topic]));
    text.append(stack);
    link.append(text);
    const meta = el('span', {class:'thread-meta'});
    meta.append(thread.when);
    if (thread.unread) {
      meta.append(el('i', {class:'presence desk-only', 'aria-hidden':'true'}));
      meta.append(el('span', {class:'badge mob-only'}, [String(thread.unread)]));
    }
    meta.append(el('span', {class:'chevron mob-only', 'aria-hidden':'true'}, ['›']));
    link.append(meta);
    card.append(link);
  }
  return card;
}

function threadPane(companyId) {
  const thread = threadByCompany(model, companyId);
  const company = companyById(model, companyId);
  const pane = el('article', {class:'thread-pane'});
  if (!thread || !company) {
    pane.append(el('p', {}, ['Thread not found.']));
    return pane;
  }
  pane.append(el('a', {class:'back thread-back', href:'#/support'}, ['‹']));
  const head = el('div', {class:'thread-head'});
  const titles = el('div');
  const Title = mobileQuery.matches ? 'h1' : 'h2';
  titles.append(el(Title, {class:'thread-title'}, [mobileQuery.matches ? company.name : `${company.name} · ${thread.topic}`]));
  titles.append(el('p', {class:'topic mob-only'}, [thread.topic]));
  titles.append(el('a', {class:'company-jump', href:`#/companies/${company.id}`}, ['View company']));
  head.append(titles);
  pane.append(head);
  const log = el('div', {class:'messages'});
  for (const message of thread.messages) {
    const bubble = el('div', {class:message.sender === 'operator' ? 'bubble mine' : 'bubble'});
    bubble.append(el('p', {}, [message.body]));
    bubble.append(el('time', {}, [message.at]));
    log.append(bubble);
  }
  pane.append(log);
  const form = el('form', {id:'reply-form', 'data-company':companyId});
  form.append(el('p', {id:'reply-error', class:'form-error', role:'alert', hidden:''}));
  form.append(el('textarea', {id:'reply-body', name:'reply', maxlength:'4000', placeholder:'Write a reply', 'aria-label':'Write a reply'}));
  const send = el('button', {type:'submit', disabled:''}, ['Send']);
  form.append(send);
  pane.append(form);
  return pane;
}

function showLogin() {
  $('#login-view').hidden = false;
  $('#app-view').hidden = true;
  $('#check-email').hidden = true;
  $('#magic-form').hidden = false;
  $('#google-signin').hidden = false;
  document.querySelector('.or').hidden = false;
  $('#magic-status').replaceChildren();
  document.title = 'KlarraumApp · Operator sign in';
}

function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  if (!location.hash) location.hash = '#/attention';
  render();
}

function loginError(message) {
  const node = $('#login-error');
  node.hidden = !message;
  node.textContent = message || '';
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method:'POST',
    headers:{'Content-Type':'application/json', ...(csrf ? {'X-CSRF-Token':csrf} : {})},
    body:JSON.stringify(body ?? {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

$('#google-signin').addEventListener('click', async () => {
  loginError('');
  $('#google-signin').disabled = true;
  try {
    csrf = (await postJson('/api/director/demo-signin')).csrf;
    model = createConsole();
    showApp();
  } catch (error) {
    loginError(error.message === 'Not found.' ? 'Google sign-in is not configured.' : error.message);
  } finally {
    $('#google-signin').disabled = false;
  }
});

$('#magic-form').addEventListener('submit', async event => {
  event.preventDefault();
  loginError('');
  const status = $('#magic-status');
  status.replaceChildren();
  const button = event.submitter;
  button.disabled = true;
  try {
    const data = await postJson('/api/director/sign-in-link', {email:$('#work-email').value});
    $('#magic-form').hidden = true;
    $('#google-signin').hidden = true;
    document.querySelector('.or').hidden = true;
    $('#check-email').hidden = false;
    if (data.devLink) {
      status.append('This demo has no mailbox. ');
      status.append(el('a', {href:data.devLink}, ['Open the sign-in link']));
    }
  } catch (error) {
    loginError(error.message);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action="sign-out"]');
  if (!button || $('#app-view').hidden) return;
  event.preventDefault();
  try { await postJson('/api/director/logout'); } catch { /* The session is dropped locally either way. */ }
  csrf = '';
  search = '';
  statusFilter = 'all';
  supportFilter = 'all';
  model = createConsole();
  location.hash = '';
  showLogin();
});

screen().addEventListener('input', event => {
  if (event.target.id === 'company-search') {
    search = event.target.value;
    fillCompanyResults();
  }
  if (event.target.id === 'reply-body') {
    const button = event.target.form?.querySelector('button[type="submit"]');
    if (button) button.disabled = !event.target.value.trim();
  }
});

document.addEventListener('click', event => {
  const filter = event.target.closest('[data-support-filter]');
  if (!filter || $('#app-view').hidden) return;
  supportFilter = filter.dataset.supportFilter;
  render();
});

screen().addEventListener('change', event => {
  if (event.target.id !== 'company-status') return;
  statusFilter = event.target.value;
  fillCompanyResults();
});

screen().addEventListener('submit', event => {
  if (event.target.id !== 'reply-form') return;
  event.preventDefault();
  const form = event.target;
  try {
    replyToThread(model, form.dataset.company, form.elements.reply.value);
    render();
  } catch (error) {
    const slot = $('#reply-error');
    if (slot) {
      slot.hidden = false;
      slot.textContent = error.message;
    }
  }
});

window.addEventListener('hashchange', () => {
  if (!$('#app-view').hidden) render();
});
mobileQuery.addEventListener('change', () => {
  if (!$('#app-view').hidden) render();
});

const session = await fetch('/api/director/session');
if (session.ok) {
  csrf = (await session.json()).csrf;
  showApp();
} else showLogin();

