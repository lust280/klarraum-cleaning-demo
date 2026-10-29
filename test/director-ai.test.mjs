import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDirector, directorConfig} from '../director.mjs';
import {hashPassword} from '../lib/security.mjs';
import {classifySupport, berlinWeek, ESCALATION_TEMPLATE, PLAYBOOK_RULES} from '../lib/director-ai.mjs';

const password = 'director-test-password-only';
const passwordHash = await hashPassword(password);
const day = 24 * 60 * 60 * 1000;

test('support classification sends known how-tos and holds money, anger, and unknown questions', () => {
  const calendar = classifySupport('Our Google Calendar stopped syncing jobs.');
  assert.equal(calendar.action, 'send');
  assert.equal(calendar.topic, 'Calendar sync');
  assert.match(calendar.reply, /Settings → Google Calendar/);
  assert.match(calendar.reply, /Reconnect/);
  assert.equal(classifySupport('Where can I download my invoice PDF?').action, 'send');
  assert.equal(classifySupport('Please add a second admin.').topic, 'Add admin');
  assert.equal(classifySupport('Where is the booking link?').topic, 'Booking link');
  const refund = classifySupport('We need a refund for last month.');
  assert.equal(refund.action, 'escalate');
  assert.equal(refund.reason, 'money');
  assert.equal(refund.topic, 'Refund question');
  assert.equal(classifySupport('Bitte um eine Rückerstattung.').reason, 'money');
  assert.equal(classifySupport('Please change the invoice address.').reason, 'money');
  assert.equal(classifySupport('Can I get a discount because the trial is ending?').reason, 'money');
  const angry = classifySupport('This is ridiculous, the calendar stopped syncing.');
  assert.equal(angry.action, 'escalate');
  assert.equal(angry.reason, 'angry');
  assert.equal(classifySupport('Please help with a fictional setup.').reason, 'unknown');
  assert.equal(refund.operatorHint.includes(ESCALATION_TEMPLATE), true);
  for (const rule of PLAYBOOK_RULES) {
    const reply = typeof rule.reply === 'function' ? rule.reply('', {}) : rule.reply;
    assert.doesNotMatch(reply, /€\s?\d/);
    assert.doesNotMatch(reply, /discount of|I will refund|%\s*off/i);
  }
  assert.equal(berlinWeek(Date.parse('2026-10-29T08:00:00Z')).label, '26 Oct – 1 Nov 2026');
});

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'klarraum-director-ai-'));
  const deliveries = [];
  const now = options.now || (() => Date.parse('2026-10-29T08:00:00Z'));
  const config = {...directorConfig({DIRECTOR_PASSWORD_HASH:passwordHash, DIRECTOR_DATA_DIR:directory}), clock:now, operatorMailer:async message => { deliveries.push(message); return {sent:true}; }};
  const d = createDirector(config);
  await new Promise(resolve => d.server.listen(0, '127.0.0.1', resolve));
  const port = d.server.address().port;
  async function request(path, {host = 'director.localhost:3100', body, method = body ? 'POST' : 'GET', headers = {}} = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest({hostname:'127.0.0.1', port, path, method, headers:{Host:host, Origin:'http://' + host, 'Content-Type':'application/json', ...headers}}, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks), text = raw.toString();
          resolve({status:res.statusCode, data:res.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text, headers:res.headers});
        });
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  t.after(async () => { await d.close(); await rm(directory, {recursive:true, force:true}); });
  const login = await request('/api/director/login', {body:{password}});
  assert.equal(login.status, 200);
  const auth = {Cookie:login.headers['set-cookie'][0].split(';')[0], 'X-CSRF-Token':login.data.csrf};
  const post = (path, body, method = 'POST') => request('/api/director/' + path, {body, method, headers:auth});
  const get = path => request('/api/director/' + path, {headers:auth});
  async function create(name) {
    const created = await post('companies', {name, baseCents:7900, included:3, seatCents:500});
    assert.equal(created.status, 201);
    return created.data;
  }
  async function activate(item) {
    const url = new URL(item.inviteUrl);
    const token = new URLSearchParams(url.hash.slice(1)).get('token');
    const response = await request('/api/owner-setup', {host:url.host, body:{token, password}});
    assert.equal(response.status, 200);
    return url.host;
  }
  async function owner(host) {
    const response = await request('/api/admin/login', {host, body:{password}});
    assert.equal(response.status, 200, typeof response.data === 'string' ? response.data : JSON.stringify(response.data));
    return {Cookie:response.headers['set-cookie'][0].split(';')[0], 'X-CSRF-Token':response.data.csrf};
  }
  async function partner(host, ownerAuth, message) {
    return request('/api/platform-support', {host, headers:ownerAuth, body:{message}});
  }
  return {request, post, get, create, activate, owner, partner, auth, deliveries, d};
}

