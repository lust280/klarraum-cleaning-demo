// Manual operator console (AI off). Demo companies only — no Stripe API.
// Plans locked for the pilot: Starter €49/2 · Pro €89/5 · Plus €149/10.
// Trial is 5 days on Pro, no card. Partner Connect status is read-only.
// Job status (new, accepted, assigned, in_progress, done, declined, cancelled)
// belongs to Partner Ops. This module never changes it.

export const TRIAL_DAYS = 5;
export const DEMO_NOW = Date.parse('2026-10-29T09:42:00Z');

export const saasPlans = Object.freeze({
  starter: Object.freeze({key:'starter', name:'Starter', monthlyCents:4900, seats:2}),
  pro: Object.freeze({key:'pro', name:'Pro', monthlyCents:8900, seats:5}),
  plus: Object.freeze({key:'plus', name:'Plus', monthlyCents:14900, seats:10}),
});

export const operator = Object.freeze({
  name:'Culiuc Andrei',
  role:'Operator',
  initial:'C',
  email:'operator@klarraumapp.de',
});

const companies = [
  {
    id:'cleanpro',
    name:'CleanPro',
    listName:'CleanPro',
    city:'Hamburg',
    plan:'pro',
    status:'past_due',
    owner:'billing@cleanpro.de',
    created:'2026-03-03',
    jobsThisMonth:142,
    storageUsedGb:3.1,
    storageLimitGb:10,
    lowActivity:false,
    team:[
      {name:'Petra Holm', role:'Admin', note:'Owner · does not use a seat'},
      {name:'Sven Adler', role:'Cleaner'},
      {name:'Mia Brandt', role:'Cleaner'},
      {name:'Jonas Krüger', role:'Helper'},
      {name:'Lea Hoffmann', role:'Cleaner'},
      {name:'Tim Busch', role:'Helper'},
    ],
    subscription:{status:'past_due', nextInvoice:'2026-11-12', lastPayment:{date:'2026-10-12', cents:8900, state:'Failed'}},
    connect:{status:'connected', account:'acct_••••••9K4p', cardPayments:'On', payouts:'Enabled'},
  },
  {
    id:'fresh',
    name:'Fresh Clean',
    listName:'Fresh Clean',
    city:'Berlin',
    plan:'pro',
    status:'trial',
    trialEnds:'2026-10-31',
    owner:'anna@freshclean.de',
    created:'2026-10-26',
    jobsThisMonth:4,
    storageUsedGb:4.6,
    storageLimitGb:5,
    lowActivity:false,
    team:[
      {name:'Anna Keller', role:'Admin', note:'Owner · does not use a seat'},
      {name:'Emil Wagner', role:'Cleaner'},
      {name:'Nora Schäfer', role:'Helper'},
      {name:'Paul Richter', role:'Cleaner'},
    ],
    subscription:{status:'trial', nextInvoice:null, lastPayment:null},
    connect:{status:'not_connected', account:'—', cardPayments:'Off', payouts:'Off'},
  },
  {
    id:'sparkle',
    name:'Sparkle Berlin',
    listName:'Sparkle Berlin',
    city:'Berlin',
    plan:'pro',
    status:'active',
    owner:'anna@sparkleclean.de',
    created:'2026-03-03',
    jobsThisMonth:142,
    storageUsedGb:2.4,
    storageLimitGb:10,
    lowActivity:false,
    team:[
      {name:'Lena Hoffmann', role:'Admin', note:'Owner · does not use a seat'},
      {name:'Karl Busch', role:'Cleaner'},
      {name:'Ida Berger', role:'Cleaner'},
      {name:'Mats König', role:'Helper'},
      {name:'Sofia Lang', role:'Cleaner'},
    ],
    subscription:{status:'active', nextInvoice:'2026-11-12', lastPayment:{date:'2026-10-12', cents:8900, state:'Paid'}},
    connect:{status:'connected', account:'acct_••••••7Q2x', cardPayments:'On', payouts:'Enabled'},
  },
  {
    id:'blitz',
    name:'Blitz GmbH',
    listName:'Blitz GmbH',
    city:'Frankfurt',
    plan:'plus',
    status:'active',
    owner:'office@blitz.de',
    created:'2026-02-02',
    jobsThisMonth:210,
    storageUsedGb:6.2,
    storageLimitGb:10,
    lowActivity:false,
    team:[
      {name:'Ralf Neumann', role:'Admin', note:'Owner · does not use a seat'},
      {name:'Clara Vogel', role:'Cleaner'},
      {name:'Henrik Otto', role:'Cleaner'},
      {name:'Jana Pfeiffer', role:'Helper'},
      {name:'Ole Hartmann', role:'Cleaner'},
      {name:'Mara Seidel', role:'Helper'},
      {name:'Finn Kruse', role:'Cleaner'},
    ],
    subscription:{status:'active', nextInvoice:'2026-11-08', lastPayment:{date:'2026-10-08', cents:14900, state:'Paid'}},
    connect:{status:'error', account:'acct_••••••4M1p', cardPayments:'Off', payouts:'Disabled'},
  },
  {
    id:'nordhaus',
    name:'NordHaus',
    listName:'NordHaus',
    city:'Munich',
    plan:'starter',
    status:'active',
    owner:'team@nordhaus.de',
    created:'2026-06-18',
    jobsThisMonth:11,
    storageUsedGb:0.4,
    storageLimitGb:5,
    lowActivity:true,
    team:[
      {name:'Ines Graf', role:'Admin', note:'Owner · does not use a seat'},
      {name:'Tom Albrecht', role:'Cleaner'},
      {name:'Eva Lind', role:'Helper'},
    ],
    subscription:{status:'active', nextInvoice:'2026-11-18', lastPayment:{date:'2026-10-18', cents:4900, state:'Paid'}},
    connect:{status:'disconnected', account:'—', cardPayments:'Off', payouts:'Disabled'},
  },
];

