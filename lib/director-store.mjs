import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {randomToken,digest} from './security.mjs';
import {normalizeSalesCurrency,salesTimeZone} from './plans.mjs';

const TRIAL_MS=5*24*60*60*1000;
const PUBLIC_PLANS=new Set(['starter','pro','plus']);
function publicPlanKey(key,fallback='pro'){return PUBLIC_PLANS.has(key)?key:fallback;}

export class DirectorStore {
  constructor(path) {
    mkdirSync(dirname(path), {recursive:true,mode:0o700});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',payment TEXT NOT NULL DEFAULT 'trial',base_cents INTEGER NOT NULL,included INTEGER NOT NULL,seat_cents INTEGER NOT NULL,secret TEXT NOT NULL,password_hash TEXT,invite_hash TEXT UNIQUE,invite_expires INTEGER,created_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,company_name TEXT NOT NULL,owner_name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',country TEXT NOT NULL DEFAULT '',language TEXT NOT NULL DEFAULT 'en',workers INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'new',founding_offer INTEGER NOT NULL DEFAULT 0,company_id TEXT UNIQUE,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS trial_signups(id TEXT PRIMARY KEY,company_name TEXT NOT NULL,owner_name TEXT NOT NULL,email TEXT NOT NULL,language TEXT NOT NULL DEFAULT 'en',token_hash TEXT UNIQUE NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending_email',founding_offer INTEGER NOT NULL DEFAULT 0,company_id TEXT UNIQUE,created_at INTEGER NOT NULL,activated_at INTEGER);
      CREATE TABLE IF NOT EXISTS director_sessions(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS director_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS director_events(id INTEGER PRIMARY KEY,company_id TEXT,action TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS support_messages(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,sender TEXT NOT NULL CHECK(sender IN ('company','director')),body TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,kind TEXT NOT NULL DEFAULT 'manual');`);
    if(!this.db.prepare('PRAGMA table_info(support_messages)').all().some(x=>x.name==='kind'))this.db.exec("ALTER TABLE support_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual'");
    if(!this.db.prepare('PRAGMA table_info(companies)').all().some(x=>x.name==='initialized_at'))this.db.exec('ALTER TABLE companies ADD COLUMN initialized_at INTEGER');
    if(!this.db.prepare('PRAGMA table_info(companies)').all().some(x=>x.name==='trial_ends_at'))this.db.exec('ALTER TABLE companies ADD COLUMN trial_ends_at INTEGER');
    if(!this.db.prepare('PRAGMA table_info(companies)').all().some(x=>x.name==='time_zone'))this.db.exec("ALTER TABLE companies ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Europe/Berlin'");
    if(!this.db.prepare('PRAGMA table_info(companies)').all().some(x=>x.name==='currency'))this.db.exec("ALTER TABLE companies ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR'");
    if(!this.db.prepare('PRAGMA table_info(companies)').all().some(x=>x.name==='payment_due_at'))this.db.exec('ALTER TABLE companies ADD COLUMN payment_due_at INTEGER');
    if(!this.db.prepare('PRAGMA table_info(companies)').all().some(x=>x.name==='last_paid_at'))this.db.exec('ALTER TABLE companies ADD COLUMN last_paid_at INTEGER');
    if(!this.db.prepare('PRAGMA table_info(companies)').all().some(x=>x.name==='plan_key'))this.db.exec("ALTER TABLE companies ADD COLUMN plan_key TEXT NOT NULL DEFAULT 'custom'");
    if(!this.db.prepare('PRAGMA table_info(trial_signups)').all().some(x=>x.name==='plan_key'))this.db.exec("ALTER TABLE trial_signups ADD COLUMN plan_key TEXT NOT NULL DEFAULT 'solo'");
    if(!this.db.prepare('PRAGMA table_info(applications)').all().some(x=>x.name==='plan_key'))this.db.exec("ALTER TABLE applications ADD COLUMN plan_key TEXT NOT NULL DEFAULT 'custom'");
    if(!this.db.prepare('PRAGMA table_info(trial_signups)').all().some(x=>x.name==='founding_offer'))this.db.exec('ALTER TABLE trial_signups ADD COLUMN founding_offer INTEGER NOT NULL DEFAULT 0');
    if(!this.db.prepare('PRAGMA table_info(applications)').all().some(x=>x.name==='consent_version'))this.db.exec("ALTER TABLE applications ADD COLUMN consent_version TEXT NOT NULL DEFAULT 'legacy'");
    if(!this.db.prepare('PRAGMA table_info(applications)').all().some(x=>x.name==='consent_at'))this.db.exec('ALTER TABLE applications ADD COLUMN consent_at INTEGER');
    if(!this.db.prepare('PRAGMA table_info(trial_signups)').all().some(x=>x.name==='consent_version'))this.db.exec("ALTER TABLE trial_signups ADD COLUMN consent_version TEXT NOT NULL DEFAULT 'legacy'");
    if(!this.db.prepare('PRAGMA table_info(trial_signups)').all().some(x=>x.name==='consent_at'))this.db.exec('ALTER TABLE trial_signups ADD COLUMN consent_at INTEGER');
    if(!this.db.prepare('PRAGMA table_info(trial_signups)').all().some(x=>x.name==='currency'))this.db.exec("ALTER TABLE trial_signups ADD COLUMN currency TEXT NOT NULL DEFAULT ''");
    if(!this.db.prepare('PRAGMA table_info(applications)').all().some(x=>x.name==='currency'))this.db.exec("ALTER TABLE applications ADD COLUMN currency TEXT NOT NULL DEFAULT ''");
    const companyColumn=name=>this.db.prepare('PRAGMA table_info(companies)').all().some(x=>x.name===name);
    if(!companyColumn('contact_email'))this.db.exec("ALTER TABLE companies ADD COLUMN contact_email TEXT NOT NULL DEFAULT ''");
    if(!companyColumn('contact_phone'))this.db.exec("ALTER TABLE companies ADD COLUMN contact_phone TEXT NOT NULL DEFAULT ''");
    if(!companyColumn('legal_owner'))this.db.exec("ALTER TABLE companies ADD COLUMN legal_owner TEXT NOT NULL DEFAULT ''");
    if(!companyColumn('legal_address'))this.db.exec("ALTER TABLE companies ADD COLUMN legal_address TEXT NOT NULL DEFAULT ''");
    if(!companyColumn('price_note'))this.db.exec("ALTER TABLE companies ADD COLUMN price_note TEXT NOT NULL DEFAULT ''");
    if(!companyColumn('privacy_details'))this.db.exec("ALTER TABLE companies ADD COLUMN privacy_details TEXT NOT NULL DEFAULT ''");
    if(!companyColumn('legal_extra'))this.db.exec("ALTER TABLE companies ADD COLUMN legal_extra TEXT NOT NULL DEFAULT ''");
    if(!companyColumn('service_postcodes'))this.db.exec("ALTER TABLE companies ADD COLUMN service_postcodes TEXT NOT NULL DEFAULT ''");
    if(!companyColumn('legal_reviewed'))this.db.exec('ALTER TABLE companies ADD COLUMN legal_reviewed INTEGER NOT NULL DEFAULT 0');
    if(!companyColumn('inquiries_enabled'))this.db.exec('ALTER TABLE companies ADD COLUMN inquiries_enabled INTEGER');
    if(!companyColumn('google_sub'))this.db.exec('ALTER TABLE companies ADD COLUMN google_sub TEXT');
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS companies_google_sub ON companies(google_sub) WHERE google_sub IS NOT NULL AND google_sub<>''");
  }
  bindAuth(hash) {
    const old=this.db.prepare("SELECT value FROM director_meta WHERE key='auth'").get();
    if(old?.value!==hash) {
      this.db.exec('DELETE FROM director_sessions');
      this.db.prepare("INSERT INTO director_meta VALUES('auth',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(hash);
    }
  }
  event(id,action,details={}) {this.db.prepare('INSERT INTO director_events(company_id,action,details,created_at) VALUES(?,?,?,?)').run(id,action,JSON.stringify(details),Date.now());}
  support(companyId){return this.db.prepare('SELECT id,sender,body,created_at,read_at,kind FROM support_messages WHERE company_id=? ORDER BY created_at,id').all(companyId);}
  supportCounts(){return new Map(this.db.prepare("SELECT company_id,COUNT(*) AS unread FROM support_messages WHERE sender='company' AND read_at IS NULL GROUP BY company_id").all().map(row=>[row.company_id,row.unread]));}
  supportUnread(companyId,sender){return this.db.prepare('SELECT COUNT(*) AS unread FROM support_messages WHERE company_id=? AND sender=? AND read_at IS NULL').get(companyId,sender).unread;}
  addSupport(companyId,sender,body,kind='manual'){const id=randomUUID(),now=Date.now();if(kind!=='manual'&&kind!=='ai'){const e=new Error('Invalid support message.');e.status=400;throw e;}this.db.prepare('INSERT INTO support_messages(id,company_id,sender,body,created_at,read_at,kind) VALUES(?,?,?,?,?,NULL,?)').run(id,companyId,sender,body,now,kind);this.event(companyId,'support_message',{sender,kind});return {id,sender,body,created_at:now,read_at:null,kind};}
  markSupportRead(companyId,sender){this.db.prepare("UPDATE support_messages SET read_at=? WHERE company_id=? AND sender=? AND read_at IS NULL").run(Date.now(),companyId,sender);}
  company(id) {return this.db.prepare('SELECT * FROM companies WHERE id=?').get(id);}
  list() {return this.db.prepare('SELECT * FROM companies ORDER BY created_at DESC,id').all();}
  applications() {return this.db.prepare('SELECT * FROM applications ORDER BY created_at DESC,id').all();}
  application(id) {return this.db.prepare('SELECT * FROM applications WHERE id=?').get(id);}
  submitApplication(input) {
    const id=randomUUID(),now=Date.now();
    this.db.prepare('INSERT INTO applications(id,company_name,owner_name,email,phone,country,language,workers,plan_key,note,consent_version,consent_at,created_at,updated_at,currency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.companyName,input.ownerName,input.email,input.phone,input.country,input.language,input.workers,input.planKey,input.note,input.consentVersion,now,now,now,input.currency||'');
    this.event(null,'application_received',{applicationId:id,companyName:input.companyName});return this.application(id);
  }
  createTrialSignup(input) {
    const id=randomUUID(),token=randomToken(),now=Date.now();
    this.db.prepare("DELETE FROM trial_signups WHERE status='pending_email' AND expires_at<=?").run(now);
    this.db.prepare('INSERT INTO trial_signups(id,company_name,owner_name,email,language,plan_key,token_hash,expires_at,consent_version,consent_at,created_at,currency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.companyName,input.ownerName,input.email,input.language,input.planKey,digest(token),now+48*3600000,input.consentVersion,now,now,input.currency||'');
    this.event(null,'trial_verification_requested',{trialId:id,companyName:input.companyName});return {row:this.trialSignup(id),token};
  }
  trialSignup(id) {return this.db.prepare('SELECT * FROM trial_signups WHERE id=?').get(id);}
  trialByToken(token) {return this.db.prepare('SELECT * FROM trial_signups WHERE token_hash=?').get(digest(token));}
  removeTrialSignup(id) {this.db.prepare("DELETE FROM trial_signups WHERE id=? AND status='pending_email'").run(id);}
  activateTrial(token,passwordHash,input) {
    const signup=this.trialByToken(token);if(!signup||signup.status!=='pending_email'||signup.expires_at<=Date.now()){const e=new Error('Trial verification link expired or was already used.');e.status=400;throw e;}
    const now=Date.now(),companyId=randomUUID();let founding=0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      founding=this.db.prepare("SELECT (SELECT COUNT(*) FROM trial_signups WHERE status='activated' AND founding_offer=1)+(SELECT COUNT(*) FROM applications WHERE status='approved' AND founding_offer=1) AS count").get().count<10?1:0;
      const currency=normalizeSalesCurrency(signup.currency)||'EUR';
      const zone=salesTimeZone[currency]||'Europe/Berlin';
      this.db.prepare('INSERT INTO companies(id,name,payment,base_cents,included,seat_cents,secret,password_hash,created_at,trial_ends_at,time_zone,currency,plan_key,contact_email,legal_owner) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(companyId,input.name,'trial',input.baseCents,input.included,input.seatCents,randomToken(),passwordHash,now,now+TRIAL_MS,zone,currency,publicPlanKey(signup.plan_key),signup.email,signup.owner_name);
      const changed=this.db.prepare("UPDATE trial_signups SET status='activated',founding_offer=?,company_id=?,activated_at=? WHERE id=? AND status='pending_email' AND token_hash=? AND expires_at>?").run(founding,companyId,now,signup.id,digest(token),now);
      if(!changed.changes){const e=new Error('Trial verification link expired or was already used.');e.status=400;throw e;}
      this.event(companyId,'self_service_trial_activated',{trialId:signup.id,foundingOffer:Boolean(founding)});this.event(null,'trial_activated',{trialId:signup.id,companyId,foundingOffer:Boolean(founding)});this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return {signup:this.trialSignup(signup.id),row:this.company(companyId),foundingOffer:Boolean(founding)};
  }
  extendTrial(id,days=15) {
    const row=this.company(id);if(!row){const e=new Error('Company not found.');e.status=404;throw e;}
    if(row.payment!=='trial'){const e=new Error('Only a trial company can be extended.');e.status=409;throw e;}
    const start=Math.max(Date.now(),row.trial_ends_at||0),ends=start+days*24*3600000;
    this.db.prepare('UPDATE companies SET trial_ends_at=?,version=version+1 WHERE id=?').run(ends,id);this.event(id,'trial_extended',{days,ends});return this.company(id);
  }
  companyByGoogleSub(sub){return sub?this.db.prepare('SELECT * FROM companies WHERE google_sub=?').get(sub):undefined;}
  createGoogleOwner({name,email,ownerName,googleSub,plan,passwordHash,currency='EUR'}){
    const now=Date.now(),id=randomUUID();
    const code=normalizeSalesCurrency(currency)||'EUR';
    const zone=salesTimeZone[code]||'Europe/Berlin';
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('INSERT INTO companies(id,name,payment,base_cents,included,seat_cents,secret,password_hash,created_at,trial_ends_at,time_zone,currency,plan_key,contact_email,legal_owner,google_sub) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,name,'trial',plan.baseCents,plan.included,plan.seatCents,randomToken(),passwordHash,now,now+TRIAL_MS,zone,code,plan.key,email,ownerName,googleSub);
      this.event(id,'google_owner_created',{plan:plan.key});
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    return this.company(id);
  }
  create(input) {
    const id=randomUUID(),token=randomToken(),now=Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO companies(id,name,base_cents,included,seat_cents,secret,invite_hash,invite_expires,created_at,plan_key,trial_ends_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,input.name,input.baseCents,input.included,input.seatCents,randomToken(),digest(token),now+48*3600000,now,input.planKey||'custom',now+TRIAL_MS);
      this.event(id,'created',{name:input.name});this.db.exec('COMMIT');
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
    return {row:this.company(id),token};
  }
  approveApplication(id,input) {
    const application=this.application(id);if(!application){const e=new Error('Application not found.');e.status=404;throw e;}
    if(application.status!=='new'&&application.status!=='reviewing'){const e=new Error('This application has already been processed.');e.status=409;throw e;}
    const now=Date.now(),companyId=randomUUID(),token=randomToken();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const founding=this.db.prepare("SELECT (SELECT COUNT(*) FROM applications WHERE status='approved' AND founding_offer=1)+(SELECT COUNT(*) FROM trial_signups WHERE status='activated' AND founding_offer=1) AS count").get().count<10?1:0;
      const currency=normalizeSalesCurrency(application.currency)||'EUR';
      const zone=salesTimeZone[currency]||'Europe/Berlin';
      this.db.prepare('INSERT INTO companies(id,name,payment,base_cents,included,seat_cents,secret,invite_hash,invite_expires,created_at,trial_ends_at,time_zone,currency,plan_key,contact_email,legal_owner) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(companyId,input.name,'trial',input.baseCents,input.included,input.seatCents,randomToken(),digest(token),now+48*3600000,now,now+TRIAL_MS,zone,currency,publicPlanKey(input.planKey||application.plan_key,'plus'),application.email,application.owner_name);
      const changed=this.db.prepare("UPDATE applications SET status='approved',founding_offer=?,company_id=?,updated_at=?,version=version+1 WHERE id=? AND version=?").run(founding,companyId,now,id,input.version);
      if(!changed.changes){const e=new Error('Application changed. Refresh before approving.');e.status=409;throw e;}
      this.event(companyId,'created_from_application',{applicationId:id,foundingOffer:Boolean(founding)});this.event(null,'application_approved',{applicationId:id,companyId,foundingOffer:Boolean(founding)});this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return {application:this.application(id),row:this.company(companyId),token};
  }
  setApplicationStatus(id,input) {
    const application=this.application(id);if(!application){const e=new Error('Application not found.');e.status=404;throw e;}
    if(!['new','reviewing','rejected'].includes(input.status)){const e=new Error('Invalid application status.');e.status=400;throw e;}
    if(application.status==='approved'){const e=new Error('An approved application cannot be changed here.');e.status=409;throw e;}
    const result=this.db.prepare('UPDATE applications SET status=?,updated_at=?,version=version+1 WHERE id=? AND version=?').run(input.status,Date.now(),id,input.version);
    if(!result.changes){const e=new Error('Application changed. Refresh before saving.');e.status=409;throw e;}
    this.event(null,'application_status_changed',{applicationId:id,status:input.status});return this.application(id);
  }
  update(id,input) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result=this.db.prepare('UPDATE companies SET name=?,status=?,payment=?,base_cents=?,included=?,seat_cents=?,plan_key=?,payment_due_at=?,last_paid_at=?,version=version+1 WHERE id=? AND version=?').run(input.name,input.status,input.payment,input.baseCents,input.included,input.seatCents,input.planKey||'custom',input.paymentDueAt,input.lastPaidAt,id,input.version);
      if(!result.changes) {const e=new Error('Company changed. Refresh before saving.');e.status=409;throw e;}
      this.event(id,'updated',input);this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  invite(id) {
    const token=randomToken();
    this.db.prepare('UPDATE companies SET invite_hash=?,invite_expires=?,version=version+1 WHERE id=?').run(digest(token),Date.now()+48*3600000,id);
    this.event(id,'owner_invitation_replaced');return token;
  }
  removeCompany(id,name) {
    const row=this.company(id);if(!row){const e=new Error('Company not found.');e.status=404;throw e;}
    if(typeof name!=='string'||name!==row.name){const e=new Error('Type the company name exactly to delete it.');e.status=400;throw e;}
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM support_messages WHERE company_id=?').run(id);
      this.db.prepare('UPDATE applications SET company_id=NULL WHERE company_id=?').run(id);
      this.db.prepare('UPDATE trial_signups SET company_id=NULL WHERE company_id=?').run(id);
      this.db.prepare('DELETE FROM director_events WHERE company_id=?').run(id);
      const result=this.db.prepare('DELETE FROM companies WHERE id=? AND name=?').run(id,row.name);
      if(!result.changes){const e=new Error('Company not found.');e.status=404;throw e;}
      this.event(null,'company_deleted',{id,name:row.name});
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return row;
  }
  setInquiryProfile(id,input) {
    const mode=input.inquiries==='on'?1:input.inquiries==='off'?0:null;
    const result=this.db.prepare('UPDATE companies SET contact_email=?,contact_phone=?,legal_owner=?,legal_address=?,price_note=?,privacy_details=?,legal_extra=?,service_postcodes=?,legal_reviewed=?,inquiries_enabled=?,version=version+1 WHERE id=?').run(input.contactEmail,input.phone,input.owner,input.address,input.priceNote,input.privacyDetails,input.additionalLegal,input.postcodes,input.legalReviewed?1:0,mode,id);
    if(!result.changes){const e=new Error('Company not found.');e.status=404;throw e;}
    this.event(id,'inquiry_profile_updated',{inquiries:input.inquiries});
    return this.company(id);
  }
  activate(id,token,passwordHash) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result=this.db.prepare("UPDATE companies SET password_hash=?,invite_hash=NULL,invite_expires=NULL,version=version+1 WHERE id=? AND status='active' AND invite_hash=? AND invite_expires>?").run(passwordHash,id,digest(token),Date.now());
      if(!result.changes){const e=new Error('Invitation expired or already used.');e.status=400;throw e;}
      this.event(id,'owner_activated');this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  close(){this.db.close();}
}