test('AI zone pages and settings stay off until the operator turns replies on', async t => {
  const f = await fixture(t);
  const page = await f.request('/director-ai.html');
  assert.equal(page.status, 200);
  assert.match(page.data, /KlarraumApp/);
  assert.equal(page.data.includes('KlarraumAppApp'), false);
  assert.match(page.data, /AI settings/);
  assert.match((await f.request('/director-ai.js')).data, /Weekly review/);
  const settings = await f.get('ai/settings');
  assert.equal(settings.status, 200);
  assert.deepEqual({enabled:settings.data.enabled, autoSend:settings.data.autoSend, weeklyReview:settings.data.weeklyReview}, {enabled:false, autoSend:false, weeklyReview:'Monday'});
  assert.equal((await f.request('/api/director/ai/settings', {body:{enabled:true}, headers:{Cookie:f.auth.Cookie}})).status, 403);
  assert.equal((await f.post('ai/settings', {enabled:true, autoSend:false}, 'PUT')).status, 400);
  const enabled = await f.post('ai/settings', {enabled:true}, 'PUT');
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.enabled, true);
  assert.equal(enabled.data.autoSend, true);
  const company = await f.create('CleanPro');
  const host = await f.activate(company);
  const owner = await f.owner(host);
  assert.equal((await f.request('/api/director/ai/settings', {headers:owner})).status, 401);
});

