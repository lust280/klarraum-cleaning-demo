import { Store, STATUSES } from './store.mjs';
import { RateLimiter, digest, randomToken, formToken, validFormToken, verifyPassword } from './security.mjs';
import { HttpError, validateInquiry, checkedPricing } from './validation.mjs';
import { sendNotification } from './mail.mjs';
import { defaultSite } from '../public/site.js';
import { checkedSite, checkedNote, referencedMedia } from './site-settings.mjs';
import { createMediaService } from './media.mjs';
import { createTeam } from './team.mjs';
import { createReporting } from './reporting.mjs';
import { operationalStatus } from './readiness.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SESSION_MS = 8 * 3600000;
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
  if(savedPreferences){config.timeZone=savedPreferences.timeZone;config.currency=savedPreferences.currency;}
  store.initializeSite(defaultSite(config.business));
  // The hosted demo is fictional and temporary. Keep its public copy neutral and
  // English after a deployment instead of retaining the original German seed data.
  if (config.demoMode) store.resetDemoSite(defaultSite(config.business));
  store.bindAuth(digest(config.passwordHash + ':' + config.secret));
  const now = options.now || Date.now;
  const media=createMediaService(config,store,now);
  const limiter = new RateLimiter();
  const team=createTeam(config,store,{now,limiter,clientKey,checkOrigin,readJson,json,ownerSession:getSession});
  const reporting=createReporting(config,store,now);
  const sending = new Set();
  let closed = false;
  const pending = new Set();
  const cookieName = config.basePath ? 'klarraum_company_'+config.basePath.split('/').at(-1)+'_session' : config.secureCookie ? '__Host-klarraum_session' : 'klarraum_session';
  const cookie = (token, age) => `${cookieName}=${token}; Path=${config.basePath ? config.basePath+'/' : '/'}; HttpOnly; SameSite=Strict; Max-Age=${age}${config.secureCookie?'; Secure':''}`;
  store.cleanup(now(), config.retentionDays);
  async function notify(id) {
    if (closed || sending.has(id) || !config.mail.key) return;
    const row = store.get(id);
    if (!row || row.mail_status === 'sent') return;
    sending.add(id);
    store.mailAttempt(id, now());
    try {
      await sendNotification(config.mail, row, config.origin, options.fetcher);
      if (!closed) store.mailResult(id, true);
    } catch {
      if (!closed) store.mailResult(id, false);
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
  async function handle(req, res, url) {
    try {
      const path = url.pathname, method = req.method;
      if(path.startsWith('/api/employee/'))return await team.worker(req,res,url);
      if (path === '/healthz' && method === 'GET') {
        store.db.prepare('SELECT 1').get();
        return json(res,200,{ok:true});
      }
      if (path === '/api/config' && method === 'GET') return json(res,200,{
        live:config.live, demoMode:Boolean(config.demoMode), business:config.business, legalReady:config.legalReady,
        retentionDays:config.retentionDays, pricing:store.pricing(), site:store.site().content,timeZone:config.timeZone,currency:config.currency,
      });
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
        if (demo && Object.keys(body).some(key=>!['service','area','frequency','windows','token','website','privacy'].includes(key))) throw new HttpError(400,'Testanfragen dürfen keine Kontaktdaten enthalten.');
        const site=store.site().content;
        if(!Object.hasOwn(site.services,body.service)||!site.services[body.service].enabled)throw new HttpError(400,'Diese Leistung ist derzeit nicht verfügbar. Bitte Seite neu laden.');
        if(body.windows===true&&!site.windowsEnabled)throw new HttpError(400,'Fensterreinigung ist derzeit nicht verfügbar.');
        const submittedBody = demo ? {
          service:body.service,area:body.area,frequency:body.frequency,windows:body.windows,privacy:body.privacy,
          name:'Demo customer',email:'demo@example.invalid',phone:'',postcode:'10001',
          address:'Musterstraße 1 (fiktiv)',message:'Automatisch erzeugte Testanfrage. Keine echten Kontaktdaten.',date:'',
        } : body;
        const payload = validateInquiry(submittedBody,store.pricing(),demo?{postcodes:[]}:config.business,now(),config.timeZone);
        payload.serviceTitle=site.services[body.service].title;
        if(demo)payload.demo=true;
        const {price: calculatedPrice, serviceTitle: currentTitle, ...submitted} = payload;
        const fingerprint = digest(JSON.stringify(submitted));
        const existing = store.byKey(key);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new HttpError(409,'Diese Anfrage wurde bereits mit anderen Angaben gespeichert. Bitte Seite neu laden.');
          return json(res,200,{id:existing.id,price:JSON.parse(existing.payload).price,saved:true,demo});
        }
        if (!limiter.allow('inquiry:'+clientKey(req),5,3600000,now())) throw new HttpError(429,'Zu viele Anfragen. Bitte später erneut versuchen.');
        const row = store.add(key,fingerprint,payload,now());
        if(!demo)schedule(row.id);
        return json(res,201,{id:row.id,price:payload.price,saved:true,demo});
      }
      if (path === '/api/admin/login' && method === 'POST') {
        checkOrigin(req);
        if (!config.passwordHash) throw new HttpError(503,'Administratorzugang noch nicht eingerichtet.');
        if (!limiter.allow('login:'+clientKey(req),5,900000,now()) || !limiter.allow('login-global',60,900000,now())) throw new HttpError(429,'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.');
        const body = await readJson(req);
        if (!await verifyPassword(body?.password,config.passwordHash)) throw new HttpError(401,'Anmeldung fehlgeschlagen.');
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
        if(path.startsWith('/api/admin/reports')||path.startsWith('/api/admin/payments')||path.startsWith('/api/admin/finance/'))return await reporting.handle(req,res,url,{readJson,json});
        if(/^\/api\/admin\/(employees|jobs|customers|properties|calendar|series|schedule-check)(\/|$)/.test(path))return await team.owner(req,res,url);
        if(path==='/api/admin/system-status'&&method==='GET')return json(res,200,await operationalStatus(config,store,now()));
        if (path === '/api/admin/session' && method === 'GET') return json(res,200,{csrf:session.csrf,live:config.live,demoMode:Boolean(config.demoMode),timeZone:config.timeZone,currency:config.currency});
        if (path === '/api/admin/logout' && method === 'POST') {
          store.endSession(session.hash);
          return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});
        }
        if (path === '/api/admin/settings' && method === 'GET') return json(res,200,{pricing:store.pricing()});
        if (path === '/api/admin/company-preferences' && method === 'GET') return json(res,200,{timeZone:config.timeZone,currency:config.currency,locked:Boolean(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get()&&store.db.prepare('SELECT 1 FROM jobs LIMIT 1').get())});
        if (path === '/api/admin/company-preferences' && method === 'PUT') {
          const body=await readJson(req),zones=new Set(['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','America/Toronto','Europe/London','Europe/Berlin','Australia/Sydney']);
          if(!zones.has(body?.timeZone)||!['USD','EUR','GBP','CAD','AUD'].includes(body?.currency))throw new HttpError(400,'Choose a supported time zone and currency.');
          const locked=Boolean(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get()&&store.db.prepare('SELECT 1 FROM jobs LIMIT 1').get());
          if(locked&&body.timeZone!==config.timeZone)throw new HttpError(409,'Time zone cannot be changed after jobs exist. Contact platform support for a safe migration.');
          config.timeZone=body.timeZone;config.currency=body.currency;store.setCompanyPreferences({timeZone:config.timeZone,currency:config.currency});
          return json(res,200,{timeZone:config.timeZone,currency:config.currency,locked});
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
      return json(res,error.status || 500,{error:error.status?error.message:'Technischer Fehler. Bitte später erneut versuchen.'});
    }
  }
  return {handle,serveMedia:media.serve,serveJobPhoto:team.servePhoto,store,tick:()=>team.planning.flush(options.fetcher),drain:() => Promise.allSettled([...pending]),close() {closed=true;clearInterval(timer);team.planning.closed=true;store.close();}};
}
