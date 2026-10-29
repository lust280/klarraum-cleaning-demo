import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

export const ESCALATION_TEMPLATE = "Thanks for writing. We'll look into this and get back within 24 hours. — Klarraum Support";
const MONEY_FACTS = 'Operator Stripe is the partner SaaS plan only. A customer card payment uses the partner Stripe Connect account and does not go through the operator. Do not promise a refund, discount, or payout.';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAY_INDEX = {Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6};
const RETENTION_MONTHS = 12;
const SLA_MS = 24 * 60 * 60 * 1000;

const CALENDAR_REPLY = 'Hi! Please open Settings → Google Calendar and tap Reconnect.\nJobs will sync again within a few minutes.\nBest, KlarraumApp Support';
const ADMIN_REPLY = 'Open Team → Invite and choose Admin.\nAdmin does not take a seat. Cleaner and Helper seats follow the plan on Billing → Plan.\nBest, KlarraumApp Support';
const INVOICE_REPLY = 'Billing → Plan → Invoices, download PDF.\nBest, KlarraumApp Support';
const BOOKING_REPLY = 'Settings → Booking site → Copy link.\nBest, KlarraumApp Support';
const STORAGE_REPLY = 'Photos and reports are kept for 12 months on every plan.\nBest, KlarraumApp Support';
const SEATS_REPLY = 'Open Team → Invite and choose Cleaner, Helper, or Admin.\nAdmin does not take a seat. Seat limits are the ones shown on Billing → Plan. Support cannot change the price.\nBest, KlarraumApp Support';

const MONEY_RE = /\b(refunds?|discounts?|prices?|pricing|payments?|payouts?|charges?|charged|billing|fees?|money|euros?|coupons?|cheaper|costs?|subscriptions?|pay)\b|\br(?:ü|ue)ckerstatt|\brabatt|\bpreis|\bzahlung|\bbezahlung|\b(?:eur|€)/i;
const ANGRY_RE = /\b(angry|anger|furious|fuming|complaints?|complain(?:ed)?|terrible|horrible|worst|unacceptable|hate|hateful|disgusting|scams?|scammed|ridiculous|awful|useless|disappointed|outrage[sd]?|incompetent|fed up)\b|\bnever again\b|\bbeschwerde|\bunverschämt|\binakzeptabel|\bwütend|\bwuetend/i;
const INVOICE_RE = /\binvoices?\b|\brechnungen?\b|\brechnungskopie\b/i;
const INVOICE_HOWTO_RE = /\b(copy|copies|download|pdf|where|find|kopie|herunterladen)\b|rechnungskopie/i;
const UNSAFE_REPLY_RE = /€\s?\d|\b\d+\s?%\s*off\b|\bI (?:have|will) refund\b|\bdiscount of\b/i;

export const PLAYBOOK_RULES = Object.freeze([
  {id:'calendar-sync', topic:'Calendar sync', summary:'Go to Settings > Google Calendar and reconnect.', reply:CALENDAR_REPLY, match:text=>/\b(calendar|sync(?:ing|ed)?)\b|\bkalender\b/i.test(text)},
  {id:'add-admin', topic:'Add admin', summary:'Open Team > Invite and choose Admin.', reply:ADMIN_REPLY, match:text=>/\badmins?\b|\badministrator\b/i.test(text)},
  {id:'invoice-copy', topic:'Invoice copy', summary:'Billing > Plan > Invoices, download PDF.', reply:INVOICE_REPLY, match:text=>isInvoiceHowto(text)},
  {id:'booking-link', topic:'Booking link', summary:'Settings > Booking site > Copy link.', reply:BOOKING_REPLY, match:text=>/\bbooking\b/i.test(text)&&/\b(link|site|url)\b/i.test(text)},
  {id:'trial', topic:'Trial ending', summary:'Open Billing > Plan to see the days left.', reply:trialReply, match:text=>/\btrials?\b/i.test(text)},
  {id:'storage', topic:'Storage', summary:'Photos and reports are kept for 12 months.', reply:STORAGE_REPLY, match:text=>/\bstorage\b/i.test(text)&&!/\b(add|buy|extra|more|upgrade|purchase)\b/i.test(text)},
  {id:'seats', topic:'Seats', summary:'Open Team > Invite. Admin does not take a seat.', reply:SEATS_REPLY, match:text=>/\bseats?\b/i.test(text)}
]);

