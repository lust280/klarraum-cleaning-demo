import {randomUUID} from 'node:crypto';
import {HttpError} from './validation.mjs';
export class TeamStore {
 constructor(store){this.db=store.db;this.db.exec(`
 CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE COLLATE NOCASE,region TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,password_hash TEXT,invite_hash TEXT UNIQUE,invite_expires INTEGER,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS employee_sessions(token_hash TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,inquiry_id TEXT REFERENCES inquiries(id) ON DELETE SET NULL,employee_id TEXT NOT NULL REFERENCES employees(id),title TEXT NOT NULL,address TEXT NOT NULL,customer TEXT NOT NULL,contact TEXT NOT NULL,region TEXT NOT NULL,scheduled_date TEXT NOT NULL,scheduled_time TEXT NOT NULL,planned_minutes INTEGER NOT NULL,instructions TEXT NOT NULL,checklist TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'assigned',report TEXT NOT NULL DEFAULT '',review_note TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS jobs_employee_schedule ON jobs(employee_id,scheduled_date,scheduled_time);
 CREATE UNIQUE INDEX IF NOT EXISTS one_running_job_per_employee ON jobs(employee_id) WHERE state='working';
 CREATE TABLE IF NOT EXISTS work_intervals(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,employee_id TEXT NOT NULL REFERENCES employees(id),started_at INTEGER NOT NULL,ended_at INTEGER);
 CREATE UNIQUE INDEX IF NOT EXISTS one_open_interval_per_job ON work_intervals(job_id) WHERE ended_at IS NULL;
 CREATE TABLE IF NOT EXISTS job_events(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,actor TEXT NOT NULL,action TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS job_actions(request_key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS time_corrections(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,minutes INTEGER NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS intervals_job ON work_intervals(job_id,started_at);
 CREATE INDEX IF NOT EXISTS events_job ON job_events(job_id,id);
 CREATE INDEX IF NOT EXISTS corrections_job ON time_corrections(job_id,created_at);
 CREATE INDEX IF NOT EXISTS employee_sessions_account ON employee_sessions(employee_id);
 CREATE INDEX IF NOT EXISTS jobs_state_schedule ON jobs(state,scheduled_date,scheduled_time);
 `);
 const jobColumn=name=>this.db.prepare('PRAGMA table_info(jobs)').all().some(column=>column.name===name);
 if(!jobColumn('signature'))this.db.exec('ALTER TABLE jobs ADD COLUMN signature TEXT');
 if(!jobColumn('tip_cents'))this.db.exec('ALTER TABLE jobs ADD COLUMN tip_cents INTEGER NOT NULL DEFAULT 0');
 if(!jobColumn('onsite_method'))this.db.exec("ALTER TABLE jobs ADD COLUMN onsite_method TEXT NOT NULL DEFAULT ''");
 }
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 employee(id){return this.db.prepare('SELECT * FROM employees WHERE id=?').get(id);}
 publicEmployee(row){return {id:row.id,name:row.name,email:row.email,region:row.region,active:Boolean(row.active),activated:Boolean(row.password_hash),invitationExpires:row.invite_expires};}
 employees(search,offset){const query='%'+search+'%';return {items:this.db.prepare('SELECT * FROM employees WHERE name LIKE ? OR email LIKE ? OR region LIKE ? ORDER BY name,id LIMIT 50 OFFSET ?').all(query,query,query,offset).map(row=>this.publicEmployee(row)),total:this.db.prepare('SELECT COUNT(*) AS n FROM employees WHERE name LIKE ? OR email LIKE ? OR region LIKE ?').get(query,query,query).n};}
 event(jobId,actor,action,note,now){this.db.prepare('INSERT INTO job_events(job_id,actor,action,note,created_at) VALUES(?,?,?,?,?)').run(jobId,actor,action,note,now);}
 job(id){return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);}
 detail(row,now){
  const intervals=this.db.prepare('SELECT * FROM work_intervals WHERE job_id=? ORDER BY started_at,id').all(row.id);
  const corrections=this.db.prepare('SELECT * FROM time_corrections WHERE job_id=? ORDER BY created_at,id').all(row.id);
  const rawMilliseconds=intervals.reduce((sum,item)=>sum+Math.max(0,(item.ended_at??now)-item.started_at),0);
  const correctionMinutes=corrections.reduce((sum,item)=>sum+item.minutes,0);
  const employee=this.employee(row.employee_id);
  const photos=this.db.prepare('SELECT id,width,height FROM job_photos WHERE job_id=? ORDER BY created_at,id').all(row.id).map(photo=>({...photo,url:`/private/jobs/${row.id}/photos/${photo.id}.webp`}));
  return {...row,photos,checklist:JSON.parse(row.checklist),employeeName:employee?.name||'',intervals,corrections,rawMilliseconds,workedMilliseconds:Math.max(0,rawMilliseconds+correctionMinutes*60000),serverNow:now,events:this.db.prepare('SELECT actor,action,note,created_at FROM job_events WHERE job_id=? ORDER BY id').all(row.id)};
 }
 jobs({employeeId='',state='',region='',offset=0},now){
  const where=[],params=[];if(employeeId){where.push('employee_id=?');params.push(employeeId);}if(state){where.push('state=?');params.push(state);}if(region){where.push('region LIKE ?');params.push('%'+region+'%');}
  const suffix=where.length?' WHERE '+where.join(' AND '):'';
  return {items:this.db.prepare('SELECT * FROM jobs'+suffix+" ORDER BY CASE state WHEN 'working' THEN 0 WHEN 'submitted' THEN 1 WHEN 'paused' THEN 2 WHEN 'assigned' THEN 3 ELSE 4 END,scheduled_date,scheduled_time,id LIMIT 50 OFFSET ?").all(...params,offset).map(row=>this.detail(row,now)),total:this.db.prepare('SELECT COUNT(*) AS n FROM jobs'+suffix).get(...params).n};
 }
 createJob(input,now){
  const id=randomUUID();this.db.prepare('INSERT INTO jobs(id,inquiry_id,employee_id,title,address,customer,contact,region,scheduled_date,scheduled_time,planned_minutes,instructions,checklist,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.inquiryId||null,input.employeeId,input.title,input.address,input.customer,input.contact,input.region,input.date,input.time,input.plannedMinutes,input.instructions,JSON.stringify(input.checklist.map(text=>({text,done:false}))),now);
  this.db.prepare('UPDATE jobs SET property_id=?,series_id=?,series_date=? WHERE id=?').run(input.propertyId||null,input.seriesId||null,input.seriesDate||null,id);
  this.event(id,'owner','created','',now);this.onJobCreated?.(this.job(id));return this.detail(this.job(id),now);
 }
 stopInterval(id,now){this.db.prepare('UPDATE work_intervals SET ended_at=? WHERE job_id=? AND ended_at IS NULL').run(now,id);}
 workerAction(id,employeeId,body,now){
  const row=this.job(id);if(!row||row.employee_id!==employeeId)throw new HttpError(404,'Auftrag nicht gefunden.');
  if(row.version!==body.version)throw new HttpError(409,'Auftrag wurde geändert. Bitte aktualisieren.');
  if(body.action==='unavailable'){
   if(row.state!=='assigned')throw new HttpError(409,'Diese Aktion ist im aktuellen Status nicht möglich.');
   const reason=typeof body.reason==='string'?body.reason.trim():'';
   if(reason.length<5||reason.length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(reason))throw new HttpError(400,'Bitte einen Grund mit 5–500 Zeichen angeben.');
   this.db.prepare('UPDATE jobs SET state=?,review_note=?,version=version+1 WHERE id=?').run('cancelled',reason,id);
   this.event(id,employeeId,'unavailable',reason,now);return this.detail(this.job(id),now);
  }
  const next={start:['assigned','working'],pause:['working','paused'],resume:['paused','working'],finish:[['working','paused'],'submitted']}[body.action];
  if(!next||!(Array.isArray(next[0])?next[0]:[next[0]]).includes(row.state))throw new HttpError(409,'Diese Aktion ist im aktuellen Status nicht möglich.');
  if(next[1]==='working'){
   if(this.db.prepare("SELECT id FROM jobs WHERE employee_id=? AND state='working' AND id!=?").get(employeeId,id))throw new HttpError(409,'Ein anderer Auftrag läuft bereits. Diesen zuerst pausieren.');
   this.db.prepare('INSERT INTO work_intervals VALUES(?,?,?,?,NULL)').run(randomUUID(),id,employeeId,now);
  }else this.stopInterval(id,now);
  let checklist=JSON.parse(row.checklist),report=row.report,signature=row.signature||'',tipCents=row.tip_cents||0,onsite=row.onsite_method||'';
  if(body.action==='finish'){
   if(!Array.isArray(body.done)||body.done.length!==checklist.length||body.done.some(x=>typeof x!=='boolean'))throw new HttpError(400,'Checkliste bitte vollständig prüfen.');
   if(typeof body.report!=='string'||body.report.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.report))throw new HttpError(400,'Bericht bitte prüfen (maximal 2000 Zeichen).');
   report=body.report.trim();if(body.done.some(done=>!done)&&!report)throw new HttpError(400,'Für offene Punkte ist eine Erläuterung erforderlich.');checklist=checklist.map((item,index)=>({...item,done:body.done[index]}));
   if(body.signature){
    if(typeof body.signature!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(body.signature)||body.signature.length>120000)throw new HttpError(400,'Unterschrift als PNG speichern.');
    signature=body.signature;
   }
   if(body.tipCents!==undefined){
    if(!Number.isInteger(body.tipCents)||body.tipCents<0||body.tipCents>10000000)throw new HttpError(400,'Trinkgeld prüfen.');
    tipCents=body.tipCents;
   }
   if(body.onsiteMethod){
    if(!['cash','card'].includes(body.onsiteMethod))throw new HttpError(400,'Vor-Ort-Zahlung ist nur Bar oder Karte, ohne Online-Abbuchung.');
    onsite=body.onsiteMethod;
   }
   this.db.prepare('UPDATE jobs SET state=?,checklist=?,report=?,signature=?,tip_cents=?,onsite_method=?,version=version+1 WHERE id=?').run(next[1],JSON.stringify(checklist),report,signature,tipCents,onsite,id);
  }else this.db.prepare('UPDATE jobs SET state=?,checklist=?,report=?,version=version+1 WHERE id=?').run(next[1],JSON.stringify(checklist),report,id);
  this.event(id,employeeId,body.action,'',now);return this.detail(this.job(id),now);
 }
 ownerAction(id,body,now){
  const row=this.job(id);if(!row)throw new HttpError(404,'Auftrag nicht gefunden.');
  if(row.version!==body.version)throw new HttpError(409,'Auftrag wurde geändert. Bitte aktualisieren.');
  let state;
  if(body.action==='approve'&&row.state==='submitted')state='closed';
  else if(body.action==='return'&&row.state==='submitted')state='paused';
  else if(body.action==='cancel'&&!['closed','cancelled'].includes(row.state))state='cancelled';
  else throw new HttpError(409,'Diese Aktion ist im aktuellen Status nicht möglich.');
  const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(reason.length>500||(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(reason))||(['return','cancel'].includes(body.action)&&reason.length<5))throw new HttpError(400,'Bitte einen Grund mit 5–500 Zeichen angeben.');
  this.stopInterval(id,now);this.db.prepare('UPDATE jobs SET state=?,review_note=?,version=version+1 WHERE id=?').run(state,reason,id);this.event(id,'owner',body.action,reason,now);return this.detail(this.job(id),now);
 }
 deactivate(id,now,reason='Mitarbeiterzugang deaktiviert'){
  for(const job of this.db.prepare("SELECT id FROM jobs WHERE employee_id=? AND state='working'").all(id)){this.stopInterval(job.id,now);this.db.prepare("UPDATE jobs SET state='paused',version=version+1 WHERE id=?").run(job.id);this.event(job.id,'owner','account_paused',reason,now);}
  this.db.prepare('DELETE FROM employee_sessions WHERE employee_id=?').run(id);
 }
}