const threads = [
  {
    companyId:'cleanpro',
    topic:'Payment question',
    when:'10:24',
    unread:1,
    messages:[
      {id:'cp1', sender:'partner', body:'Our customer paid twice, how to refund?', at:'10:24'},
    ],
  },
  {
    companyId:'blitz',
    topic:'Calendar not syncing',
    when:'08:40',
    unread:1,
    messages:[
      {id:'bz1', sender:'partner', body:'Jobs stopped appearing in Google Calendar this morning.', at:'08:40'},
    ],
  },
  {
    companyId:'fresh',
    topic:'How do I add a seat?',
    when:'Yesterday',
    unread:0,
    messages:[
      {id:'fr1', sender:'partner', body:'How do I add a seat for a new cleaner?', at:'16:05'},
      {id:'fr2', sender:'operator', body:'Send an invite from Team. Trial Pro includes 5 seats. Admin does not use a seat.', at:'16:40'},
    ],
  },
  {
    companyId:'sparkle',
    topic:'Invoice copy please',
    when:'Mon',
    unread:0,
    messages:[
      {id:'sp1', sender:'partner', body:'Could you send a copy of the latest invoice?', at:'11:15'},
      {id:'sp2', sender:'operator', body:'The last Pro invoice was €89.00 on 12 Oct 2026. I can confirm it was paid. This is your KlarraumApp subscription, separate from customer card payments.', at:'11:22'},
    ],
  },
  {
    companyId:'nordhaus',
    topic:'Thanks, all good now',
    when:'27 Oct',
    unread:0,
    messages:[
      {id:'nd1', sender:'partner', body:'Thanks, all good now.', at:'14:02'},
    ],
  },
];

export function createConsole(now = DEMO_NOW) {
  return {now, operator, companies:structuredClone(companies), threads:structuredClone(threads)};
}

export function berlinDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Berlin', year:'numeric', month:'2-digit', day:'2-digit'}).format(ms);
}

export function clock(ms) {
  return new Intl.DateTimeFormat('en-GB', {hour:'2-digit', minute:'2-digit', hourCycle:'h23', timeZone:'Europe/Berlin'}).format(ms);
}

const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function formatDate(iso) {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return '—';
  return `${day} ${monthNames[month - 1]} ${year}`;
}

export function formatEuro(cents) {
  return `€${(cents / 100).toFixed(2)}`;
}

export function planPrice(plan) {
  return `€${plan.monthlyCents / 100}/mo`;
}