function trialReply(_text, ctx={}) {
  const now = ctx.now ?? Date.now();
  const days = ctx.trialEndsAt ? Math.max(0, Math.ceil((ctx.trialEndsAt - now) / 86400000)) : null;
  const left = days == null ? 'Open Billing → Plan to see how many days are left.' : `Your trial has ${days} day${days === 1 ? '' : 's'} left. Open Billing → Plan.`;
  return `${left}\nSupport cannot offer a discount or change the price.\nBest, KlarraumApp Support`;
}
function isInvoiceHowto(text) {return INVOICE_RE.test(text) && INVOICE_HOWTO_RE.test(text);}
function isMoney(text) {
  if (MONEY_RE.test(text)) return true;
  return INVOICE_RE.test(text) && !INVOICE_HOWTO_RE.test(text);
}
function moneyTopic(text) {
  const value = text.toLowerCase();
  if (/refund|rückerstatt|rueckerstatt|erstattung/.test(value)) return 'Refund question';
  if (/discount|rabatt/.test(value)) return 'Discount question';
  if (/invoice|rechnung/.test(value)) return 'Invoice question';
  if (/price|pricing|preis|\bcost/.test(value)) return 'Price question';
  return 'Payment question';
}
function clip(text, max=80) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}
function httpError(status, message) {const error = new Error(message); error.status = status; return error;}
function loadPlaybookMarkdown() {
  try {return readFileSync(new URL('./support-playbook-v0.md', import.meta.url), 'utf8');}
  catch {return 'KlarraumApp Director Support AI playbook v0.';}
}

export function berlinParts(ms) {
  const fmt = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Berlin', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', weekday:'short', hourCycle:'h23'});
  const bag = {};
  for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== 'literal') bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {year:Number(bag.year), month:Number(bag.month), day:Number(bag.day), hour, minute:Number(bag.minute), weekday:bag.weekday};
}
function ymdAdd(y, m, d, days) {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return {y:t.getUTCFullYear(), m:t.getUTCMonth() + 1, d:t.getUTCDate()};
}
export function berlinDateTimeToUtc(y, m, d, hour, minute) {
  let utc = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 4; i++) {
    const p = berlinParts(utc);
    const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const want = Date.UTC(y, m - 1, d, hour, minute);
    if (got === want) return utc;
    utc -= got - want;
  }
  return utc;
}
export function berlinDayStart(ms) {
  const p = berlinParts(ms);
  return berlinDateTimeToUtc(p.year, p.month, p.day, 0, 0);
}
export function berlinWeek(ms) {
  const p = berlinParts(ms);
  const monday = ymdAdd(p.year, p.month, p.day, -(WEEKDAY_INDEX[p.weekday] ?? 0));
  const sunday = ymdAdd(monday.y, monday.m, monday.d, 6);
  const next = ymdAdd(monday.y, monday.m, monday.d, 7);
  const left = monday.y === sunday.y ? `${monday.d} ${MONTHS[monday.m - 1]}` : `${monday.d} ${MONTHS[monday.m - 1]} ${monday.y}`;
  return {start:berlinDateTimeToUtc(monday.y, monday.m, monday.d, 0, 0), end:berlinDateTimeToUtc(next.y, next.m, next.d, 0, 0), label:`${left} – ${sunday.d} ${MONTHS[sunday.m - 1]} ${sunday.y}`};
}
export function formatBerlin(ms, mode='daytime') {
  const p = berlinParts(ms);
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  const day = `${p.day} ${MONTHS[p.month - 1]}`;
  if (mode === 'time') return time;
  if (mode === 'date') return `${day} ${p.year}`;
  if (mode === 'day') return day;
  return `${day} ${time}`;
}
export function listTime(ms, now) {
  const a = berlinParts(ms), b = berlinParts(now);
  if (a.year === b.year && a.month === b.month && a.day === b.day) return formatBerlin(ms, 'time');
  const yesterday = ymdAdd(b.year, b.month, b.day, -1);
  if (a.year === yesterday.y && a.month === yesterday.m && a.day === yesterday.d) return 'Yesterday';
  return formatBerlin(ms, 'day');
}
function monthsAgo(ms, count) {
  const p = berlinParts(ms);
  const t = new Date(Date.UTC(p.year, p.month - 1 - count, p.day, p.hour, p.minute));
  return berlinDateTimeToUtc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes());
}

