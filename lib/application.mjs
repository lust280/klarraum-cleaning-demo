import { Store, STATUSES } from './store.mjs';
import { RateLimiter, digest, randomToken, formToken, validFormToken, verifyPassword } from './security.mjs';
import { HttpError, validateInquiry, checkedPricing } from './validation.mjs';
import { sendNotification, sendInquiryReceipt } from './mail.mjs';
import { defaultSite } from '../public/site.js';
import { checkedSite, checkedNote, referencedMedia } from './site-settings.mjs';
import { createMediaService } from './media.mjs';
import { createTeam } from './team.mjs';
import { createReporting } from './reporting.mjs';
import { operationalStatus } from './readiness.mjs';
import {googleAuthorizationUrl,googleRedirectUri,signGoogleState,readGoogleState,exchangeGoogleCode,googleConnection,saveGoogleConnection,clearGoogleConnection,syncGoogleJobs} from './google-calendar.mjs';
import {createClientBooking} from './client-booking.mjs';
import { createPartnerAdmin } from './partner-admin.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SESSION_MS = 8 * 3600000;
function checkedCustomDomain(value) {
  if(typeof value!=='string')throw new HttpError(400,'Enter a domain name or leave it blank.');
  const domain=value.trim().toLowerCase().replace(/\.$/,'');
  if(!domain)return '';
  if(domain.length>253||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)||domain==='klarraumapp.com'||domain.endsWith('.klarraumapp.com'))throw new HttpError(400,'Enter a valid domain that you own, without http://, https:// or a path.');
  return domain;
}
function json(res, status, data, extra = {}) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', ...extra});
  res.end(JSON.stringify(data));
}
async function readJson(req) {
  if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') throw new HttpError(415,'JSON erforderlich.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new HttpError(413,'Anfrage zu groß.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400,'Ungültiges JSON.'); }
}
export function createApplication(config, options = {}) {
  const store = new Store(config.dbPath);
  const savedPreferences=store.companyPreferences(null);
  if(savedPreferences?.timeZone)config.timeZone=savedPreferences.timeZone;
  if(savedPreferences?.currency)config.currency=savedPreferences.currency;
  store.initializeSite(defaultSite(config.business));
  // The hosted demo is fictional and temporary. Keep its public copy neutral and
  // English after a deployment instead of retaining the original German seed data.
  if (config.demoMode) store.resetDemoSite(defaultSite(config.business));
  store.bindAuth(digest(config.passwordHash + ':' + config.secret));
  const now = options.now || Date.now;
  const media=createMediaService(config,store,now);
  const limiter = new RateLimiter();
  const team=createTeam(config,store,{now,limiter,clientKey,checkOrigin,readJson,json,ownerSession:getSession,fetcher:options.fetcher||fetch});
  const partner=createPartnerAdmin({store,config,now});
  const reporting=createReporting(config,store,now);
  const sending = new Set();
  let closed = false;
  const pending = new Set();
  const cookieName = config.basePath ? 'klarraum_company_'+config.basePath.split('/').at(-1)+'_session' : config.secureCookie ? '__Host-klarraum_session' : 'klarraum_session';
  const cookie = (token, age) => `${cookieName}=${token}; Path=${config.basePath ? config.basePath+'/' : '/'}; HttpOnly; SameSite=Strict; Max-Age=${age}${config.secureCookie?'; Secure':''}`;
  store.cleanup(now(), config.retentionDays);
  async function notify(id) {
    if (closed || sending.has(id)) return;
    const row = store.get(id);
    if (!row || row.mail_status === 'sent' || row.mail_status === 'demo') return;
    sending.add(id);
    store.mailAttempt(id, now());
    try {
      await sendNotification(config.mail, row, config.origin, options.fetcher);
      if (!closed) store.mailResult(id, true);
      if (!closed && config.mail?.customerReceipt!==false && config.mail?.key && config.mail?.from) {
        try {
          const payload=JSON.parse(row.payload);
          if (payload.email && !payload.demo) await sendInquiryReceipt(config.mail, {...row, email:payload.email, name:payload.name}, config.business?.name||'', config.origin, options.fetcher);
        } catch { /* The owner notice is already recorded. A customer receipt stays optional. */ }
      }
    } catch (error) {
      if (!closed) store.mailResult(id, false, error?.code==='mail_not_configured'?'mail_not_configured':'delivery_failed');
    } finally { sending.delete(id); }
  }
  function schedule(id) {
    const task = notify(id).finally(() => pending.delete(task));
    pending.add(task);
  }
  const timer = setInterval(() => {
    if(options.isMaintenance?.())return;
    store.cleanup(now(), config.retentionDays);
    team.clean();
    const task=team.planning.flush(options.fetcher).finally(()=>pending.delete(task));pending.add(task);
    for (const row of store.pendingMail(now())) schedule(row.id);
  }, 60000);
  timer.unref();
  const clientApi = createClientBooking(config, store, {now, limiter, clientKey, checkOrigin, readJson, json, onInquiry: schedule, getPublicBooking: options.getPublicBooking || (() => partner.publicBooking())});
  function clientKey(req) {
    const ip = config.trustProxy ? (req.headers['x-forwarded-for'] || '').split(',').at(-1).trim() || req.socket.remoteAddress : req.socket.remoteAddress;
    return digest(`${config.secret}:${ip || 'unknown'}`);
  }
  function checkOrigin(req) {
    if (req.headers.origin !== config.origin) throw new HttpError(403,'Unzulässiger Ursprung. Bitte Seite neu laden.');
  }
  function getSession(req) {
    const cookies = (req.headers.cookie || '').split(';').map(x => x.trim());
    const value = cookies.find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(401,'Bitte anmelden.');
    const hash = digest(value), session = store.session(hash);
    if (!session || session.expires_at <= now()) throw new HttpError(401,'Sitzung abgelaufen. Bitte anmelden.');
    return {...session, hash};
  }
  async function googleCallback(res,url){
    if(!config.integrations?.googleCalendar)throw Object.assign(new Error('Google Calendar is not configured.'),{status:404});
    const expected=`${config.origin}${config.basePath||''}/admin.html`;
    const parsed=readGoogleState(config.secret,url.searchParams.get('state'),now());
    if(parsed.returnTo!==expected||parsed.companyId!==(config.companyId||'local'))throw Object.assign(new Error('Google Calendar returned an invalid state.'),{status:400});
    if(url.searchParams.get('error')){res.writeHead(302,{Location:expected+'?google=denied'});return res.end();}
    const code=url.searchParams.get('code');
    if(!code)throw Object.assign(new Error('Google Calendar did not return a code.'),{status:400});
    const tokens=await exchangeGoogleCode({clientId:config.google.clientId,clientSecret:config.google.clientSecret,code,redirectUri:googleRedirectUri(config.google,config.origin),fetchImpl:options.fetcher||fetch});
    saveGoogleConnection(store.db,{refreshToken:tokens.refresh_token,now:now()});
    res.writeHead(302,{Location:expected+'?google=connected'});res.end();
  }
  function portableData(){
    const blocked=new Set(['sessions','employee_sessions']);
    const tables=store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name).filter(name=>/^[a-z_]+$/.test(name)&&!blocked.has(name));
    const sensitive=/password|secret|token|csrf|hash/i,records={};for(const table of tables)records[table]=store.db.prepare('SELECT * FROM '+table).all().map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!sensitive.test(key))));
    return {format:'klarraum-company-export-v1',generatedAt:new Date(now()).toISOString(),notice:'This export contains company data. Keep it private and encrypted.',records};
  }
  async function handle(req, res, url) {
    try {
      const path = url.pathname, method = req.method;
      if (path.startsWith('/api/client/')) return await clientApi.handlePublic(req, res, url);
      if(path==='/api/admin/google-session'&&method==='POST'){
        const token=(await readJson(req))?.token;
        if(typeof token!=='string'||!/^[\w-]{43}$/.test(token))throw Object.assign(new Error('Google sign-in link is invalid.'),{status:400});
        if(!limiter.allow('google-session:'+clientKey(req),8,900000,now()))throw Object.assign(new Error('Too many sign-in attempts.'),{status:429});
        store.db.exec('CREATE TABLE IF NOT EXISTS google_owner_login(id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)');
        const row=store.db.prepare('SELECT token_hash,expires_at FROM google_owner_login WHERE id=1').get();
        if(!row||row.expires_at<=now()||row.token_hash!==digest(token))throw Object.assign(new Error('Google sign-in link expired. Choose the plan and continue with Google again.'),{status:400});
        store.db.prepare('DELETE FROM google_owner_login WHERE id=1').run();
        const sessionToken=randomToken(),csrf=randomToken();
        store.createSession(digest(sessionToken),csrf,now()+SESSION_MS);
        return json(res,200,{csrf},{'Set-Cookie':cookie(sessionToken,SESSION_MS/1000)});
      }
      if(path.startsWith('/api/partner/')||path==='/api/partner')return await partner.handle(req,res,url,{json,readJson,checkOrigin,limiter,clientKey});
      if(path.startsWith('/api/employee/'))return await team.worker(req,res,url);
      if(path==='/api/google/calendar/callback'&&method==='GET')return await googleCallback(res,url);
      if (path === '/healthz' && method === 'GET') {
        store.db.prepare('SELECT 1').get();
        return json(res,200,{ok:true});
      }
      if (path === '/api/config' && method === 'GET') {
        const partnerBooking = options.getPublicBooking?.() || partner.publicBooking();
        const body = {
          live:config.live, demoMode:Boolean(config.demoMode), business:config.business, legalReady:config.legalReady,
          retentionDays:config.retentionDays, pricing:store.pricing(), site:store.site().content,timeZone:config.timeZone,currency:config.currency,
        };
        if (partnerBooking && partnerBooking.bookingMode) { body.partnerBooking = partnerBooking; body.bookingMode = partnerBooking.bookingMode; }
        return json(res,200,body);
      }
      if (path === '/api/form-token' && method === 'GET') {
        if (!config.live && !config.demoMode) throw new HttpError(503,'Demo: Anfragen sind noch nicht freigeschaltet.');
        if (!limiter.allow('token:'+clientKey(req),60,60000,now())) throw new HttpError(429,'Zu viele Versuche. Bitte später erneut versuchen.');
        return json(res,200,{token:formToken(config.secret,now())});
      }
      if (['/api/inquiries','/api/demo/inquiries'].includes(path) && method === 'POST') {
        checkOrigin(req);
        const demo = path === '/api/demo/inquiries';
        if (demo ? !config.demoMode : !config.live) throw new HttpError(503,'Dieser Anfragemodus ist nicht freigeschaltet.');
        if (!limiter.allow('submit:'+clientKey(req),30,3600000,now())) throw new HttpError(429,'Zu viele Anfragen. Bitte später erneut versuchen.');
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400,'Ungültige Anfrage.');
        if (body.website || !validFormToken(body.token,config.secret,now())) throw new HttpError(400,'Bitte Seite neu laden und Eingaben prüfen.');
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !UUID.test(key)) throw new HttpError(400,'Ungültige Anfragenummer. Bitte Seite neu laden.');
        if (demo && Object.keys(body).some(key=>!['service','area','frequency','windows','tipPercent','token','website','privacy'].includes(key))) throw new HttpError(400,'Testanfragen dürfen keine Kontaktdaten enthalten.');
        const site=store.site().content;
        const booking={enabled:true,dateEnabled:true,timeEnabled:true,...(site.booking||{})};
        if(!booking.enabled)throw new HttpError(503,'Online inquiries are currently paused by this company.');
        if(!Object.hasOwn(site.services,body.service)||!site.services[body.service].enabled)throw new HttpError(400,'Diese Leistung ist derzeit nicht verfügbar. Bitte Seite neu laden.');
        if(body.windows===true&&!site.windowsEnabled)throw new HttpError(400,'Fensterreinigung ist derzeit nicht verfügbar.');
        if(body.tipPercent&&site.tipEnabled===false)throw new HttpError(400,'Trinkgeld ist derzeit nicht verfügbar.');
        const submittedBody = demo ? {
          service:body.service,area:body.area,frequency:body.frequency,windows:body.windows,tipPercent:body.tipPercent,privacy:body.privacy,
          name:'Demo customer',email:'demo@example.invalid',phone:'',postcode:'10001',
          address:'Musterstraße 1 (fiktiv)',message:'Automatisch erzeugte Testanfrage. Keine echten Kontaktdaten.',date:'',preferredTime:'',
        } : {...body,date:booking.dateEnabled?body.date:'',preferredTime:booking.timeEnabled?body.preferredTime:''};
        const payload = validateInquiry(submittedBody,store.pricing(),demo?{postcodes:[]}:config.business,now(),config.timeZone);
        payload.serviceTitle=site.services[body.service].title;
        if(demo)payload.demo=true;
        const {price: calculatedPrice, serviceTitle: currentTitle, ...submitted} = payload;
        const fingerprint = digest(JSON.stringify(submitted));
        const existing = store.byKey(key);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new HttpError(409,'Diese Anfrage wurde bereits mit anderen Angaben gespeichert. Bitte Seite neu laden.');
          team.captureInquiry(existing);
          return json(res,200,{id:existing.id,price:JSON.parse(existing.payload).price,saved:true,demo});
        }
        if (!limiter.allow('inquiry:'+clientKey(req),5,3600000,now())) throw new HttpError(429,'Zu viele Anfragen. Bitte später erneut versuchen.');
        const row = store.add(key,fingerprint,payload,now());
        team.captureInquiry(row);
        if(!demo)schedule(row.id);
        return json(res,201,{id:row.id,price:payload.price,saved:true,demo});
      }
      if (path === '/api/admin/login' && method === 'POST') {
        checkOrigin(req);
        if (!config.passwordHash) throw new HttpError(503,'Administratorzugang noch nicht eingerichtet.');
        if (!limiter.allow('login-attempt:'+clientKey(req),12,300000,now()) || !limiter.allow('login-global',120,300000,now())) throw new HttpError(429,'Too many sign-in attempts. Please wait 5 minutes and try again.');
        const body = await readJson(req);
        if (!await verifyPassword(body?.password,config.passwordHash)) {
          if(!limiter.allow('login-failed:'+clientKey(req),8,300000,now())) throw new HttpError(429,'Too many incorrect passwords. Please wait 5 minutes and try again.');
          throw new HttpError(401,'Incorrect password. Please try again.');
        }
        const token = randomToken(), csrf = randomToken();
        store.createSession(digest(token),csrf,now()+SESSION_MS);
        return json(res,200,{csrf}, {'Set-Cookie':cookie(token,SESSION_MS/1000)});
      }
      if (path.startsWith('/api/admin/')) {
        const session = getSession(req);
        if (!['GET','HEAD'].includes(method)) {
          checkOrigin(req);
          if (req.headers['x-csrf-token'] !== session.csrf) throw new HttpError(403,'Sicherheitsprüfung fehlgeschlagen. Bitte neu anmelden.');
        }
        if (path.startsWith('/api/admin/client-')) return await clientApi.handleAdmin(req, res, url);
        if(path.startsWith('/api/admin/reports')||path.startsWith('/api/admin/payments')||path.startsWith('/api/admin/finance/'))return await reporting.handle(req,res,url,{readJson,json});
        if(/^\/api\/admin\/(employees|jobs|customers|properties|calendar|series|schedule-check|ops|inbox)(\/|$)/.test(path))return await team.owner(req,res,url);
        if(path==='/api/admin/system-status'&&method==='GET')return json(res,200,await operationalStatus(config,store,now()));
        if (path === '/api/admin/session' && method === 'GET') return json(res,200,{csrf:session.csrf,live:config.live,demoMode:Boolean(config.demoMode),timeZone:config.timeZone,currency:config.currency,integrations:config.integrations||{stripe:false,googleCalendar:false}});
        if(path==='/api/admin/google-calendar'&&method==='GET')return json(res,200,config.integrations?.googleCalendar?{enabled:true,...googleConnection(store.db)}:{enabled:false,connected:false,email:''});
        if(path==='/api/admin/google-calendar/connect'&&method==='POST'){await readJson(req);if(!config.integrations?.googleCalendar)throw Object.assign(new Error('Google Calendar is not configured.'),{status:404});const returnTo=`${config.origin}${config.basePath||''}/admin.html`;const state=signGoogleState(config.secret,{companyId:config.companyId||'local',returnTo,now:now()});return json(res,200,{url:googleAuthorizationUrl({clientId:config.google.clientId,redirectUri:googleRedirectUri(config.google,config.origin),state})});}
        if(path==='/api/admin/google-calendar/disconnect'&&method==='POST'){if(!config.integrations?.googleCalendar)throw Object.assign(new Error('Google Calendar is not configured.'),{status:404});clearGoogleConnection(store.db);return json(res,200,{connected:false});}
        if(path==='/api/admin/google-calendar/sync'&&method==='POST'){if(!config.integrations?.googleCalendar)throw Object.assign(new Error('Google Calendar is not configured.'),{status:404});return json(res,200,await syncGoogleJobs({db:store.db,clientId:config.google.clientId,clientSecret:config.google.clientSecret,timeZone:config.timeZone,fetchImpl:options.fetcher||fetch,now:now()}));}
        if (path === '/api/admin/data-export' && method === 'GET') {const value=JSON.stringify(portableData());res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename=\"klarraum-company-data-'+new Date(now()).toISOString().slice(0,10)+'.json\"','Cache-Control':'no-store'});return res.end(value);}
        if (path === '/api/admin/logout' && method === 'POST') {
          store.endSession(session.hash);
          return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});
        }
        if (path === '/api/admin/settings' && method === 'GET') return json(res,200,{pricing:store.pricing()});
        if (path === '/api/admin/company-preferences' && method === 'GET') {
          const preferences=store.companyPreferences({});
          return json(res,200,{timeZone:config.timeZone,currency:config.currency,customDomain:preferences.customDomain||'',domainStatus:preferences.customDomain?'pending-hosting':'not-requested',locked:Boolean(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get()&&store.db.prepare('SELECT 1 FROM jobs LIMIT 1').get()),setupComplete:preferences.setupComplete===true});
        }
        if (path === '/api/admin/company-preferences' && method === 'PUT') {
          const body=await readJson(req),zones=new Set(['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','America/Toronto','Europe/London','Europe/Berlin','Australia/Sydney']);
          if(!zones.has(body?.timeZone)||!['USD','EUR','GBP','CAD','AUD'].includes(body?.currency))throw new HttpError(400,'Choose a supported time zone and currency.');
          const customDomain=checkedCustomDomain(body?.customDomain);
          const locked=Boolean(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get()&&store.db.prepare('SELECT 1 FROM jobs LIMIT 1').get());
          if(locked&&body.timeZone!==config.timeZone)throw new HttpError(409,'Time zone cannot be changed after jobs exist. Contact platform support for a safe migration.');
          config.timeZone=body.timeZone;config.currency=body.currency;const previous=store.companyPreferences({});store.setCompanyPreferences({timeZone:config.timeZone,currency:config.currency,customDomain,setupComplete:previous.setupComplete===true});
          return json(res,200,{timeZone:config.timeZone,currency:config.currency,customDomain,domainStatus:customDomain?'pending-hosting':'not-requested',locked,setupComplete:previous.setupComplete===true});
        }
        if (path === '/api/admin/company-setup' && method === 'POST') {
          const body=await readJson(req),zones=new Set(['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','America/Toronto','Europe/London','Europe/Berlin','Australia/Sydney']);
          const previous=store.companyPreferences({});
          if(body?.skip===true){store.setCompanyPreferences({...previous,timeZone:config.timeZone,currency:config.currency,setupComplete:true});return json(res,200,{setupComplete:true,timeZone:config.timeZone,currency:config.currency});}
          if(!zones.has(body?.timeZone)||!['USD','EUR','GBP','CAD','AUD'].includes(body?.currency))throw new HttpError(400,'Choose a supported time zone and currency.');
          const city=typeof body.city==='string'?body.city.trim():'';
          const phone=typeof body.phone==='string'?body.phone.trim():'';
          const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
          if(!city||city.length>100||/[\x00-\x1f\x7f]/.test(city))throw new HttpError(400,'Add the city or area you serve.');
          if(phone.length>40||/[\x00-\x1f\x7f]/.test(phone))throw new HttpError(400,'Phone is too long.');
          if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Enter a valid contact email or leave it blank.');
          const current=store.site();
          const content=checkedSite({...current.content,company:{...current.content.company,area:city,phone,email:email||current.content.company.email}});
          if(!store.setSite(current.version,content))throw new HttpError(409,'The website changed while you were saving. Open it once and try again.');
          const locked=Boolean(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get()&&store.db.prepare('SELECT 1 FROM jobs LIMIT 1').get());
          if(!locked){config.timeZone=body.timeZone;config.currency=body.currency;}
          store.setCompanyPreferences({...previous,timeZone:config.timeZone,currency:config.currency,customDomain:previous.customDomain||'',setupComplete:true});
          return json(res,200,{setupComplete:true,timeZone:config.timeZone,currency:config.currency,city});
        }
        if (path === '/api/admin/summary' && method === 'GET') return json(res,200,store.summary());
        if (path === '/api/admin/site' && method === 'GET') return json(res,200,store.site());
        if (path === '/api/admin/media' && method === 'GET') return json(res,200,{items:media.list()});
        if (path === '/api/admin/media' && method === 'POST') {
          if(!limiter.allow('upload:'+session.hash,15,60000,now()))throw new HttpError(429,'Zu viele Uploads. Bitte später erneut versuchen.');
          return json(res,201,await media.upload(req,url.searchParams.get('kind')));
        }
        const mediaMatch=path.match(/^\/api\/admin\/media\/([a-f0-9-]{36})$/i);
        if(mediaMatch&&method==='DELETE'){await media.remove(mediaMatch[1]);return json(res,200,{ok:true});}
        if (path === '/api/admin/site' && method === 'PUT') {
          const body=await readJson(req);
          if(!Number.isInteger(body?.version)||body.version<1)throw new HttpError(400,'Ungültige Einstellungs-Version.');
          const content=checkedSite(body.content);
          if(referencedMedia(content).some(id=>!store.media(id)))throw new HttpError(400,'Ein ausgewähltes Bild fehlt. Bitte neu hochladen oder aus der Auswahl entfernen.');
          if(!store.setSite(body.version,content))throw new HttpError(409,'Die Website wurde inzwischen geändert. Laden Sie die Einstellungen neu; Ihre Eingaben bleiben bis dahin im Formular.');
          return json(res,200,store.site());
        }
        if (path === '/api/admin/settings' && method === 'PUT') {
          store.setPricing(checkedPricing(await readJson(req)));
          return json(res,200,{ok:true});
        }
        if (path === '/api/admin/inquiries' && method === 'GET') {
          const status = url.searchParams.get('status') || '';
          const offset = Number(url.searchParams.get('offset') || 0);
          if ((status && !STATUSES.includes(status)) || !Number.isInteger(offset) || offset<0 || offset>100000) throw new HttpError(400,'Ungültiger Filter.');
          return json(res,200,store.list(status,offset));
        }
        const match = path.match(/^\/api\/admin\/inquiries\/([a-f0-9-]{36})(\/retry-mail|\/note)?$/i);
        if (match && UUID.test(match[1])) {
          const id = match[1];
          if (!store.get(id)) throw new HttpError(404,'Anfrage nicht gefunden.');
          if(!match[2]&&method==='GET')return json(res,200,store.publicRow(store.get(id)));
          if (match[2] === '/note' && method === 'PUT') {
            const body=await readJson(req);store.setNote(id,checkedNote(body?.note));return json(res,200,{ok:true});
          }
          if (match[2] === '/retry-mail' && method === 'POST') {
            if(JSON.parse(store.get(id).payload).demo)throw new HttpError(400,'Für Testanfragen werden keine E-Mails versendet.');
            if (!limiter.allow('retry:'+session.hash,10,60000,now())) throw new HttpError(429,'Bitte später erneut versuchen.');
            store.resetMail(id); schedule(id);
            return json(res,200,{ok:true});
          }
          if (!match[2] && method === 'PATCH') {
            const body = await readJson(req);
            if (!STATUSES.includes(body?.status)) throw new HttpError(400,'Ungültiger Status.');
            store.setStatus(id,body.status);
            return json(res,200,{ok:true});
          }
          if (!match[2] && method === 'DELETE') {
            store.remove(id);
            return json(res,200,{ok:true});
          }
        }
      }
      throw new HttpError(404,'Nicht gefunden.');
    } catch (error) {
      const payload={error:error.status?error.message:'Technischer Fehler. Bitte später erneut versuchen.'};if(error.code)payload.code=error.code;return json(res,error.status || 500,payload);
    }
  }
  return {handle,serveMedia:media.serve,serveJobPhoto:team.servePhoto,store,tick:()=>team.planning.flush(options.fetcher),drain:() => Promise.allSettled([...pending]),close() {closed=true;clearInterval(timer);team.planning.closed=true;store.close();}};
}
