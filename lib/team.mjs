import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {TeamStore} from './team-store.mjs';
import {HttpError} from './validation.mjs';
import {hashPassword,verifyPassword,randomToken,digest} from './security.mjs';
import {createJobPhotos} from './job-photos.mjs';
import {validDate,berlinDate,localDate} from './reporting.mjs';
import {Planning} from './planning.mjs';
import {sendWorkerMagicLink} from './mail.mjs';
import {googleSigninUrl,exchangeSigninCode,googleProfile} from './google-signin.mjs';
import {createPartnerOps} from './partner-ops.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const states=['assigned','accepted','working','paused','submitted','closed','cancelled'];
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||(required&&!value.trim()))throw new HttpError(400,'Bitte Eingaben prüfen.');return value.trim();}
function page(url){const offset=Number(url.searchParams.get('offset')||0);if(!Number.isInteger(offset)||offset<0||offset>10000000)throw new HttpError(400,'Ungültige Seite.');return offset;}
export function createTeam(config,store,{now,limiter,clientKey,checkOrigin,readJson,json,ownerSession,fetcher=fetch}){
 const data=new TeamStore(store),db=store.db;
 const planning=new Planning(config,store,data,now);data.onJobCreated=job=>planning.enqueue(job);
 const ops=createPartnerOps({config,store,data,planning,now});
 const photos=createJobPhotos(config,data,now);
 const cookieName=config.basePath?'klarraum_company_'+config.basePath.split('/').at(-1)+'_employee':config.secureCookie?'__Host-klarraum_employee':'klarraum_employee';
 const cookie=(token,seconds)=>`${cookieName}=${token}; Path=${config.basePath?config.basePath+'/':'/'}; HttpOnly; SameSite=Strict; Max-Age=${seconds}${config.secureCookie?'; Secure':''}`;
 const tokenHash=token=>createHmac('sha256',config.secret).update(token).digest('hex');
 function clean(){db.prepare('DELETE FROM employee_sessions WHERE expires_at<=?').run(now());db.prepare('DELETE FROM job_actions WHERE created_at<?').run(now()-30*86400000);db.prepare('DELETE FROM employee_magic_links WHERE expires_at<=?').run(now());db.prepare('DELETE FROM employee_revocations WHERE expires_at<=?').run(now());}
 function companyProfile(){
  let company={name:config.business?.name||'Klarraum',email:config.business?.email||'',phone:config.business?.phone||''};
  try{const site=store.site().content?.company;if(site?.name)company={name:site.name,email:site.email||company.email,phone:site.phone||company.phone};}catch{/* Site copy stays optional. */}
  return company;
 }
 function today(){return localDate(now(),config.timeZone||'Europe/Berlin');}
 function present(job){if(!job||typeof job!=='object'||Array.isArray(job))return job;const copy={...job};for(const key of ['price','price_cents','quote','quote_cents','amount_cents','cleaning_price'])delete copy[key];return copy;}
 function session(req){
  const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(!token||!/^[\w-]{43}$/.test(token))throw new HttpError(401,'Bitte als Mitarbeiter anmelden.');
  const hashed=tokenHash(token);
  const row=db.prepare('SELECT s.*,e.active,e.name,e.email,e.region FROM employee_sessions s JOIN employees e ON e.id=s.employee_id WHERE token_hash=?').get(hashed);
  if(row&&!row.active){db.prepare('DELETE FROM employee_sessions WHERE token_hash=?').run(hashed);throw new HttpError(401,'Mitarbeitersitzung abgelaufen. Bitte neu anmelden.','access_removed');}
  if(!row||row.expires_at<=now()){const revoked=db.prepare('SELECT reason FROM employee_revocations WHERE token_hash=? AND expires_at>?').get(hashed,now());if(revoked?.reason==='removed')throw new HttpError(401,'Mitarbeitersitzung abgelaufen. Bitte neu anmelden.','access_removed');throw new HttpError(401,'Mitarbeitersitzung abgelaufen. Bitte neu anmelden.');}
  return row;
 }
 function beginSession(employee){const token=randomToken(),csrf=randomToken();db.prepare('INSERT INTO employee_sessions VALUES(?,?,?,?)').run(tokenHash(token),employee.id,csrf,now()+8*3600000);return {token,csrf};}
 function sendSession(res,employee){const s=beginSession(employee);return json(res,200,{csrf:s.csrf,employee:data.publicEmployee(employee),demoMode:Boolean(config.demoMode),today:today(),company:companyProfile()},{'Set-Cookie':cookie(s.token,8*3600)});}
 async function issueMagic(employee,purpose){
  const token=randomToken(),expires=now()+15*60*1000,url=`${config.origin}${config.basePath||''}/employee.html#magic=${token}`;
  db.prepare('DELETE FROM employee_magic_links WHERE employee_id=? AND purpose=?').run(employee.id,purpose);
  db.prepare('INSERT INTO employee_magic_links(token_hash,employee_id,purpose,expires_at,created_at) VALUES(?,?,?,?,?)').run(tokenHash(token),employee.id,purpose,expires,now());
  let mailed=false;
  if(config.mail?.key&&config.mail?.from){try{mailed=await sendWorkerMagicLink(config.mail,employee.email,url,fetcher);}catch{mailed=false;}}
  const payload={ok:true,expiresAt:expires,mailed};
  if(config.demoMode||!config.mail?.key)payload.previewUrl=url;
  return payload;
 }
 function inviteRow(token){if(typeof token!=='string'||!/^[\w-]{43}$/.test(token))return null;const row=db.prepare('SELECT * FROM employees WHERE invite_hash=?').get(tokenHash(token));if(!row?.active||row.invite_expires<=now())return null;return row;}
 function idempotent(req,actor,payload,fn){
  const key=req.headers['idempotency-key'];if(typeof key!=='string'||!uuid.test(key))throw new HttpError(400,'Ungültige Vorgangsnummer. Bitte neu laden.');
  const fingerprint=digest(JSON.stringify({actor,payload}));
  return data.tx(()=>{
   const old=db.prepare('SELECT * FROM job_actions WHERE request_key=?').get(key);
   if(old){if(old.fingerprint!==fingerprint)throw new HttpError(409,'Diese Vorgangsnummer wurde bereits verwendet.');return JSON.parse(old.response);}
   const response=fn();db.prepare('INSERT INTO job_actions VALUES(?,?,?,?)').run(key,fingerprint,JSON.stringify(response),now());return response;
  });
 }
 function invite(employeeId){
  const token=randomToken(),expires=now()+24*3600000;
  data.tx(()=>{data.deactivate(employeeId,now(),'Mitarbeiterzugang durch neue Einladung zurückgesetzt');db.prepare('UPDATE employees SET password_hash=NULL,invite_hash=?,invite_expires=? WHERE id=?').run(tokenHash(token),expires,employeeId);});
  return {employee:data.publicEmployee(data.employee(employeeId)),inviteUrl:config.origin+(config.basePath||'')+'/employee.html#invite='+token,expiresAt:expires};
 }
 function validateJob(b){
   if(!b||typeof b!=='object')throw new HttpError(400,'Auftrag fehlt.');
   if(typeof b.employeeId!=='string'||!uuid.test(b.employeeId))throw new HttpError(400,'Mitarbeiter auswählen.');
   const employee=data.employee(b.employeeId);if(!employee?.active)throw new HttpError(400,'Aktiven Mitarbeiter auswählen.');
   const source=planning.snapshot(b);
   const input={employeeId:employee.id,title:text(b.title,150,true),address:text(b.address,250,true),customer:text(b.customer,100),contact:text(b.contact,254),region:text(b.region,100,true),date:text(b.date,10,true),time:text(b.time,5,true),plannedMinutes:b.plannedMinutes,instructions:text(b.instructions,2000),checklist:b.checklist,inquiryId:b.inquiryId||null};
   if(b.areaM2!==undefined&&b.areaM2!==null&&b.areaM2!==''){if(!Number.isInteger(b.areaM2)||b.areaM2<1||b.areaM2>100000)throw new HttpError(400,'Area must be a whole number of square metres.');input.areaM2=b.areaM2;}
   if(b.accessNotes!==undefined)input.accessNotes=text(String(b.accessNotes),500);
   if(source)Object.assign(input,source);
   const parsed=new Date(input.date+'T12:00:00Z');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==input.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)||!Number.isInteger(input.plannedMinutes)||input.plannedMinutes<15||input.plannedMinutes>1440)throw new HttpError(400,'Termin und geplante Minuten (15–1440) prüfen.');
   if(!Array.isArray(input.checklist)||input.checklist.length>30)throw new HttpError(400,'Maximal 30 Arbeitsschritte.');input.checklist=input.checklist.map(item=>text(item,160,true));
   if(input.inquiryId&&(!uuid.test(input.inquiryId)||!store.get(input.inquiryId)))throw new HttpError(400,'Ursprüngliche Anfrage fehlt.');
   planning.conflicts(input);return input;
 }
 async function owner(req,res,url){
  const path=url.pathname,method=req.method;
  if(path.startsWith('/api/admin/ops'))return opsOwner(req,res,url);
  if(/^\/api\/admin\/(customers|properties|calendar|series|schedule-check)(\/|$)/.test(path))return planning.owner(req,res,url,{readJson,json,idempotent,validateJob});
  if(path==='/api/admin/inbox'&&method==='GET'){const items=db.prepare('SELECT id,kind,job_id AS jobId,employee_id AS employeeId,note,created_at AS createdAt,read_at AS readAt FROM partner_inbox ORDER BY created_at DESC,id DESC LIMIT 50').all();const workersOut=db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='working'").get().n;return json(res,200,{items,workersOut});}
  if(path==='/api/admin/employees'&&method==='GET')return json(res,200,data.employees(text(url.searchParams.get('search')||'',100),page(url)));
  if(path==='/api/admin/employees'&&method==='POST'){
   const body=await readJson(req);const name=text(body?.name,100,true),email=text(body?.email,254,true).toLowerCase(),region=text(body?.region,100,true);
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Gültige E-Mail-Adresse erforderlich.');
   if(config.demoMode&&!email.endsWith('.invalid'))throw new HttpError(400,'In der Demo bitte nur erfundene Adressen mit .invalid verwenden, z. B. team1@example.invalid.');
   if(db.prepare('SELECT id FROM employees WHERE email=? COLLATE NOCASE').get(email))throw new HttpError(409,'Diese E-Mail-Adresse ist bereits vorhanden.');
   const phone=body?.phone===undefined?'':text(body.phone,40);if(phone&&(!/^[+\d\s()/.\-]+$/.test(phone)||phone.replace(/\D/g,'').length<7))throw new HttpError(400,'Enter a valid phone number.');
   const id=randomUUID();db.prepare('INSERT INTO employees(id,name,email,region,created_at,phone) VALUES(?,?,?,?,?,?)').run(id,name,email,region,now(),phone);return json(res,201,invite(id));
  }
  const employeeMatch=path.match(/^\/api\/admin\/employees\/([a-f0-9-]{36})(\/invite)?$/i);
  if(employeeMatch&&uuid.test(employeeMatch[1])){
   const employee=data.employee(employeeMatch[1]);if(!employee)throw new HttpError(404,'Mitarbeiter nicht gefunden.');
   if(employeeMatch[2]&&method==='POST'){
    if(!employee.active)throw new HttpError(409,'Zugang zuerst aktivieren.');
    if(!limiter.allow('invite:'+employee.id,5,60000,now()))throw new HttpError(429,'Bitte später erneut versuchen.');return json(res,200,invite(employee.id));
   }
   if(!employeeMatch[2]&&method==='PATCH'){
    const body=await readJson(req);if(typeof body?.active!=='boolean')throw new HttpError(400,'Zugangsstatus erforderlich.');
    const name=body.name===undefined?employee.name:text(body.name,100,true),region=body.region===undefined?employee.region:text(body.region,100,true);
    data.tx(()=>{if(!body.active)data.deactivate(employee.id,now());db.prepare('UPDATE employees SET active=?,name=?,region=? WHERE id=?').run(body.active?1:0,name,region,employee.id);});
    return json(res,200,{employee:data.publicEmployee(data.employee(employee.id))});
   }
  }
  if(path==='/api/admin/jobs'&&method==='GET'){
   const state=url.searchParams.get('state')||'',employeeId=url.searchParams.get('employee')||'';if((state&&!states.includes(state))||(employeeId&&!uuid.test(employeeId)))throw new HttpError(400,'Ungültiger Filter.');
   return json(res,200,data.jobs({state,employeeId,region:text(url.searchParams.get('region')||'',100),offset:page(url)},now()));
  }
  if(path==='/api/admin/jobs'&&method==='POST'){
   const input=validateJob(await readJson(req));return json(res,201,idempotent(req,'owner',{create:input},()=>{const scheduleWarnings=planning.conflicts(input);return {...data.createJob(input,now()),scheduleWarnings};}));
  }
  const match=path.match(/^\/api\/admin\/jobs\/([a-f0-9-]{36})(\/actions|\/corrections)?$/i);
  if(match&&uuid.test(match[1])){
   const job=data.job(match[1]);if(!job)throw new HttpError(404,'Auftrag nicht gefunden.');
   if(!match[2]&&method==='GET')return json(res,200,data.detail(job,now()));
   if(!match[2]&&method==='PUT'){
    const b=await readJson(req);if(!b||typeof b!=='object'||!Number.isInteger(b.version))throw new HttpError(400,'Aktuelle Auftragsversion erforderlich.');
    const changes=validateJob(b);if(!changes.propertyId)changes.propertyId=null;
    const scheduleWarnings=planning.conflicts(changes,job.id);
    return json(res,200,idempotent(req,'owner',{edit:job.id,version:b.version,changes},()=>{
     const current=data.job(job.id);if(current.version!==b.version||!['assigned','accepted'].includes(current.state)||db.prepare('SELECT id FROM work_intervals WHERE job_id=? LIMIT 1').get(job.id))throw new HttpError(409,'Nur noch nicht begonnene Aufträge können umgeplant werden. Für begonnene Aufträge stornieren oder Rückmeldung nutzen.');
     db.prepare('UPDATE jobs SET employee_id=?,title=?,address=?,customer=?,contact=?,region=?,scheduled_date=?,scheduled_time=?,planned_minutes=?,instructions=?,checklist=?,state=?,version=version+1 WHERE id=?').run(changes.employeeId,changes.title,changes.address,changes.customer,changes.contact,changes.region,changes.date,changes.time,changes.plannedMinutes,changes.instructions,JSON.stringify(changes.checklist.map(item=>({text:item,done:false}))),'assigned',job.id);db.prepare('UPDATE jobs SET property_id=? WHERE id=?').run(changes.propertyId,job.id);if(changes.areaM2!==undefined)db.prepare('UPDATE jobs SET area_m2=? WHERE id=?').run(changes.areaM2,job.id);if(changes.accessNotes!==undefined)db.prepare('UPDATE jobs SET access_notes=? WHERE id=?').run(changes.accessNotes,job.id);data.event(job.id,'owner','plan_changed','Auftragsplanung vor Arbeitsbeginn aktualisiert',now());
     if(current.employee_id!==changes.employeeId){db.prepare("UPDATE employee_notifications SET mail_status='superseded',read_at=? WHERE job_id=? AND employee_id=? AND read_at IS NULL").run(now(),job.id,current.employee_id);}
     planning.enqueue(data.job(job.id),'changed');return {...data.detail(data.job(job.id),now()),scheduleWarnings};
    }));
   }

   if(match[2]==='/actions'&&method==='POST'){const body=await readJson(req);if(!body||!Number.isInteger(body.version)||typeof body.action!=='string')throw new HttpError(400,'Aktion und aktuelle Version erforderlich.');return json(res,200,idempotent(req,'owner',{id:job.id,body},()=>{const result=data.ownerAction(job.id,body,now());planning.enqueue(data.job(job.id),'changed');return result;}));}
   if(match[2]==='/corrections'&&method==='POST'){
    const b=await readJson(req),reason=text(b?.reason,500,true);if(!Number.isInteger(b.minutes)||!b.minutes||Math.abs(b.minutes)>1440||reason.length<5)throw new HttpError(400,'Korrektur: Minuten (±1440) und nachvollziehbaren Grund angeben.');
    const latestInterval=db.prepare('SELECT started_at FROM work_intervals WHERE job_id=? ORDER BY started_at DESC LIMIT 1').get(job.id);const effectiveDate=b.effectiveDate||(latestInterval?berlinDate(latestInterval.started_at):job.scheduled_date);if(!validDate(effectiveDate)||effectiveDate>berlinDate(now()))throw new HttpError(400,'Datum der Zeitkorrektur prüfen.');
    const result=idempotent(req,'owner',{id:job.id,correction:b},()=>{
     const current=data.job(job.id);if(current.state==='working'||current.version!==b.version)throw new HttpError(409,'Auftrag läuft oder wurde geändert. Bitte pausieren/aktualisieren.');
     if(data.detail(current,now()).workedMilliseconds+b.minutes*60000<0)throw new HttpError(400,'Die Gesamtzeit darf nicht negativ werden.');
     db.prepare('INSERT INTO time_corrections(id,job_id,minutes,reason,created_at,effective_date) VALUES(?,?,?,?,?,?)').run(randomUUID(),job.id,b.minutes,reason,now(),effectiveDate);db.prepare('UPDATE jobs SET version=version+1 WHERE id=?').run(job.id);data.event(job.id,'owner','time_correction',`${b.minutes} Minuten (${effectiveDate}): ${reason}`,now());planning.enqueue(data.job(job.id),'changed');return data.detail(data.job(job.id),now());
    });return json(res,200,result);
   }
  }
  throw new HttpError(404,'Nicht gefunden.');
 }
 async function worker(req,res,url){
  const path=url.pathname,method=req.method;
  if(method!=='GET')checkOrigin(req);
  if(path==='/api/employee/login'&&method==='POST'){
   if(!limiter.allow('employee-login:'+clientKey(req),300,900000,now()))throw new HttpError(429,'Zu viele Versuche. Bitte später erneut anmelden.');
   const body=await readJson(req);const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
   if(!limiter.allow('employee-email:'+digest(email),5,900000,now()))throw new HttpError(429,'Zu viele Versuche. Bitte später erneut anmelden.');
   const employee=db.prepare('SELECT * FROM employees WHERE email=? COLLATE NOCASE').get(email);
   // Always run a password derivation when an account is absent or not activated.
   const hash=employee?.password_hash||config.passwordHash;
   const valid=await verifyPassword(body?.password,hash);
   const current=employee&&data.employee(employee.id);
   if(current&&!current.active&&valid&&current.password_hash===hash)throw new HttpError(401,'Anmeldung fehlgeschlagen.','access_removed');
   if(!valid||!current?.active||!current.password_hash||current.password_hash!==hash)throw new HttpError(401,'Anmeldung fehlgeschlagen.');return sendSession(res,current);
  }
  if(path==='/api/employee/company'&&method==='GET')return json(res,200,companyProfile());
  if(path==='/api/employee/invite'&&method==='GET'){
   const row=inviteRow(url.searchParams.get('token')||'');
   if(!row)return json(res,200,{valid:false,expired:true});
   const company=companyProfile();
   return json(res,200,{valid:true,name:row.name,firstName:row.name.trim().split(/\s+/)[0]||row.name,email:row.email,role:'Cleaner',company:company.name});
  }
  if(path==='/api/employee/decline-invite'&&method==='POST'){
   if(!limiter.allow('decline-invite:'+clientKey(req),30,900000,now()))throw new HttpError(429,'Zu viele Versuche.');
   const b=await readJson(req);const row=inviteRow(b?.token);if(!row)throw new HttpError(400,'This invitation has expired.');
   data.tx(()=>{
    const updated=db.prepare('UPDATE employees SET active=0,password_hash=NULL,invite_hash=NULL,invite_expires=NULL WHERE id=? AND active=1 AND invite_hash=?').run(row.id,row.invite_hash);
    if(!updated.changes)throw new HttpError(400,'This invitation has expired.');
    data.deactivate(row.id,now());
    data.notify('invite_declined',{employeeId:row.id,note:`${row.name} declined the invitation.`},now());
   });
   return json(res,200,{ok:true});
  }
  if(path==='/api/employee/invite/email'&&method==='POST'){
   if(!limiter.allow('invite-email:'+clientKey(req),30,900000,now()))throw new HttpError(429,'Zu viele Versuche.');
   const b=await readJson(req);const row=inviteRow(b?.token);if(!row)throw new HttpError(400,'This invitation has expired.');
   return json(res,200,await issueMagic(row,'invite'));
  }
  if(path==='/api/employee/magic-link'&&method==='POST'){
   if(!limiter.allow('magic-link:'+clientKey(req),30,900000,now()))throw new HttpError(429,'Too many attempts. Try again shortly.');
   const b=await readJson(req);const email=typeof b?.email==='string'?b.email.trim().toLowerCase():'';
   const employee=email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?db.prepare('SELECT * FROM employees WHERE email=? COLLATE NOCASE').get(email):null;
   if(!employee?.active||!employee.password_hash||!limiter.allow('magic-email:'+digest(email),5,900000,now()))return json(res,200,{ok:true});
   return json(res,200,await issueMagic(employee,'login'));
  }
  if(path==='/api/employee/magic'&&method==='POST'){
   if(!limiter.allow('magic-consume:'+clientKey(req),30,900000,now()))throw new HttpError(429,'Too many attempts.');
   const b=await readJson(req);if(typeof b?.token!=='string'||!/^[\w-]{43}$/.test(b.token))throw new HttpError(400,'This sign-in link has expired.');
   const hashed=tokenHash(b.token);const link=db.prepare('SELECT * FROM employee_magic_links WHERE token_hash=?').get(hashed);
   if(!link||link.expires_at<=now())throw new HttpError(400,'This sign-in link has expired.');
   const existing=data.employee(link.employee_id);if(!existing?.active)throw new HttpError(401,'Anmeldung fehlgeschlagen.','access_removed');
   const passwordHash=existing.password_hash?null:await hashPassword(randomToken());
   const employee=data.tx(()=>{
    if(!db.prepare('DELETE FROM employee_magic_links WHERE token_hash=? AND expires_at>?').run(hashed,now()).changes)throw new HttpError(400,'This sign-in link has expired.');
    if(passwordHash){const updated=db.prepare('UPDATE employees SET password_hash=?,invite_hash=NULL,invite_expires=NULL WHERE id=? AND active=1').run(passwordHash,existing.id);if(!updated.changes)throw new HttpError(401,'Anmeldung fehlgeschlagen.','access_removed');}
    return data.employee(existing.id);
   });
   return sendSession(res,employee);
  }
  if(path==='/api/employee/google/start'&&method==='POST'){
   if(!config.google?.clientId||!config.google?.clientSecret)throw new HttpError(404,'Google sign-in is not set up for this company. Use email instead.');
   const b=await readJson(req);let employeeId='',purpose='login';
   if(b?.token){const row=inviteRow(b.token);if(!row)throw new HttpError(400,'This invitation has expired.');employeeId=row.id;purpose='invite';}
   const exp=now()+15*60*1000,payload=Buffer.from(JSON.stringify({purpose,employeeId,exp})).toString('base64url'),mac=createHmac('sha256',config.secret).update('worker-google:'+payload).digest('base64url');
   const redirectUri=`${config.origin}${config.basePath||''}/api/employee/google/callback`;
   return json(res,200,{url:googleSigninUrl({clientId:config.google.clientId,redirectUri,state:`${payload}.${mac}`})});
  }
  if(path==='/api/employee/google/callback'&&method==='GET'){
   const back=`${config.basePath||''}/employee.html`;
   try{
    if(!config.google?.clientId||!config.google?.clientSecret)throw new Error('Google sign-in is not set up.');
    const code=url.searchParams.get('code')||'',state=url.searchParams.get('state')||'',parts=state.split('.');
    if(parts.length!==2)throw new Error('Google sign-in returned an invalid state.');
    const mac=createHmac('sha256',config.secret).update('worker-google:'+parts[0]).digest('base64url'),left=Buffer.from(mac),right=Buffer.from(parts[1]);
    if(left.length!==right.length||!timingSafeEqual(left,right))throw new Error('Google sign-in returned an invalid state.');
    const body=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(!(body?.exp>now()))throw new Error('Google sign-in expired.');
    const redirectUri=`${config.origin}${config.basePath||''}/api/employee/google/callback`;
    const access=await exchangeSigninCode({clientId:config.google.clientId,clientSecret:config.google.clientSecret,code,redirectUri,fetchImpl:fetcher});
    const profile=await googleProfile(access,fetcher);
    const employee=body.employeeId?data.employee(body.employeeId):db.prepare('SELECT * FROM employees WHERE email=? COLLATE NOCASE').get(profile.email);
    if(!employee||employee.email.toLowerCase()!==profile.email)throw new Error('This Google account is not a worker here.');
    if(!employee.active){res.writeHead(302,{Location:back+'#/access-removed'});return res.end();}
    if(!employee.password_hash){const hash=await hashPassword(randomToken());data.tx(()=>{if(!db.prepare('UPDATE employees SET password_hash=?,invite_hash=NULL,invite_expires=NULL WHERE id=? AND active=1').run(hash,employee.id).changes)throw new HttpError(401,'Anmeldung fehlgeschlagen.','access_removed');});}
    const s=beginSession(data.employee(employee.id));
    res.writeHead(302,{Location:back+'#/jobs','Set-Cookie':cookie(s.token,8*3600)});return res.end();
   }catch{res.writeHead(302,{Location:back+'#/login'});return res.end();}
  }
  if(path==='/api/employee/accept-invite'&&method==='POST'){
   if(!limiter.allow('accept-invite:'+clientKey(req),300,900000,now()))throw new HttpError(429,'Zu viele Versuche.');
   const b=await readJson(req);if(typeof b?.token!=='string'||!/^[\w-]{43}$/.test(b.token))throw new HttpError(400,'Einladung ungültig oder abgelaufen.');
   const old=db.prepare('SELECT * FROM employees WHERE invite_hash=?').get(tokenHash(b.token));
   if(!old?.active||old.invite_expires<=now())throw new HttpError(400,'Einladung ungültig oder abgelaufen.');
   let hash;try{hash=await hashPassword(b.password);}catch{throw new HttpError(400,'Passwort muss 14–256 Zeichen lang sein.');}
   const employee=data.tx(()=>{
    const updated=db.prepare('UPDATE employees SET password_hash=?,invite_hash=NULL,invite_expires=NULL WHERE id=? AND active=1 AND invite_hash=? AND invite_expires>?').run(hash,old.id,tokenHash(b.token),now());
    if(!updated.changes)throw new HttpError(400,'Einladung ungültig oder abgelaufen.');return data.employee(old.id);
   });return sendSession(res,employee);
  }
  const s=session(req);
  if(method!=='GET'&&req.headers['x-csrf-token']!==s.csrf)throw new HttpError(403,'Sicherheitsprüfung fehlgeschlagen. Bitte neu anmelden.');
  if(path==='/api/employee/session'&&method==='GET')return json(res,200,{csrf:s.csrf,employee:data.publicEmployee(data.employee(s.employee_id)),demoMode:Boolean(config.demoMode),today:today(),company:companyProfile()});
  if(path==='/api/employee/logout'&&method==='POST'){db.prepare('DELETE FROM employee_sessions WHERE token_hash=?').run(s.token_hash);return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});}
  if(path==='/api/employee/change-password'&&method==='POST'){
   const b=await readJson(req),old=data.employee(s.employee_id);if(!await verifyPassword(b?.currentPassword,old.password_hash))throw new HttpError(400,'Aktuelles Passwort ist nicht korrekt.');
   let hash;try{hash=await hashPassword(b.newPassword);}catch{throw new HttpError(400,'Neues Passwort muss 14–256 Zeichen lang sein.');}
   session(req);data.tx(()=>{const result=db.prepare('UPDATE employees SET password_hash=? WHERE id=? AND active=1 AND password_hash=?').run(hash,old.id,old.password_hash);if(!result.changes)throw new HttpError(409,'Zugang wurde geändert. Bitte neu anmelden.');db.prepare('DELETE FROM employee_sessions WHERE employee_id=?').run(old.id);});return sendSession(res,data.employee(old.id));
  }
  if(path==='/api/employee/profile'&&method==='PATCH'){
   const b=await readJson(req);const language=['en','de','ru'].includes(b?.language)?b.language:null;let phone;if(b?.phone!==undefined){phone=text(b.phone,40);if(phone&&(!/^[+\d\s()/.\-]+$/.test(phone)||phone.replace(/\D/g,'').length<7))throw new HttpError(400,'Enter a valid phone number.');}
   if(!language&&phone===undefined)throw new HttpError(400,'Nothing to update.');
   if(language)db.prepare('UPDATE employees SET language=? WHERE id=?').run(language,s.employee_id);
   if(phone!==undefined)db.prepare('UPDATE employees SET phone=? WHERE id=?').run(phone,s.employee_id);
   return json(res,200,{employee:data.publicEmployee(data.employee(s.employee_id))});
  }
  if(path==='/api/employee/notifications'&&method==='GET')return json(res,200,planning.notifications(s.employee_id,url));
  const notification=path.match(/^\/api\/employee\/notifications\/([a-f0-9-]{36})\/read$/i);
  if(notification&&method==='POST'){const result=db.prepare('UPDATE employee_notifications SET read_at=? WHERE id=? AND employee_id=? AND due_at<=?').run(now(),notification[1],s.employee_id,now());if(!result.changes)throw new HttpError(404,'Benachrichtigung fehlt.');return json(res,200,{ok:true});}
  if(path==='/api/employee/jobs'&&method==='GET'){const listed=data.jobs({employeeId:s.employee_id,offset:page(url),states:['assigned','working','paused','submitted','closed']},now());return json(res,200,{...listed,items:listed.items.map(present),today:today()});}
  const photoMatch=path.match(/^\/api\/employee\/jobs\/([a-f0-9-]{36})\/photos(?:\/([a-f0-9-]{36}))?$/i);
  if(photoMatch&&uuid.test(photoMatch[1])){
   if(!limiter.allow('work-photo:'+s.employee_id,20,60000,now()))throw new HttpError(429,'Zu viele Fotoversuche.');
   if(!photoMatch[2]&&method==='POST')return json(res,201,await photos.upload(req,photoMatch[1],s.employee_id,()=>session(req)));
   if(photoMatch[2]&&uuid.test(photoMatch[2])&&method==='DELETE'){await photos.remove(photoMatch[1],photoMatch[2],s.employee_id);return json(res,200,{ok:true});}
  }
  const match=path.match(/^\/api\/employee\/jobs\/([a-f0-9-]{36})(\/actions)?$/i);
  if(match&&uuid.test(match[1])){
   const job=data.job(match[1]);if(!job||job.employee_id!==s.employee_id)throw new HttpError(404,'Auftrag nicht gefunden.');
   if(!match[2]&&method==='GET'){if(['accepted','cancelled'].includes(job.state))throw new HttpError(404,'Auftrag nicht gefunden.');return json(res,200,present(data.detail(job,now())));}
   if(match[2]&&method==='POST'){if(!limiter.allow('work-action:'+s.employee_id,120,60000,now()))throw new HttpError(429,'Zu viele Aktionen. Bitte kurz warten.');const body=await readJson(req);if(!body||!Number.isInteger(body.version)||typeof body.action!=='string')throw new HttpError(400,'Aktion und aktuelle Version erforderlich.');session(req);return json(res,200,present(idempotent(req,s.employee_id,{id:job.id,body},()=>data.workerAction(job.id,s.employee_id,body,now()))));}
  }
  throw new HttpError(404,'Nicht gefunden.');
 }
 async function servePhoto(req,res,url){
  if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'Nur Lesen erlaubt.');
  const match=url.pathname.match(/^\/private\/jobs\/([a-f0-9-]{36})\/photos\/([a-f0-9-]{36})\.webp$/i);if(!match||!uuid.test(match[1])||!uuid.test(match[2]))throw new HttpError(404,'Foto nicht gefunden.');
  let isOwner=false;try{ownerSession(req);isOwner=true;}catch{/* Separate employee session is checked below. */}
  if(!isOwner){const s=session(req);const job=data.job(match[1]);if(!job||job.employee_id!==s.employee_id)throw new HttpError(404,'Foto nicht gefunden.');}
  return photos.serve(req,res,match[1],match[2]);
 }
 async function opsOwner(req,res,url){
  const path=url.pathname,method=req.method;
  if(path==='/api/admin/ops/today'&&method==='GET')return json(res,200,ops.today());
  if(path==='/api/admin/ops/availability'&&method==='GET')return json(res,200,ops.availability(url));
  if(path==='/api/admin/ops/jobs'&&method==='GET')return json(res,200,ops.list(url));
  if(path==='/api/admin/ops/jobs'&&method==='POST'){const body=await readJson(req);return json(res,201,idempotent(req,'owner',{ops:'create',body},()=>ops.create(body)));}
  const report=path.match(/^\/api\/admin\/ops\/jobs\/([a-f0-9-]{36})\/report\.pdf$/i);
  if(report&&method==='GET'){const body=ops.pdf(report[1]);res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${report[1]}.pdf"`,'Cache-Control':'no-store'});return res.end(body);}
  const match=path.match(/^\/api\/admin\/ops\/jobs\/([a-f0-9-]{36})(?:\/(accept|decline|assign|cancel|start|done|report))?(?:\/(send))?$/i);
  if(!match||!uuid.test(match[1]))throw new HttpError(404,'Job not found.');
  const id=match[1],action=match[2]||'';
  if(!action&&method==='GET')return json(res,200,ops.detail(id));
  if(!action&&method==='PUT'){const body=await readJson(req);return json(res,200,idempotent(req,'owner',{ops:'update',id,body},()=>ops.update(id,body)));}
  if(action==='report'&&match[3]==='send'&&method==='POST'){await readJson(req);return json(res,200,idempotent(req,'owner',{ops:'report',id},()=>ops.sendReport(id)));}
  if(method!=='POST'||!action)throw new HttpError(404,'Job not found.');
  const body=await readJson(req);
  const run={accept:()=>ops.accept(id,body),decline:()=>ops.decline(id,body),assign:()=>ops.assign(id,body),cancel:()=>ops.cancel(id,body),start:()=>ops.start(id,body),done:()=>ops.complete(id,body)}[action];
  if(!run)throw new HttpError(404,'Job not found.');
  return json(res,200,idempotent(req,'owner',{ops:action,id,body},run));
 }
 return {owner,worker,clean,data,planning,ops,captureInquiry:ops.captureInquiry,servePhoto};
}
