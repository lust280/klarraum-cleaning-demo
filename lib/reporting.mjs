import {randomUUID,createHash} from 'node:crypto';
import {HttpError} from './validation.mjs';
const MAX_ROWS=10000;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const dayFormat=timeZone=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
export function monthBounds(month,timeZone='Europe/Berlin'){
 if(typeof month!=='string'||!/^(20\d\d|21\d\d)-(0[1-9]|1[0-2])$/.test(month))throw new HttpError(400,'Monat im Format JJJJ-MM (2000–2199) wählen.');
 const [year,m]=month.split('-').map(Number);
 const dateAt=(y,m)=>{
  const wall=Date.UTC(y,m,1);const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(wall));const p=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));return wall-(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-wall);
 };
 return {start:dateAt(year,m-1),end:dateAt(year,m),firstDate:month+'-01',nextDate:new Date(Date.UTC(year,m,1)).toISOString().slice(0,10)};
}
export function localDate(value,timeZone='Europe/Berlin'){return dayFormat(timeZone).format(new Date(value));}
export const berlinDate=value=>localDate(value,'Europe/Berlin');
export function validDate(value){if(typeof value!=='string'||!/^20\d\d-\d\d-\d\d$|^21\d\d-\d\d-\d\d$/.test(value))return false;const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||(required&&!value.trim()))throw new HttpError(400,'Bitte Angaben prüfen.');return value.trim();}
export function createReporting(config,store,now){
 const db=store.db;
 if(!db.prepare('PRAGMA table_info(time_corrections)').all().some(column=>column.name==='effective_date')){
  db.exec('ALTER TABLE time_corrections ADD COLUMN effective_date TEXT');
 }
 db.exec('UPDATE time_corrections SET effective_date=(SELECT scheduled_date FROM jobs WHERE jobs.id=time_corrections.job_id) WHERE effective_date IS NULL');
 db.exec(`CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),kind TEXT NOT NULL,amount_cents INTEGER NOT NULL,payment_date TEXT NOT NULL,method TEXT NOT NULL,reference TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL,voided_at INTEGER,void_reason TEXT);
 CREATE INDEX IF NOT EXISTS payments_date ON payments(payment_date,id);
 CREATE INDEX IF NOT EXISTS payments_job ON payments(job_id,payment_date);
 CREATE TABLE IF NOT EXISTS payment_requests(request_key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payment_id TEXT NOT NULL REFERENCES payments(id));
 CREATE TABLE IF NOT EXISTS monthly_reports(id TEXT PRIMARY KEY,month TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL,request_key TEXT UNIQUE NOT NULL,UNIQUE(month,revision));
 CREATE INDEX IF NOT EXISTS monthly_reports_month ON monthly_reports(month,revision);
 CREATE INDEX IF NOT EXISTS intervals_period ON work_intervals(started_at,ended_at);
 CREATE INDEX IF NOT EXISTS events_action_period ON job_events(action,created_at);
 CREATE INDEX IF NOT EXISTS jobs_plan_date ON jobs(scheduled_date);
 CREATE INDEX IF NOT EXISTS corrections_effective_date ON time_corrections(effective_date);
 `);
 const hash=value=>createHash('sha256').update(value).digest('hex');
 function limited(rows){if(rows.length>MAX_ROWS)throw new HttpError(422,'Zu viele Datensätze für einen Monatsbericht. Keine gekürzte Ausgabe erstellt; getrennte Auswertung erforderlich.');return rows;}
 function generate(month){
  const bounds=monthBounds(month,config.timeZone),time=now();
  const intervals=limited(db.prepare(`SELECT w.*,e.name AS employeeName,j.title AS jobTitle FROM work_intervals w JOIN employees e ON e.id=w.employee_id JOIN jobs j ON j.id=w.job_id WHERE w.started_at<? AND COALESCE(w.ended_at,?)>? ORDER BY w.started_at,w.id LIMIT ?`).all(bounds.end,time,bounds.start,MAX_ROWS+1)).map(row=>({...row,clippedStart:Math.max(row.started_at,bounds.start),clippedEnd:Math.min(row.ended_at??time,bounds.end,time)})).filter(row=>row.clippedEnd>row.clippedStart).map(row=>({...row,milliseconds:row.clippedEnd-row.clippedStart,open:row.ended_at===null}));
  const corrections=limited(db.prepare(`SELECT c.*,e.name AS employeeName,j.employee_id,j.title AS jobTitle FROM time_corrections c JOIN jobs j ON j.id=c.job_id JOIN employees e ON e.id=j.employee_id WHERE c.effective_date>=? AND c.effective_date<? ORDER BY c.effective_date,c.created_at,c.id LIMIT ?`).all(bounds.firstDate,bounds.nextDate,MAX_ROWS+1));
  const payments=limited(db.prepare(`SELECT p.*,j.title AS jobTitle,j.customer FROM payments p JOIN jobs j ON j.id=p.job_id WHERE p.payment_date>=? AND p.payment_date<? ORDER BY p.payment_date,p.created_at,p.id LIMIT ?`).all(bounds.firstDate,bounds.nextDate,MAX_ROWS+1));
  const scheduled=limited(db.prepare('SELECT id FROM jobs WHERE scheduled_date>=? AND scheduled_date<? LIMIT ?').all(bounds.firstDate,bounds.nextDate,MAX_ROWS+1));
  const accepted=limited(db.prepare("SELECT DISTINCT job_id AS id FROM job_events WHERE action='approve' AND created_at>=? AND created_at<? LIMIT ?").all(bounds.start,bounds.end,MAX_ROWS+1));
  const ids=[...new Set([...scheduled,...accepted].map(row=>row.id).concat(intervals.map(x=>x.job_id),corrections.map(x=>x.job_id),payments.map(x=>x.job_id)))];if(ids.length>MAX_ROWS)throw new HttpError(422,'Zu viele Aufträge für einen Monatsbericht. Keine Daten gekürzt.');
  const jobs=ids.length?db.prepare(`SELECT j.id,j.title,j.address,j.customer,j.region,j.employee_id,e.name AS employeeName,j.scheduled_date,j.scheduled_time,j.planned_minutes,j.state,j.instructions,j.report,j.review_note,j.checklist,(SELECT COUNT(*) FROM job_photos p WHERE p.job_id=j.id) AS photoCount FROM jobs j JOIN employees e ON e.id=j.employee_id WHERE j.id IN (${ids.map(()=>'?').join(',')}) ORDER BY j.scheduled_date,j.scheduled_time,j.id`).all(...ids).map(row=>({...row,checklist:JSON.parse(row.checklist)})):[];
  const employees=new Map();function employee(id,name){if(!employees.has(id))employees.set(id,{id,name,loggedMilliseconds:0,correctionMinutes:0,correctedMilliseconds:0});return employees.get(id);}
  for(const interval of intervals)employee(interval.employee_id,interval.employeeName).loggedMilliseconds+=interval.milliseconds;
  for(const item of corrections)employee(item.employee_id,item.employeeName).correctionMinutes+=item.minutes;
  for(const item of employees.values())item.correctedMilliseconds=item.loggedMilliseconds+item.correctionMinutes*60000;
  let receivedCents=0,refundedCents=0;for(const item of payments){if(item.voided_at)continue;if(item.kind==='payment')receivedCents+=item.amount_cents;else refundedCents+=item.amount_cents;}
  const reasons=[];if(time<bounds.end)reasons.push('Monat noch nicht abgeschlossen.');if(intervals.some(item=>item.open))reasons.push('Laufende Zeitabschnitte sind bis zum Erstellungszeitpunkt vorläufig enthalten.');if([...employees.values()].some(item=>item.correctedMilliseconds<0))reasons.push('Negativer Zeitsaldo: Korrekturzuordnung prüfen.');
  const site=store.site().content;
  return {schemaVersion:1,month,timeZone:config.timeZone,currency:config.currency,periodStart:bounds.start,periodEnd:bounds.end,generatedAt:time,demo:Boolean(config.demoMode),company:{name:site.company.name,legalName:config.business.name,owner:config.business.owner||'',address:config.business.address||'',email:config.business.email||''},provisionalReasons:reasons,summary:{scheduledJobs:scheduled.length,acceptedJobs:accepted.length,loggedMilliseconds:intervals.reduce((sum,item)=>sum+item.milliseconds,0),correctionMinutes:corrections.reduce((sum,item)=>sum+item.minutes,0),receivedCents,refundedCents,netReceivedCents:receivedCents-refundedCents,voidedPayments:payments.filter(item=>item.voided_at).length},jobs,employees:[...employees.values()].sort((a,b)=>a.name.localeCompare(b.name)),intervals,corrections,payments};
 }
 async function handle(req,res,url,{readJson,json}){
  const path=url.pathname,method=req.method,month=url.searchParams.get('month');
  if(path==='/api/admin/reports'&&method==='GET')return json(res,200,generate(month));
  if(path==='/api/admin/reports/archives'&&method==='GET'){monthBounds(month);return json(res,200,{items:db.prepare('SELECT id,month,revision,created_at,sha256 FROM monthly_reports WHERE month=? ORDER BY revision DESC').all(month)});}
  if(path==='/api/admin/reports/archives'&&method==='POST'){
   const body=await readJson(req);monthBounds(body?.month);const key=req.headers['idempotency-key'];if(typeof key!=='string'||!uuid.test(key))throw new HttpError(400,'Vorgangsnummer fehlt.');
   const existing=db.prepare('SELECT id,month,revision,created_at,sha256 FROM monthly_reports WHERE request_key=?').get(key);if(existing){if(existing.month!==body.month)throw new HttpError(409,'Vorgangsnummer bereits verwendet.');return json(res,200,existing);}
   const report=generate(body.month),payload=JSON.stringify(report);if(Buffer.byteLength(payload)>20*1024*1024)throw new HttpError(422,'Bericht zu groß für ein einzelnes Archiv.');
   const record={id:randomUUID(),month:body.month,revision:db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM monthly_reports WHERE month=?').get(body.month).n,created_at:now(),sha256:hash(payload)};
   db.prepare('INSERT INTO monthly_reports VALUES(?,?,?,?,?,?,?)').run(record.id,record.month,record.revision,record.created_at,payload,record.sha256,key);return json(res,201,record);
  }
  const archive=path.match(/^\/api\/admin\/reports\/archives\/([a-f0-9-]{36})$/i);
  if(archive&&method==='GET'){const row=db.prepare('SELECT * FROM monthly_reports WHERE id=?').get(archive[1]);if(!row)throw new HttpError(404,'Archiv nicht gefunden.');return json(res,200,{id:row.id,revision:row.revision,sha256:row.sha256,report:JSON.parse(row.payload)});}
  if(path==='/api/admin/finance/jobs'&&method==='GET'){
   const search=text(url.searchParams.get('search')||'',100),query='%'+search+'%';return json(res,200,{items:db.prepare('SELECT id,title,customer,scheduled_date,state FROM jobs WHERE title LIKE ? OR customer LIKE ? OR id=? ORDER BY scheduled_date DESC,id LIMIT 50').all(query,query,search)});
  }
  if(path==='/api/admin/payments'&&method==='POST'){
   const b=await readJson(req),key=req.headers['idempotency-key'];if(typeof key!=='string'||!uuid.test(key))throw new HttpError(400,'Vorgangsnummer fehlt.');
   if(!b||typeof b.jobId!=='string'||!uuid.test(b.jobId)||!db.prepare('SELECT id FROM jobs WHERE id=?').get(b.jobId))throw new HttpError(400,'Auftrag auswählen.');
  if(!['payment','refund'].includes(b.kind)||!Number.isSafeInteger(b.amountCents)||b.amountCents<1||b.amountCents>100000000||!validDate(b.date)||b.date>dayFormat(config.timeZone).format(new Date(now()))||!['cash','bank','card','other'].includes(b.method))throw new HttpError(400,'Betrag, Zahlungsart und tatsächliches Zahlungsdatum prüfen.');
   const entry={jobId:b.jobId,kind:b.kind,amountCents:b.amountCents,date:b.date,method:b.method,reference:text(b.reference,150),note:text(b.note,500)};
   const fingerprint=hash(JSON.stringify(entry)),old=db.prepare('SELECT * FROM payment_requests WHERE request_key=?').get(key);if(old){if(old.fingerprint!==fingerprint)throw new HttpError(409,'Vorgangsnummer bereits anders verwendet.');return json(res,200,db.prepare('SELECT * FROM payments WHERE id=?').get(old.payment_id));}
   const id=randomUUID();db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO payments(id,job_id,kind,amount_cents,payment_date,method,reference,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,entry.jobId,entry.kind,entry.amountCents,entry.date,entry.method,entry.reference,entry.note,now());db.prepare('INSERT INTO payment_requests VALUES(?,?,?)').run(key,fingerprint,id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return json(res,201,db.prepare('SELECT * FROM payments WHERE id=?').get(id));
  }
  const voidMatch=path.match(/^\/api\/admin\/payments\/([a-f0-9-]{36})\/void$/i);
  if(voidMatch&&method==='POST'){
   const b=await readJson(req),reason=text(b?.reason,500,true);if(reason.length<5)throw new HttpError(400,'Stornogrund mindestens fünf Zeichen.');
   const row=db.prepare('SELECT * FROM payments WHERE id=?').get(voidMatch[1]);if(!row)throw new HttpError(404,'Eintrag nicht gefunden.');if(!row.voided_at)db.prepare('UPDATE payments SET voided_at=?,void_reason=? WHERE id=? AND voided_at IS NULL').run(now(),reason,row.id);return json(res,200,db.prepare('SELECT * FROM payments WHERE id=?').get(row.id));
  }
  throw new HttpError(404,'Nicht gefunden.');
 }
 return {handle,generate};
}
