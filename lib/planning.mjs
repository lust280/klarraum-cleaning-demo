import {randomUUID} from 'node:crypto';
import {HttpError} from './validation.mjs';
import {validDate,localDate} from './reporting.mjs';
import {localInstant,recurrenceDates,shiftDate} from './scheduling.mjs';
import {sendEmployeeNotification,sendAppointmentReminder,sendOpsCustomerMessage} from './mail.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)||(required&&!v.trim()))throw new HttpError(400,'Bitte Angaben prüfen.');return v.trim();};
function page(url){const offset=Number(url.searchParams.get('offset')||0);if(!Number.isInteger(offset)||offset<0||offset>10000000)throw new HttpError(400,'Ungültige Seite.');return offset;}
export class Planning {
 constructor(config,store,data,now){
  this.config=config;this.store=store;this.db=store.db;this.data=data;this.now=now;const db=this.db;
  db.exec(`CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,notes TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS properties(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),name TEXT NOT NULL,address TEXT NOT NULL,region TEXT NOT NULL,instructions TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS properties_customer ON properties(customer_id,name);
  CREATE TABLE IF NOT EXISTS job_series(id TEXT PRIMARY KEY,frequency TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,template TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS employee_notifications(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),job_id TEXT NOT NULL REFERENCES jobs(id),kind TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,due_at INTEGER NOT NULL,mail_status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER,UNIQUE(employee_id,job_id,kind));
  CREATE INDEX IF NOT EXISTS notifications_employee ON employee_notifications(employee_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS notifications_due ON employee_notifications(due_at,mail_status);`);
  for(const [column,type] of [['property_id','TEXT REFERENCES properties(id)'],['series_id','TEXT REFERENCES job_series(id)'],['series_date','TEXT']])if(!db.prepare('PRAGMA table_info(jobs)').all().some(x=>x.name===column))db.exec('ALTER TABLE jobs ADD COLUMN '+column+' '+type);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS series_occurrence ON jobs(series_id,series_date) WHERE series_id IS NOT NULL; CREATE INDEX IF NOT EXISTS jobs_property ON jobs(property_id,scheduled_date);');
  db.exec(`CREATE TABLE IF NOT EXISTS customer_messages(id TEXT PRIMARY KEY,kind TEXT NOT NULL,job_id TEXT,email TEXT NOT NULL,due_at INTEGER NOT NULL,mail_status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER,created_at INTEGER NOT NULL,UNIQUE(kind,job_id));`);
  if(!db.prepare('PRAGMA table_info(customer_messages)').all().some(column=>column.name==='body'))db.exec("ALTER TABLE customer_messages ADD COLUMN body TEXT NOT NULL DEFAULT ''");
 }
 contactEmail(value){const match=String(value||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);return match?match[0]:'';}
 snapshot(body){
  if(!body.propertyId)return null;if(typeof body.propertyId!=='string'||!uuid.test(body.propertyId))throw new HttpError(400,'Objekt prüfen.');
  const p=this.db.prepare('SELECT p.*,c.name AS customer_name,c.email,c.phone,c.active AS customer_active FROM properties p JOIN customers c ON c.id=p.customer_id WHERE p.id=?').get(body.propertyId);
  if(!p?.active||!p.customer_active)throw new HttpError(400,'Aktives Objekt und aktiven Kunden auswählen.');
  return {propertyId:p.id,address:p.address,customer:p.customer_name,contact:[p.phone,p.email].filter(Boolean).join(' · '),region:p.region,instructions:p.instructions};
 }
 conflicts(input,exclude=''){
  const start=localInstant(input.date,input.time,this.config.timeZone),end=start+input.plannedMinutes*60000;
  const rows=this.db.prepare("SELECT id,title,scheduled_date,scheduled_time,planned_minutes FROM jobs WHERE employee_id=? AND id!=? AND state!='cancelled' AND scheduled_date BETWEEN ? AND ? ORDER BY scheduled_date,scheduled_time LIMIT 1001").all(input.employeeId,exclude,shiftDate(input.date,-1),shiftDate(input.date,1));
  if(rows.length>1000)throw new HttpError(422,'Zu viele Termine an diesem Tag.');
  return rows.filter(row=>{try{const other=localInstant(row.scheduled_date,row.scheduled_time,this.config.timeZone);return other<end&&other+row.planned_minutes*60000>start;}catch{return true;}}).map(row=>({id:row.id,date:row.scheduled_date,time:row.scheduled_time,title:row.title}));
 }
 enqueue(job,kind='assigned'){
  const due=this.now(),employee=this.data.employee(job.employee_id);
  const status=this.config.demoMode?'demo':this.config.employeeEmail&&this.config.mail.key&&employee?.email?'pending':'disabled';
  this.db.prepare('INSERT OR IGNORE INTO employee_notifications(id,employee_id,job_id,kind,created_at,due_at,mail_status) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),job.employee_id,job.id,kind==='changed'?'changed-'+job.version:kind,due,due,status);
  this.db.prepare("UPDATE employee_notifications SET mail_status='superseded' WHERE job_id=? AND kind='reminder' AND read_at IS NULL").run(job.id);
  this.db.prepare("DELETE FROM employee_notifications WHERE job_id=? AND kind='reminder'").run(job.id);
  if(job.state==='assigned'){
   let at=0;try{at=localInstant(job.scheduled_date,job.scheduled_time,this.config.timeZone)-3600000;}catch{at=0;}
   if(at>due)this.db.prepare('INSERT INTO employee_notifications(id,employee_id,job_id,kind,created_at,due_at,mail_status) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),job.employee_id,job.id,'reminder',due,at,status);
  }
  this.enqueueCustomerReminder(job);
 }
 enqueueCustomerReminder(job){
  const email=this.contactEmail(job.contact);if(!email||job.state==='cancelled')return;
  let due=this.now();
  try{due=localInstant(job.scheduled_date,job.scheduled_time,this.config.timeZone)-24*3600000;}catch{return;}
  if(due<this.now())due=this.now();
  const ready=!this.config.demoMode&&this.config.mail?.key&&this.config.mail?.from&&this.config.mail.customerReceipt!==false;
  const status=this.config.demoMode?'demo':ready?'pending':'unconfigured';
  this.db.prepare('INSERT OR IGNORE INTO customer_messages(id,kind,job_id,email,due_at,mail_status,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),'reminder',job.id,email,due,status,this.now());
 }
 notifications(employeeId,url){
  const offset=page(url),params=[employeeId,this.now()];const where="employee_id=? AND due_at<=? AND mail_status!='superseded'";
  return {items:this.db.prepare('SELECT id,job_id,kind,created_at,read_at,mail_status FROM employee_notifications WHERE '+where+' ORDER BY due_at DESC,id LIMIT 50 OFFSET ?').all(...params,offset),total:this.db.prepare('SELECT COUNT(*) AS n FROM employee_notifications WHERE '+where).get(...params).n,unread:this.db.prepare('SELECT COUNT(*) AS n FROM employee_notifications WHERE '+where+' AND read_at IS NULL').get(...params).n};
 }
 async flushCustomer(fetcher){
  if(this.config.demoMode||!this.config.mail?.key||!this.config.mail?.from||this.config.mail.customerReceipt===false)return;
  const rows=this.db.prepare("SELECT * FROM customer_messages WHERE mail_status IN ('pending','failed') AND attempts<5 AND due_at<=? AND (last_attempt IS NULL OR last_attempt<?) ORDER BY due_at,id LIMIT 10").all(this.now(),this.now()-60000);
  for(const row of rows){
   if(this.closed)break;
   if(row.kind!=='reminder'){
    let packed={};try{packed=JSON.parse(row.body||'{}');}catch{packed={};}
    if(!packed.text){this.db.prepare("UPDATE customer_messages SET mail_status='superseded' WHERE id=?").run(row.id);continue;}
    this.db.prepare('UPDATE customer_messages SET attempts=attempts+1,last_attempt=? WHERE id=?').run(this.now(),row.id);
    try{await sendOpsCustomerMessage(this.config.mail,{id:row.id,email:row.email,subject:packed.subject,text:packed.text},fetcher);if(!this.closed)this.db.prepare("UPDATE customer_messages SET mail_status='sent' WHERE id=?").run(row.id);}
    catch{if(!this.closed)this.db.prepare("UPDATE customer_messages SET mail_status='failed' WHERE id=?").run(row.id);}
    continue;
   }
   const job=this.data.job(row.job_id);
   if(!job||job.state==='cancelled'){this.db.prepare("UPDATE customer_messages SET mail_status='superseded' WHERE id=?").run(row.id);continue;}
   this.db.prepare('UPDATE customer_messages SET attempts=attempts+1,last_attempt=? WHERE id=?').run(this.now(),row.id);
   try{
    await sendAppointmentReminder(this.config.mail,{id:row.id,jobId:row.job_id,email:row.email,whenLabel:`${job.scheduled_date} ${job.scheduled_time}`},this.config.business?.name||'',this.config.origin,fetcher);
    if(!this.closed)this.db.prepare("UPDATE customer_messages SET mail_status='sent' WHERE id=?").run(row.id);
   }catch{if(!this.closed)this.db.prepare("UPDATE customer_messages SET mail_status='failed' WHERE id=?").run(row.id);}
  }
 }
 async flush(fetcher){
  if(this.closed||this.flushing)return;
  this.flushing=true;
  try{
   await this.flushCustomer(fetcher);
   if(this.config.demoMode||!this.config.employeeEmail||!this.config.mail.key||!this.config.mail.from)return;
   const rows=this.db.prepare("SELECT * FROM employee_notifications WHERE mail_status IN ('pending','failed') AND attempts<5 AND due_at<=? AND (last_attempt IS NULL OR last_attempt<?) ORDER BY due_at,id LIMIT 10").all(this.now(),this.now()-60000);
   for(const row of rows){
    if(this.closed)break;
    const job=this.data.job(row.job_id),employee=this.data.employee(row.employee_id);
    if(!employee?.active||!job||job.employee_id!==employee.id||row.read_at||(row.kind==='reminder'&&job.state!=='assigned')){this.db.prepare("UPDATE employee_notifications SET mail_status='superseded' WHERE id=?").run(row.id);continue;}
    this.db.prepare('UPDATE employee_notifications SET attempts=attempts+1,last_attempt=? WHERE id=?').run(this.now(),row.id);
    try{await sendEmployeeNotification(this.config.mail,employee.email,row,this.config.origin,fetcher);if(!this.closed)this.db.prepare("UPDATE employee_notifications SET mail_status='sent' WHERE id=?").run(row.id);}
    catch{if(!this.closed)this.db.prepare("UPDATE employee_notifications SET mail_status='failed' WHERE id=?").run(row.id);}
   }
  }finally{this.flushing=false;}
 }
 async owner(req,res,url,{readJson,json,idempotent,validateJob}){
  const path=url.pathname,method=req.method,db=this.db;
  if(['/api/admin/customers','/api/admin/properties'].includes(path)&&method==='GET'){
   const customer=path.endsWith('/customers'),search='%'+text(url.searchParams.get('search')||'',100)+'%',offset=page(url),table=customer?'customers':'properties';
   const where=customer?'name LIKE ? OR email LIKE ? OR phone LIKE ?':'name LIKE ? OR address LIKE ? OR region LIKE ?';
   return json(res,200,{items:db.prepare('SELECT * FROM '+table+' WHERE '+where+' ORDER BY name,id LIMIT 50 OFFSET ?').all(search,search,search,offset),total:db.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE '+where).get(search,search,search).n});
  }
  const single=path.match(/^\/api\/admin\/(customers|properties)\/([a-f0-9-]{36})$/i);
  if(single&&method==='GET'){if(!uuid.test(single[2]))throw new HttpError(404,'Eintrag fehlt.');const row=db.prepare('SELECT * FROM '+single[1]+' WHERE id=?').get(single[2]);if(!row)throw new HttpError(404,'Eintrag fehlt.');return json(res,200,row);}
  const record=path.match(/^\/api\/admin\/(customers|properties)(?:\/([a-f0-9-]{36}))?$/i);
  if(record&&['POST','PUT'].includes(method)){
   if((method==='POST'&&record[2])||(method==='PUT'&&!uuid.test(record[2]||'')))throw new HttpError(400,'Ungültige Adresse.');
   const b=await readJson(req);if(!b||typeof b!=='object')throw new HttpError(400,'Angaben fehlen.');
   const isCustomer=record[1]==='customers',id=record[2]||randomUUID(),old=record[2]?db.prepare('SELECT * FROM '+record[1]+' WHERE id=?').get(id):null;
   if(record[2]&&!old)throw new HttpError(404,'Eintrag fehlt.');if(old&&(!Number.isInteger(b.version)||b.version!==old.version))throw new HttpError(409,'Eintrag wurde geändert. Bitte neu laden.');
   if(typeof b.active!=='boolean')throw new HttpError(400,'Aktivstatus erforderlich.');
   let values;
   if(isCustomer){
    const email=text(b.email,254),phone=text(b.phone,80);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'E-Mail-Adresse prüfen.');if(this.config.demoMode&&email&&!email.endsWith('.invalid'))throw new HttpError(400,'Demo: Nur erfundene E-Mail-Adressen mit .invalid verwenden.');
    values=[text(b.name,100,true),email,phone,text(b.notes,2000),b.active?1:0];
   }else{
    const c=typeof b.customerId==='string'&&uuid.test(b.customerId)?db.prepare('SELECT * FROM customers WHERE id=?').get(b.customerId):null;if(!c)throw new HttpError(400,'Kunden auswählen.');
    values=[c.id,text(b.name,120,true),text(b.address,250,true),text(b.region,100,true),text(b.instructions,2000),b.active?1:0];
   }
   const cols=isCustomer?['name','email','phone','notes','active']:['customer_id','name','address','region','instructions','active'];
   return json(res,old?200:201,idempotent(req,'owner',{record:record[1],id:record[2]||null,version:b.version??null,values},()=>{
    if(old){const result=db.prepare('UPDATE '+record[1]+' SET '+cols.map(c=>c+'=?').join(',')+',version=version+1 WHERE id=? AND version=?').run(...values,id,b.version);if(!result.changes)throw new HttpError(409,'Eintrag wurde geändert.');}
    else db.prepare('INSERT INTO '+record[1]+'(id,'+cols.join(',')+',created_at) VALUES('+Array(cols.length+2).fill('?').join(',')+')').run(id,...values,this.now());
    return db.prepare('SELECT * FROM '+record[1]+' WHERE id=?').get(id);
   }));
  }
  const property=path.match(/^\/api\/admin\/properties\/([a-f0-9-]{36})\/history$/i);
  if(property&&method==='GET'){
   if(!uuid.test(property[1])||!db.prepare('SELECT id FROM properties WHERE id=?').get(property[1]))throw new HttpError(404,'Objekt fehlt.');
   return json(res,200,{items:db.prepare('SELECT id,title,address,customer,scheduled_date,scheduled_time,state,planned_minutes FROM jobs WHERE property_id=? ORDER BY scheduled_date DESC,id LIMIT 50 OFFSET ?').all(property[1],page(url)),total:db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE property_id=?').get(property[1]).n});
  }
  if(path==='/api/admin/calendar'&&method==='GET'){
   const from=url.searchParams.get('from'),to=url.searchParams.get('to'),employee=url.searchParams.get('employee')||'';
   if(!validDate(from)||!validDate(to)||to<from||Date.parse(to)-Date.parse(from)>42*86400000||(employee&&!uuid.test(employee)))throw new HttpError(400,'Kalenderzeitraum bis zu 43 Tagen wählen.');
   const rows=db.prepare('SELECT j.*,e.name AS employeeName FROM jobs j JOIN employees e ON e.id=j.employee_id WHERE scheduled_date BETWEEN ? AND ?'+(employee?' AND employee_id=?':'')+' ORDER BY scheduled_date,scheduled_time,id LIMIT 2001').all(from,to,...(employee?[employee]:[]));
   if(rows.length>2000)throw new HttpError(422,'Zu viele Termine. Bitte kürzeren Zeitraum oder einen Mitarbeiter wählen.');
   return json(res,200,{from,to,timezone:this.config.timeZone,items:rows.map(row=>({id:row.id,title:row.title,date:row.scheduled_date,time:row.scheduled_time,minutes:row.planned_minutes,employeeId:row.employee_id,employeeName:row.employeeName,state:row.state,seriesId:row.series_id,...(()=>{try{return {scheduleInvalid:false,conflicts:row.state==='cancelled'?[]:this.conflicts({employeeId:row.employee_id,date:row.scheduled_date,time:row.scheduled_time,plannedMinutes:row.planned_minutes},row.id)};}catch(error){if(error.status===400)return {scheduleInvalid:true,conflicts:[]};throw error;}})()}))});
  }
  if(path==='/api/admin/schedule-check'&&method==='POST'){const b=await readJson(req),input=validateJob(b);const dates=b.frequency&&b.frequency!=='once'?recurrenceDates(input.date,b.endDate,b.frequency):[input.date];if(b.excludeId&&!uuid.test(b.excludeId))throw new HttpError(400,'Auftragsnummer prüfen.');return json(res,200,{dates,warnings:dates.flatMap(date=>this.conflicts({...input,date},b.excludeId||'').map(conflict=>({date,...conflict}))) });}
  if(path==='/api/admin/series'&&method==='POST'){
   const b=await readJson(req),input=validateJob(b),dates=recurrenceDates(input.date,b?.endDate,b?.frequency);
   for(const date of dates)localInstant(date,input.time,this.config.timeZone);
   return json(res,201,idempotent(req,'owner',{series:input,dates,frequency:b.frequency},()=>{
    const id=randomUUID();db.prepare('INSERT INTO job_series(id,frequency,start_date,end_date,template,created_at) VALUES(?,?,?,?,?,?)').run(id,b.frequency,input.date,b.endDate,JSON.stringify(input),this.now());
    const items=dates.map(date=>{const payload={...input,date,seriesId:id,seriesDate:date};const conflicts=this.conflicts(payload);return {...this.data.createJob(payload,this.now()),scheduleWarnings:conflicts};});
    return {id,frequency:b.frequency,startDate:input.date,endDate:b.endDate,version:1,items};
   }));
  }
  if(path==='/api/admin/series'&&method==='GET')return json(res,200,{items:db.prepare('SELECT id,frequency,start_date,end_date,version FROM job_series ORDER BY created_at DESC,id LIMIT 50 OFFSET ?').all(page(url)),total:db.prepare('SELECT COUNT(*) AS n FROM job_series').get().n});
  const series=path.match(/^\/api\/admin\/series\/([a-f0-9-]{36})\/cancel-future$/i);
  if(series&&method==='POST'){
   const b=await readJson(req),reason=text(b?.reason,500,true);if(!uuid.test(series[1])||!validDate(b?.from)||b.from<localDate(this.now(),this.config.timeZone)||reason.length<5||!Number.isInteger(b?.version))throw new HttpError(400,'Ab heute, Serienversion und Grund (mindestens 5 Zeichen) angeben.');
   return json(res,200,idempotent(req,'owner',{cancelSeries:series[1],body:b},()=>{
    const current=db.prepare('SELECT * FROM job_series WHERE id=?').get(series[1]);if(!current)throw new HttpError(404,'Serie fehlt.');if(current.version!==b.version)throw new HttpError(409,'Serie wurde geändert. Bitte aktualisieren.');
    const rows=db.prepare("SELECT * FROM jobs WHERE series_id=? AND scheduled_date>=? AND state='assigned' AND NOT EXISTS(SELECT 1 FROM work_intervals WHERE job_id=jobs.id)").all(current.id,b.from);
    for(const row of rows){db.prepare("UPDATE jobs SET state='cancelled',review_note=?,version=version+1 WHERE id=?").run(reason,row.id);this.data.event(row.id,'owner','cancel',reason,this.now());this.enqueue(this.data.job(row.id),'changed');}
    db.prepare('UPDATE job_series SET version=version+1 WHERE id=?').run(current.id);return {cancelled:rows.length,version:current.version+1};
   }));
  }
  throw new HttpError(404,'Nicht gefunden.');
 }
}