test('AI on sends a playbook reply; money, unknown, and angry messages escalate without a send', async t => {
  const f = await fixture(t);
  const company = await f.create('CleanPro');
  const host = await f.activate(company), owner = await f.owner(host);
  f.d.store.db.prepare('UPDATE companies SET trial_ends_at=? WHERE id=?').run(Date.now() + 2 * day, company.company.id);
  const held = await f.partner(host, owner, 'Our Google Calendar stopped syncing jobs.');
  assert.equal(held.status, 201);
  assert.equal(held.data.ai.action, 'off');
  assert.equal((await f.request('/api/platform-support', {host, headers:owner})).data.items.length, 1);
  assert.equal((await f.get('ai/log')).data.items.length, 0);
  assert.equal((await f.post('ai/settings', {enabled:true}, 'PUT')).status, 200);

  const sent = await f.partner(host, owner, 'Our Google Calendar stopped syncing jobs.');
  assert.equal(sent.data.ai.action, 'sent');
  assert.equal(sent.data.ai.topic, 'Calendar sync');
  const thread = await f.request('/api/platform-support', {host, headers:owner});
  const aiMessages = thread.data.items.filter(item => item.kind === 'ai');
  assert.equal(aiMessages.length, 1);
  assert.match(aiMessages[0].body, /Google Calendar/);
  assert.match(aiMessages[0].body, /Reconnect/);
  assert.doesNotMatch(aiMessages[0].body, /€\s?\d|discount of|refund of/i);

  const refund = await f.partner(host, owner, 'We need a refund for last month.');
  assert.equal(refund.data.ai.action, 'escalated');
  assert.equal(refund.data.ai.reason, 'money');
  assert.equal(refund.data.ai.emailSent, true);
  assert.equal(refund.data.ai.dueAt - refund.data.ai.createdAt, day);
  assert.equal(f.deliveries.length, 1);
  assert.match(f.deliveries[0].subject, /CleanPro/);
  assert.match(f.deliveries[0].text, /Thanks for writing/);
  assert.match(f.deliveries[0].text, /24 hours/);
  assert.doesNotMatch(f.deliveries[0].text, /€\s?\d/);
  const angry = await f.partner(host, owner, 'This is ridiculous, the calendar stopped syncing.');
  assert.equal(angry.data.ai.action, 'escalated');
  assert.equal(angry.data.ai.reason, 'angry');
  const unknown = await f.partner(host, owner, 'Please help with a fictional setup.');
  assert.equal(unknown.data.ai.reason, 'unknown');
  const invoice = await f.partner(host, owner, 'Where can I download my invoice PDF?');
  assert.equal(invoice.data.ai.action, 'sent');
  assert.equal(invoice.data.ai.topic, 'Invoice copy');
  const address = await f.partner(host, owner, 'Please change the invoice address.');
  assert.equal(address.data.ai.reason, 'money');
  const german = await f.partner(host, owner, 'Bitte um eine Rückerstattung.');
  assert.equal(german.data.ai.reason, 'money');
  const admin = await f.partner(host, owner, 'Please add a second admin.');
  assert.equal(admin.data.ai.action, 'sent');
  const after = await f.request('/api/platform-support', {host, headers:owner});
  assert.equal(after.data.items.filter(item => item.kind === 'ai').length, 3);
  assert.equal(after.data.items.some(item => item.kind === 'ai' && /refund/i.test(item.body)), false);

  const log = await f.get('ai/log');
  assert.equal(log.data.retentionMonths, 12);
  assert.equal(log.data.items.filter(item => item.aiReply === 'Sent').length, 3);
  assert.equal(log.data.items.filter(item => item.aiReply === 'Not sent').length, 5);
  assert.equal((await f.get('ai/log?filter=sent')).data.items.length, 3);
  assert.equal((await f.get('ai/log?filter=escalated')).data.items.every(item => item.status === 'escalated'), true);
  assert.equal((await f.get('ai/log?filter=week')).data.items.length, 8);
  assert.match((await f.get('ai/log?filter=sent')).data.items.find(item => item.topic === 'Calendar sync').timeLabel, /29 Oct/);

  const attention = await f.get('ai/attention');
  assert.equal(attention.data.badge, 'AI replies: ON · Auto');
  assert.equal(attention.data.handled.count, 3);
  assert.equal(attention.data.escalated.count, 5);
  assert.equal(attention.data.review.weekLabel, '26 Oct – 1 Nov 2026');
  assert.equal(attention.data.review.count, 3);
  assert.equal(attention.data.shell.trials.some(item => item.name === 'CleanPro'), true);
  assert.ok(Array.isArray(attention.data.shell.storage));

  const other = await f.create('Blitz GmbH');
  const otherHost = await f.activate(other), otherOwner = await f.owner(otherHost);
  assert.equal((await f.partner(otherHost, otherOwner, 'Where is the booking link?')).data.ai.topic, 'Booking link');
  const cleanPro = await f.get('ai/threads/' + company.company.id);
  assert.equal(cleanPro.data.messages.some(item => item.body.includes('Booking site')), false);
  assert.equal((await f.get('ai/log?filter=sent')).data.items.some(item => item.company === 'Blitz GmbH' && item.topic === 'Booking link'), true);

  const review = await f.get('ai/review');
  assert.equal(review.data.total, 4);
  assert.equal(review.data.reviewed, 0);
  const calendar = review.data.items.find(item => item.company === 'CleanPro' && item.topic === 'Calendar sync');
  const adminRow = review.data.items.find(item => item.topic === 'Add admin');
  assert.match(calendar.summary, /Google Calendar/);
  assert.equal((await f.post('ai/review/' + calendar.id, {action:'ok'})).status, 200);
  const flagged = await f.post('ai/review/' + adminRow.id, {action:'flag', note:'Invite steps need a clearer admin line.'});
  assert.equal(flagged.status, 200);
  assert.equal(flagged.data.reviewed, 2);
  assert.equal(flagged.data.complaints, 1);
  const open = flagged.data.items.find(item => item.id === adminRow.id);
  assert.equal(open.reviewState, 'flagged');
  assert.equal(flagged.data.items.find(item => item.topic === 'Invoice copy').reviewState, null);
  const partnerThread = await f.request('/api/platform-support', {host, headers:owner});
  const adminMessage = partnerThread.data.items.find(item => item.sender === 'company' && item.body.includes('second admin'));
  const answered = partnerThread.data.items.filter(item => item.sender === 'company' && item.body.includes('Google Calendar'));
  assert.equal(adminMessage.read_at, null);
  assert.ok(answered[1].read_at);
  assert.ok((await f.get('companies')).data.items.find(item => item.id === company.company.id).unreadSupport >= 1);
  const playbook = await f.get('ai/playbook');
  assert.equal(playbook.data.template, ESCALATION_TEMPLATE);
  assert.equal(playbook.data.notes.some(item => item.topic === 'Add admin' && item.note.includes('clearer admin')), true);
  assert.match(playbook.data.markdown, /director\/21/);
  assert.equal(playbook.data.rules.some(item => item.id === 'calendar-sync'), true);
  const finished = await f.post('ai/review/finish', {});
  assert.equal(finished.data.lastReviewLabel, '29 Oct 2026');
  const still = await f.get('ai/review');
  assert.equal(still.data.items.find(item => item.topic === 'Invoice copy').reviewState, null);
  assert.equal(still.data.items.find(item => item.id === calendar.id).reviewState, 'ok');

  const manual = await f.post('companies/' + company.company.id + '/support', {message:"Thanks for writing. We'll look into this and get back within 24 hours. — Klarraum Support"});
  assert.equal(manual.status, 201);
  assert.equal(manual.data.item.kind, 'manual');
  assert.equal((await f.get('ai/attention')).data.escalated.count, 0);
  const directorThread = await f.get('companies/' + company.company.id + '/support');
  assert.equal(directorThread.data.items.some(item => item.kind === 'ai'), true);
  assert.equal((await f.post('ai/review/' + (await f.get('ai/log?filter=escalated')).data.items[0].id, {action:'ok'})).status, 409);
});

test('AI log drops entries older than 12 months', async t => {
  let now = Date.parse('2025-01-10T08:00:00Z');
  const f = await fixture(t, {now:() => now});
  const company = await f.create('NordHaus');
  const host = await f.activate(company), owner = await f.owner(host);
  assert.equal((await f.post('ai/settings', {enabled:true}, 'PUT')).status, 200);
  assert.equal((await f.partner(host, owner, 'Our Google Calendar stopped syncing jobs.')).data.ai.action, 'sent');
  assert.equal((await f.get('ai/log')).data.items.length, 1);
  now = Date.parse('2026-10-29T08:00:00Z');
  assert.equal((await f.get('ai/log')).data.items.length, 0);
  assert.equal((await f.partner(host, owner, 'Please add a second admin.')).data.ai.topic, 'Add admin');
  const log = await f.get('ai/log');
  assert.equal(log.data.items.length, 1);
  assert.equal(log.data.items[0].topic, 'Add admin');
});