export function formatGb(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function seatsUsed(company) {
  return company.team.filter(member => member.role !== 'Admin').length;
}

export function storageRatio(company) {
  if (!company.storageLimitGb) return 0;
  return company.storageUsedGb / company.storageLimitGb;
}

export function trialDaysLeft(company, now) {
  if (company.status !== 'trial' || !company.trialEnds) return null;
  const today = berlinDate(now);
  return Math.round((Date.parse(`${company.trialEnds}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

export function companyById(model, id) {
  return model.companies.find(company => company.id === id) || null;
}

export function threadByCompany(model, id) {
  return model.threads.find(thread => thread.companyId === id) || null;
}

export function endingTrials(model) {
  return model.companies.flatMap(company => {
    const days = trialDaysLeft(company, model.now);
    if (days === null || days < 0 || days > TRIAL_DAYS) return [];
    return [{companyId:company.id, name:company.listName || company.name, days}];
  });
}

export function isSupportFlag(thread) {
  if (!thread?.unread) return false;
  return thread.messages.at(-1)?.sender === 'partner';
}

export function attention(model) {
  const trials = endingTrials(model);
  const support = model.threads.filter(isSupportFlag).map(thread => {
    const company = companyById(model, thread.companyId);
    return {companyId:thread.companyId, name:company?.name || thread.companyId, topic:thread.topic};
  });
  const storage = model.companies.filter(company => storageRatio(company) >= 0.8).map(company => ({
    companyId:company.id,
    name:company.listName || company.name,
    ratio:storageRatio(company),
    used:company.storageUsedGb,
    limit:company.storageLimitGb,
  }));
  const total = trials.length + support.length + storage.length;
  return {trials, support, storage, total, clear:total === 0, checkedAt:clock(model.now)};
}

export function supportBadge(model) {
  return model.threads.filter(isSupportFlag).length;
}

export function statusLabel(status) {
  if (status === 'trial') return 'Trial';
  if (status === 'past_due') return 'Past due';
  if (status === 'readonly') return 'Read-only';
  return 'Active';
}

export function connectLabel(status) {
  if (status === 'connected') return 'Connected';
  if (status === 'error') return 'Error';
  if (status === 'disconnected') return 'Disconnected';
  return 'Not connected';
}

export function filterCompanies(companies, {query = '', status = 'all'} = {}) {
  const needle = query.trim().toLowerCase();
  return companies.filter(company => {
    if (status !== 'all' && company.status !== status) return false;
    if (!needle) return true;
    return `${company.name} ${company.listName} ${company.city}`.toLowerCase().includes(needle);
  });
}

export function groupByPlan(list) {
  return ['starter', 'pro', 'plus'].map(key => ({
    plan:saasPlans[key],
    companies:list.filter(company => company.plan === key),
  })).filter(group => group.companies.length);
}

export function paymentsView(company) {
  const plan = saasPlans[company.plan];
  if (!plan) throw new Error('Unknown plan.');
  const trial = company.status === 'trial';
  const ended = company.status === 'readonly';
  const last = company.subscription?.lastPayment;
  const connectStatus = connectLabel(company.connect?.status);
  const third = ended
    ? ['Booking', 'Paused']
    : trial
      ? ['Trial ends', formatDate(company.trialEnds)]
      : ['Next invoice', formatDate(company.subscription?.nextInvoice)];
  return {
    live:false,
    saas:{
      heading:'KlarraumApp subscription',
      note:'Your revenue',
      rows:[
        ['Plan', `${plan.name} ${planPrice(plan)}`],
        ['Status', trial ? 'Trial' : statusLabel(company.status)],
        third,
        ['Last payment', last ? `${formatDate(last.date)} · ${formatEuro(last.cents)} ${last.state}` : 'No card'],
        ...(ended ? [['Still open', 'Billing, Help, and Export']] : []),
      ],
    },
    connect:{
      heading:'Customer payments (Stripe Connect)',
      note:'Partner money · read-only',
      rows:[
        ['Connect status', connectStatus],
        ['Account', company.connect?.account || '—'],
        ['Card payments', company.connect?.cardPayments || 'Off'],
        ['Payouts', company.connect?.payouts || 'Off'],
      ],
    },
  };
}

export function markRead(model, companyId) {
  const thread = threadByCompany(model, companyId);
  if (thread) thread.unread = 0;
  return thread;
}

export function replyToThread(model, companyId, text) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body || body.length > 4000) throw new Error('Reply must be 1–4000 characters.');
  const thread = threadByCompany(model, companyId);
  if (!thread) throw new Error('Thread not found.');
  thread.messages.push({id:`local-${thread.messages.length + 1}`, sender:'operator', body, at:clock(model.now)});
  thread.unread = 0;
  thread.when = clock(model.now);
  return thread;
}

export function cleared(model) {
  const copy = structuredClone(model);
  for (const company of copy.companies) {
    if (company.status === 'trial') company.status = 'active';
    company.storageUsedGb = Math.min(company.storageUsedGb, company.storageLimitGb * 0.5);
  }
  for (const thread of copy.threads) thread.unread = 0;
  return copy;
}