export function classifySupport(text, ctx={}) {
  const body = String(text || '').trim();
  if (!body) return {action:'escalate', reason:'unknown', topic:'Unknown issue', operatorHint:ESCALATION_TEMPLATE};
  if (isMoney(body)) return {action:'escalate', reason:'money', topic:moneyTopic(body), operatorHint:`${ESCALATION_TEMPLATE}\n\n${MONEY_FACTS}`};
  if (ANGRY_RE.test(body)) return {action:'escalate', reason:'angry', topic:'Complaint', operatorHint:ESCALATION_TEMPLATE};
  const rule = PLAYBOOK_RULES.find(item => item.match(body));
  if (!rule) return {action:'escalate', reason:'unknown', topic:'Unknown issue', operatorHint:ESCALATION_TEMPLATE};
  const reply = typeof rule.reply === 'function' ? rule.reply(body, ctx) : rule.reply;
  if (!reply || UNSAFE_REPLY_RE.test(reply)) return {action:'escalate', reason:'unknown', topic:'Unknown issue', operatorHint:ESCALATION_TEMPLATE};
  return {action:'send', topic:rule.topic, summary:rule.summary, reply, ruleId:rule.id};
}

function seedPayload() {
  return PLAYBOOK_RULES.map(rule => ({id:rule.id, topic:rule.topic, summary:rule.summary, reply:typeof rule.reply === 'function' ? rule.reply('', {}) : rule.reply}));
}

export class DirectorAi {
  constructor(db, options={}) {
    this.db = db;
    this.clock = options.clock || Date.now;
    this.addAiReply = options.addAiReply;
    this.markMessageRead = options.markMessageRead || (()=>{});
    this.reopenMessage = options.reopenMessage || (()=>{});
    this.company = options.company || (()=>null);
    this.mailer = options.mailer || (async()=>({sent:false}));
    this.event = options.event || (()=>{});
    this.shellAlerts = options.shellAlerts || (()=>({trials:[], storage:[]}));
    this.ensureSchema();
    this.syncPlaybook();
  }
  ensureSchema() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS ai_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_log (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        reply_message_id TEXT,
        topic TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        ai_reply TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        reason TEXT,
        operator_hint TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        due_at INTEGER,
        review_state TEXT,
        reviewed_at INTEGER,
        resolved_at INTEGER,
        playbook_fix INTEGER NOT NULL DEFAULT 0,
        email_sent INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS ai_playbook_notes (
        id TEXT PRIMARY KEY,
        log_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        reply TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_log_created ON ai_log(created_at);
      CREATE INDEX IF NOT EXISTS ai_log_company ON ai_log(company_id, created_at);`);
  }
  syncPlaybook() {
    const markdown = loadPlaybookMarkdown();
    const rules = JSON.stringify(seedPayload());
    const put = this.db.prepare('INSERT INTO ai_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    put.run('playbook_md', markdown);
    put.run('playbook_rules', rules);
    put.run('playbook_updated', '2026-10-29');
  }
  setting(key) {return this.db.prepare('SELECT value FROM ai_settings WHERE key=?').get(key)?.value ?? null;}
  enabled() {return this.setting('enabled') === '1';}
  settingsView() {
    const enabled = this.enabled();
    const last = Number(this.setting('last_review_at'));
    const lastReviewAt = Number.isFinite(last) && last > 0 ? last : null;
    return {enabled, autoSend:enabled, weeklyReview:'Monday', escalationHours:24, retentionMonths:RETENTION_MONTHS, lastReviewAt, lastReviewLabel:lastReviewAt ? formatBerlin(lastReviewAt, 'date') : null};
  }
  setEnabled(enabled) {
    this.db.prepare("INSERT INTO ai_settings(key,value) VALUES('enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(enabled ? '1' : '0');
    this.event(null, enabled ? 'ai_enabled' : 'ai_disabled', {});
    return this.settingsView();
  }
  finishReview() {
    const now = this.clock();
    this.db.prepare("INSERT INTO ai_settings(key,value) VALUES('last_review_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now));
    this.event(null, 'ai_weekly_review_finished', {at:now});
    return this.settingsView();
  }
  prune() {
    const cutoff = monthsAgo(this.clock(), RETENTION_MONTHS);
    this.db.prepare('DELETE FROM ai_log WHERE created_at < ?').run(cutoff);
    this.db.prepare('DELETE FROM ai_playbook_notes WHERE created_at < ?').run(cutoff);
    return cutoff;
  }
  rows() {
    this.prune();
    return this.db.prepare(`SELECT l.*, c.name AS company_name FROM ai_log l LEFT JOIN companies c ON c.id=l.company_id ORDER BY l.created_at DESC, l.id DESC`).all();
  }
  async handleIncoming({companyId, messageId, body}) {
    if (!this.enabled()) return {action:'off'};
    this.prune();
    const existing = this.db.prepare('SELECT * FROM ai_log WHERE message_id=?').get(messageId);
    if (existing) return {action:existing.status === 'sent' ? 'sent' : 'escalated', duplicate:true, id:existing.id, reason:existing.reason, topic:existing.topic};
    const company = this.company(companyId);
    const now = this.clock();
    const decision = classifySupport(body, {trialEndsAt:company?.trialEndsAt ?? null, now});
    if (decision.action === 'send') {
      const reply = this.addAiReply(companyId, decision.reply);
      const id = randomUUID();
      this.db.prepare(`INSERT INTO ai_log(id,company_id,message_id,reply_message_id,topic,summary,ai_reply,status,reason,operator_hint,created_at,due_at,playbook_fix,email_sent)
        VALUES(?,?,?,?,?,?,?,'sent',NULL,'',?,NULL,0,0)`).run(id, companyId, messageId, reply.id, decision.topic, decision.summary, decision.reply, now);
      this.markMessageRead(messageId);
      this.event(companyId, 'ai_reply_sent', {topic:decision.topic, logId:id});
      return {action:'sent', id, topic:decision.topic, replyId:reply.id, createdAt:now};
    }
    const id = randomUUID();
    const dueAt = now + SLA_MS;
    this.db.prepare(`INSERT INTO ai_log(id,company_id,message_id,reply_message_id,topic,summary,ai_reply,status,reason,operator_hint,created_at,due_at,playbook_fix,email_sent)
      VALUES(?,?,?,NULL,?,?,?,'escalated',?,?,?,?,0,0)`).run(id, companyId, messageId, decision.topic, '', '', decision.reason, decision.operatorHint, now, dueAt);
    let emailSent = false;
    try {
      const result = await this.mailer({
        subject:`Escalated support · ${company?.name || 'Company'}`,
        text:`${company?.name || 'Company'} needs a reply within 24 hours.\nTopic: ${decision.topic}\nReason: ${decision.reason}\n\nTheir message:\n${body}\n\nDo not promise a refund, discount, or payout.\nSuggested reply:\n${ESCALATION_TEMPLATE}`
      });
      emailSent = Boolean(result?.sent);
    } catch {emailSent = false;}
    if (emailSent) this.db.prepare('UPDATE ai_log SET email_sent=1 WHERE id=?').run(id);
    this.event(companyId, 'ai_escalated', {topic:decision.topic, reason:decision.reason, logId:id, emailSent});
    return {action:'escalated', id, reason:decision.reason, topic:decision.topic, dueAt, createdAt:now, emailSent};
  }
  resolveEscalations(companyId, at) {
    const now = at || this.clock();
    this.db.prepare("UPDATE ai_log SET resolved_at=? WHERE company_id=? AND status='escalated' AND resolved_at IS NULL AND created_at<=?").run(now, companyId, now);
  }
  forgetCompany(companyId) {
    this.db.prepare('DELETE FROM ai_playbook_notes WHERE company_id=?').run(companyId);
    this.db.prepare('DELETE FROM ai_log WHERE company_id=?').run(companyId);
  }
  statusLabel(row, now) {
    if (row.status === 'sent') return 'Replied';
    if (row.resolved_at) return 'Escalated · replied';
    if (!row.due_at || row.due_at <= now) return 'Escalated · overdue';
    return `Escalated · due in ${Math.max(1, Math.ceil((row.due_at - now) / 3600000))}h`;
  }
  publicLogRow(row, now) {
    return {
      id:row.id, companyId:row.company_id, company:row.company_name || 'Company', topic:row.topic,
      aiReply:row.status === 'sent' ? 'Sent' : 'Not sent', replyText:row.status === 'sent' ? row.ai_reply : '',
      summary:row.summary || '', status:row.status, reason:row.reason || null,
      statusLabel:this.statusLabel(row, now), createdAt:row.created_at, dueAt:row.due_at || null,
      timeLabel:formatBerlin(row.created_at, 'daytime'), reviewState:row.review_state || null
    };
  }
  log(filter='all') {
    const now = this.clock();
    const week = berlinWeek(now);
    let rows = this.rows();
    if (filter === 'sent') rows = rows.filter(row => row.status === 'sent');
    else if (filter === 'escalated') rows = rows.filter(row => row.status === 'escalated');
    else if (filter === 'week') rows = rows.filter(row => row.created_at >= week.start && row.created_at < week.end);
    else if (filter !== 'all') throw httpError(400, 'Unknown log filter.');
    return {filter, retentionMonths:RETENTION_MONTHS, note:'Log kept 12 months. Money, unknown or angry messages go to you within 24h.', items:rows.map(row => this.publicLogRow(row, now))};
  }
  attention() {
    const now = this.clock();
    const dayStart = berlinDayStart(now);
    const week = berlinWeek(now);
    const rows = this.rows();
    const handled = rows.filter(row => row.status === 'sent' && row.created_at >= dayStart);
    const escalated = rows.filter(row => row.status === 'escalated' && !row.resolved_at);
    const weekSent = rows.filter(row => row.status === 'sent' && row.created_at >= week.start && row.created_at < week.end);
    const shell = this.shellAlerts() || {trials:[], storage:[]};
    const enabled = this.enabled();
    return {
      enabled, autoSend:enabled, badge:enabled ? 'AI replies: ON · Auto' : 'AI replies: OFF · Manual',
      handled:{count:handled.length, items:handled.slice(0, 8).map(row => ({id:row.id, companyId:row.company_id, company:row.company_name || 'Company', topic:row.topic, timeLabel:formatBerlin(row.created_at, 'time'), statusLabel:'Replied'}))},
      escalated:{count:escalated.length, items:escalated.map(row => ({id:row.id, companyId:row.company_id, company:row.company_name || 'Company', topic:row.topic, dueAt:row.due_at, dueLabel:this.statusLabel(row, now).replace(/^Escalated · /, ''), operatorHint:row.operator_hint}))},
      review:{count:weekSent.length, reviewed:weekSent.filter(row => row.review_state === 'ok' || row.review_state === 'flagged').length, complaints:weekSent.filter(row => row.review_state === 'flagged').length, weekLabel:week.label},
      shell:{
        trials:(shell.trials || []).map(item => ({...item, label:item.trialEndsAt ? formatBerlin(item.trialEndsAt, 'date') : ''})),
        storage:shell.storage || []
      },
      note:'AI replies send automatically. Unknown or money questions go to you within 24h.'
    };
  }
  threads() {
    const now = this.clock();
    const companies = this.db.prepare(`SELECT c.id, c.name,
      (SELECT body FROM support_messages WHERE company_id=c.id ORDER BY created_at DESC, id DESC LIMIT 1) AS preview,
      (SELECT created_at FROM support_messages WHERE company_id=c.id ORDER BY created_at DESC, id DESC LIMIT 1) AS latest,
      (SELECT COUNT(*) FROM support_messages WHERE company_id=c.id AND sender='company' AND read_at IS NULL) AS unread
      FROM companies c WHERE EXISTS (SELECT 1 FROM support_messages m WHERE m.company_id=c.id)
      ORDER BY latest DESC`).all();
    return {enabled:this.enabled(), autoSend:this.enabled(), items:companies.map(row => {
      const log = this.db.prepare('SELECT topic, status FROM ai_log WHERE company_id=? ORDER BY created_at DESC, id DESC LIMIT 1').get(row.id);
      return {companyId:row.id, company:row.name, topic:log?.topic || clip(row.preview, 42), preview:clip(row.preview, 90), timeLabel:listTime(row.latest, now), unread:row.unread > 0, escalated:log?.status === 'escalated'};
    })};
  }
  thread(companyId) {
    const company = this.company(companyId);
    if (!company) throw httpError(404, 'Company not found.');
    const messages = this.db.prepare('SELECT id,sender,body,created_at,read_at,kind FROM support_messages WHERE company_id=? ORDER BY created_at, id').all(companyId);
    const logs = this.db.prepare('SELECT * FROM ai_log WHERE company_id=? ORDER BY created_at DESC, id DESC').all(companyId);
    const byReply = new Map(logs.filter(row => row.reply_message_id).map(row => [row.reply_message_id, row]));
    const open = logs.find(row => row.status === 'escalated' && !row.resolved_at) || null;
    const now = this.clock();
    const week = berlinWeek(now);
    let topic = logs[0]?.topic;
    if (!topic) {
      const partner = [...messages].reverse().find(item => item.sender === 'company');
      topic = clip(partner?.body || 'Support', 42);
    }
    return {
      companyId, company:company.name, topic, enabled:this.enabled(), autoSend:this.enabled(),
      escalation:open ? {id:open.id, topic:open.topic, reason:open.reason, dueAt:open.due_at, dueLabel:this.statusLabel(open, now).replace(/^Escalated · /, ''), operatorHint:open.operator_hint, template:ESCALATION_TEMPLATE} : null,
      messages:messages.map(item => {
        const log = byReply.get(item.id);
        let reviewLabel = null;
        if (log?.status === 'sent') {
          if (log.review_state === 'ok') reviewLabel = 'Reviewed';
          else if (log.review_state === 'flagged') reviewLabel = 'Flagged for playbook fix';
          else if (log.created_at >= week.start && log.created_at < week.end) reviewLabel = 'in weekly review';
        }
        return {id:item.id, sender:item.sender, kind:item.kind || 'manual', body:item.body, createdAt:item.created_at, timeLabel:formatBerlin(item.created_at, 'time'), reviewLabel};
      })
    };
  }
  reviewView() {
    const now = this.clock();
    const week = berlinWeek(now);
    const items = this.rows()
      .filter(row => row.status === 'sent' && row.created_at >= week.start && row.created_at < week.end)
      .sort((a, b) => a.created_at - b.created_at || String(a.id).localeCompare(String(b.id)));
    return {
      weekLabel:week.label, start:week.start, end:week.end, total:items.length,
      reviewed:items.filter(row => row.review_state === 'ok' || row.review_state === 'flagged').length,
      complaints:items.filter(row => row.review_state === 'flagged').length,
      items:items.map(row => ({id:row.id, companyId:row.company_id, company:row.company_name || 'Company', topic:row.topic, summary:row.summary || row.ai_reply, reply:row.ai_reply, reviewState:row.review_state || null, timeLabel:formatBerlin(row.created_at, 'daytime')}))
    };
  }
  markReview(id, action, note) {
    const row = this.db.prepare('SELECT * FROM ai_log WHERE id=?').get(id);
    if (!row) throw httpError(404, 'AI log entry not found.');
    if (row.status !== 'sent') throw httpError(409, 'Only a sent AI reply can be marked in weekly review.');
    const now = this.clock();
    if (action === 'ok') {
      this.db.prepare("UPDATE ai_log SET review_state='ok', reviewed_at=?, playbook_fix=0 WHERE id=?").run(now, id);
      this.event(row.company_id, 'ai_review_ok', {logId:id});
    } else if (action === 'flag') {
      const text = String(note || 'Marked for playbook / prompt fix.').trim();
      if (!text || text.length > 500) throw httpError(400, 'Flag note must be 1–500 characters.');
      this.db.prepare("UPDATE ai_log SET review_state='flagged', reviewed_at=?, playbook_fix=1 WHERE id=?").run(now, id);
      this.db.prepare('INSERT INTO ai_playbook_notes(id,log_id,company_id,topic,reply,note,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), id, row.company_id, row.topic, row.ai_reply, text, now);
      this.reopenMessage(row.message_id);
      this.event(row.company_id, 'ai_review_flagged', {logId:id});
    } else throw httpError(400, 'Choose OK or Flag.');
    return this.reviewView();
  }
  playbook() {
    const rules = JSON.parse(this.setting('playbook_rules') || '[]');
    const notes = this.db.prepare(`SELECT n.id, n.log_id, n.company_id, c.name AS company, n.topic, n.reply, n.note, n.created_at
      FROM ai_playbook_notes n LEFT JOIN companies c ON c.id=n.company_id ORDER BY n.created_at DESC, n.id DESC LIMIT 100`).all();
    return {updated:this.setting('playbook_updated'), template:ESCALATION_TEMPLATE, rules, notes, markdown:this.setting('playbook_md') || ''};
  }
}

export async function handleDirectorAi(ai, tools) {
  const path = tools.route.pathname, method = tools.method;
  const send = (status, data) => tools.json(tools.res, status, data);
  if (path === '/api/director/ai/settings' && method === 'GET') return send(200, ai.settingsView());
  if (path === '/api/director/ai/settings' && method === 'PUT') {
    const input = await tools.readJson();
    if (!input || typeof input.enabled !== 'boolean') tools.fail(400, 'Choose AI replies on or off.');
    if (input.enabled === true && input.autoSend === false) tools.fail(400, 'Auto-send stays on when AI replies are on.');
    return send(200, ai.setEnabled(input.enabled));
  }
  if (path === '/api/director/ai/attention' && method === 'GET') return send(200, ai.attention());
  if (path === '/api/director/ai/log' && method === 'GET') return send(200, ai.log(tools.route.searchParams.get('filter') || 'all'));
  if (path === '/api/director/ai/threads' && method === 'GET') return send(200, ai.threads());
  const threadMatch = /^\/api\/director\/ai\/threads\/([a-f0-9-]{36})$/.exec(path);
  if (threadMatch && method === 'GET') {
    const data = ai.thread(threadMatch[1]);
    tools.markRead?.(threadMatch[1]);
    return send(200, data);
  }
  if (path === '/api/director/ai/review' && method === 'GET') return send(200, ai.reviewView());
  if (path === '/api/director/ai/review/finish' && method === 'POST') return send(200, ai.finishReview());
  const reviewMatch = /^\/api\/director\/ai\/review\/([a-f0-9-]{36})$/.exec(path);
  if (reviewMatch && method === 'POST') {
    const input = await tools.readJson();
    return send(200, ai.markReview(reviewMatch[1], input?.action, input?.note));
  }
  if (path === '/api/director/ai/playbook' && method === 'GET') return send(200, ai.playbook());
  if (path.startsWith('/api/director/ai')) tools.fail(404, 'Not found.');
}
