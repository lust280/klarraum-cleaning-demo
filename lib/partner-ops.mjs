import {randomUUID} from 'node:crypto';
import {HttpError} from './validation.mjs';
import {JOB_PHOTO_LIMIT} from './job-photos.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const services=['home','office','deep'];
const declineReasons=new Set(['','fully_booked','outside_area','other']);
const STATUSES=['new','accepted','assigned','in_progress','done','declined','cancelled'];
const CHAIN=['new','accepted','assigned','in_progress','done'];

function text(value,max,required=false){
 if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||(required&&!value.trim()))throw new HttpError(400,'Check the job details.');
 return value.trim();
}
function localDate(now,timeZone){
 return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
function addDays(date,days){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
function labelDate(date,timeZone){
 const [year,month,day]=date.split('-').map(Number);
 return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone}).format(new Date(Date.UTC(year,month-1,day,12)));
}
function clock(ms,timeZone){
 return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone}).format(new Date(ms));
}
function durationLabel(ms){
 const total=Math.max(0,Math.round(ms/60000)),h=Math.floor(total/60),m=total%60;
 if(!h)return `${m} min`;
 return `${h} h ${m} min`;
}
function pdfDocument(lines){
 const safe=lines.map(line=>String(line).replace(/[^\x20-\x7e]/g,'?').replace(/[()\\]/g,ch=>'\\'+ch));
 let body='BT /F1 11 Tf 48 800 Td 14 TL\n';
 for(const line of safe)body+=`(${line}) '\n`;
 body+='ET';
 const objects=[
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
  '2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
  `4 0 obj << /Length ${Buffer.byteLength(body)} >> stream\n${body}\nendstream endobj\n`,
  '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
 ];
 let pdf='%PDF-1.4\n',offsets=[0];
 for(const object of objects){offsets.push(Buffer.byteLength(pdf));pdf+=object;}
 const xref=Buffer.byteLength(pdf);
 pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 for(let i=1;i<offsets.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
 pdf+=`trailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(pdf);
}

export function createPartnerOps({config,store,data,planning,now}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS ops_requests (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL,
  inquiry_id TEXT UNIQUE,
  job_id TEXT UNIQUE,
  service TEXT NOT NULL,
  service_title TEXT NOT NULL,
  area_m2 INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  rate_cents INTEGER NOT NULL,
  address TEXT NOT NULL,
  customer TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT NOT NULL,
  planned_minutes INTEGER NOT NULL,
  region TEXT NOT NULL DEFAULT 'Berlin',
  status TEXT NOT NULL,
  decline_reason TEXT NOT NULL DEFAULT '',
  decline_message TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
 ); CREATE INDEX IF NOT EXISTS ops_requests_schedule ON ops_requests(scheduled_date, scheduled_time);`);
 const timeZone=config.timeZone||'Europe/Berlin';
 const currency=config.currency||'EUR';

 function siteTitle(service){
  try{return store.site().content.services[service]?.title;}catch{return '';}
 }
 function rateCents(service){
  const rate=store.pricing()?.rates?.[service];
  if(typeof rate!=='number'||!Number.isFinite(rate))throw new HttpError(400,'Choose Home, Office or Deep cleaning.');
  return Math.round(rate*100);
 }
 function statusOf(row,job){
  if(row.status==='declined')return 'declined';
  if(row.status==='cancelled'||job?.state==='cancelled')return 'cancelled';
  if(!job)return row.status==='accepted'?'accepted':'new';
  if(job.state==='working'||job.state==='paused')return 'in_progress';
  if(job.state==='submitted'||job.state==='closed')return 'done';
  if(job.state==='assigned')return 'assigned';
  return row.status;
 }
 function nextRef(){
  const n=db.prepare('SELECT COUNT(*) AS n FROM ops_requests').get().n+2001;
  return 'KR-'+n;
 }
 function rowById(id){
  return db.prepare('SELECT * FROM ops_requests WHERE id=?').get(id)||db.prepare('SELECT * FROM ops_requests WHERE job_id=?').get(id);
 }
 function materializeJob(job){
  const found=db.prepare('SELECT * FROM ops_requests WHERE job_id=?').get(job.id);
  if(found)return found;
  const service=services.find(key=>siteTitle(key)===job.title)||'home';
  db.prepare(`INSERT INTO ops_requests(id,ref,inquiry_id,job_id,service,service_title,area_m2,price_cents,rate_cents,address,customer,phone,email,notes,scheduled_date,scheduled_time,planned_minutes,region,status,version,created_at)
   VALUES(?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(job.id,nextRef(),job.id,service,job.title,0,0,0,job.address,job.customer,job.contact,'',job.instructions,job.scheduled_date,job.scheduled_time,job.planned_minutes,job.region||'Berlin',job.state==='cancelled'?'cancelled':'assigned',job.version||1,job.created_at||now());
  return db.prepare('SELECT * FROM ops_requests WHERE id=?').get(job.id);
 }
 function must(id){
  if(!uuid.test(id))throw new HttpError(400,'Job not found.');
  const row=rowById(id);
  if(row)return row;
  const job=data.job(id);
  if(!job)throw new HttpError(404,'Job not found.');
  return materializeJob(job);
 }
 function present(row){
  const job=row.job_id?data.job(row.job_id):null;
  const detail=job?data.detail(job,now()):null;
  const status=statusOf(row,job);
  const worker=detail?.employee_id?{id:detail.employee_id,name:detail.employeeName}:{id:null,name:''};
  if(!worker.id)worker.name='';
  const report=detail&&status==='done'?reportOf(row,detail):null;
  return {
   id:row.id,ref:row.ref,status,service:row.service,serviceTitle:row.service_title,areaM2:row.area_m2,priceCents:row.price_cents,rateCents:row.rate_cents,currency,
   address:row.address,customer:row.customer,phone:row.phone,email:row.email,notes:row.notes,
   date:row.scheduled_date,time:row.scheduled_time,dateLabel:labelDate(row.scheduled_date,timeZone),plannedMinutes:row.planned_minutes,
   worker:worker.id?worker:null,version:row.version,jobId:row.job_id,photoLimit:JOB_PHOTO_LIMIT,
   photos:detail?.photos||[],report,declineReason:row.decline_reason,declineMessage:row.decline_message,
   chain:CHAIN,step:CHAIN.indexOf(status),
  };
 }
 function reportOf(row,detail){
  const finish=detail.events?.find(event=>event.action==='finish');
  const start=detail.intervals?.[0]?.started_at;
  const end=detail.intervals?.at(-1)?.ended_at||finish?.created_at||null;
  return {
   note:detail.report||'',
   signature:detail.signature||'',
   signedBy:detail.signature?row.customer:'',
   signedAt:detail.signature&&finish?clock(finish.created_at,timeZone):'',
   onsiteMethod:detail.onsite_method||'',
   tipCents:detail.tip_cents||0,
   startedAt:start?clock(start,timeZone):'',
   endedAt:end?clock(end,timeZone):'',
   durationLabel:durationLabel(detail.workedMilliseconds||0),
   photoCount:detail.photos.length,
  };
 }
 function workersFor(row,excludeJobId=''){
  const people=db.prepare('SELECT id,name FROM employees WHERE active=1 ORDER BY name,id').all();
  return people.map(person=>{
   const conflicts=planning.conflicts({employeeId:person.id,date:row.scheduled_date,time:row.scheduled_time,plannedMinutes:row.planned_minutes},excludeJobId);
   return {id:person.id,name:person.name,availability:conflicts.length?'busy':'free'};
  });
 }
 function queueMail(row,kind,subject,text){
  if(!row.email)return {emailQueued:false,reason:'no_email'};
  const mailStatus=config.demoMode?'demo':config.mail?.key&&config.mail?.from?'pending':'unconfigured';
  db.prepare('INSERT OR IGNORE INTO customer_messages(id,kind,job_id,email,due_at,mail_status,created_at,body) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),kind,row.id,row.email,now(),mailStatus,now(),JSON.stringify({subject,text}));
  return {emailQueued:mailStatus==='pending'||mailStatus==='demo',mailStatus};
 }
 function listRows(){
  const requests=db.prepare('SELECT * FROM ops_requests ORDER BY scheduled_date, scheduled_time, id').all();
  const linked=new Set(requests.map(row=>row.job_id).filter(Boolean));
  const orphans=db.prepare('SELECT * FROM jobs ORDER BY scheduled_date, scheduled_time, id').all().filter(job=>!linked.has(job.id));
  return requests.concat(orphans.map(job=>({
   id:job.id,ref:'',inquiry_id:job.inquiry_id,job_id:job.id,service:'home',service_title:job.title,area_m2:0,price_cents:0,rate_cents:0,
   address:job.address,customer:job.customer,phone:job.contact,email:'',notes:job.instructions,scheduled_date:job.scheduled_date,scheduled_time:job.scheduled_time,
   planned_minutes:job.planned_minutes,region:job.region,status:job.state==='cancelled'?'cancelled':'assigned',decline_reason:'',decline_message:'',version:job.version,created_at:job.created_at,
  })));
 }
 function inRange(item,range,today){
  if(range==='today')return item.date===today||item.status==='new';
  if(range==='week')return item.date>=today&&item.date<=addDays(today,6);
  if(range==='month')return item.date.slice(0,7)===today.slice(0,7);
  return true;
 }
 function captureInquiry(raw){
  const payload=JSON.parse(raw.payload);
  if(db.prepare('SELECT id FROM ops_requests WHERE inquiry_id=?').get(raw.id))return;
  const service=services.includes(payload.service)?payload.service:'home';
  const area=Number.isInteger(payload.area)?payload.area:70;
  const priceCents=Math.round(Number(payload.price)*100);
  const rate=rateCents(service);
  const date=/^\d{4}-\d{2}-\d{2}$/.test(payload.date||'')?payload.date:localDate(now(),timeZone);
  const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(payload.preferredTime||'')?payload.preferredTime:'09:00';
  const address=text(String(payload.address||payload.postcode||'Berlin'),250)||'Berlin';
  db.prepare(`INSERT INTO ops_requests(id,ref,inquiry_id,job_id,service,service_title,area_m2,price_cents,rate_cents,address,customer,phone,email,notes,scheduled_date,scheduled_time,planned_minutes,region,status,created_at)
   VALUES(?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),nextRef(),raw.id,service,payload.serviceTitle||siteTitle(service)||'Home cleaning',area,Number.isFinite(priceCents)?priceCents:area*rate,rate,address,text(String(payload.name||'Customer'),100)||'Customer',text(String(payload.phone||''),40),text(String(payload.email||''),254),text(String(payload.message||''),2000),date,time,120,'Berlin','new',raw.created_at||now());
 }
 function validateDraft(body,existing){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Job details are missing.');
  if(body.employeeIds||Array.isArray(body.employeeId)||Array.isArray(body.workers))throw new HttpError(400,'Exactly one worker per job.');
  const service=body.service??existing?.service;
  if(!services.includes(service))throw new HttpError(400,'Choose Home, Office or Deep cleaning.');
  const area=body.areaM2??existing?.area_m2;
  if(!Number.isInteger(area)||area<20||area>1000)throw new HttpError(400,'Area must be a whole number of m² from 20 to 1000.');
  const date=text(body.date??existing?.scheduled_date??'',10,true);
  const time=text(body.time??existing?.scheduled_time??'',5,true);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw new HttpError(400,'Use a date and 24-hour time.');
  const address=text(body.address??existing?.address??'',250,true);
  const customer=text(body.customer??existing?.customer??'',100,true);
  const phone=text(body.phone??existing?.phone??'',40);
  const notes=text(body.notes??existing?.notes??'',2000);
  let employeeId;
  if(!Object.hasOwn(body,'employeeId'))employeeId=existing?undefined:null;
  else if(body.employeeId===''||body.employeeId===null)employeeId=null;
  else employeeId=body.employeeId;
  if(employeeId!==undefined&&employeeId!==null&&(typeof employeeId!=='string'||!uuid.test(employeeId)||!data.employee(employeeId)?.active))throw new HttpError(400,'Choose one active worker or leave the job unassigned.');
  const rate=existing&&existing.service===service?existing.rate_cents:rateCents(service);
  return {service,serviceTitle:siteTitle(service)||service,area,date,time,address,customer,phone,notes,employeeId,rate,priceCents:area*rate};
 }
 function writeJob(row,draft,employeeId){
  const created=data.createJob({employeeId,inquiryId:row.inquiry_id,title:draft?.serviceTitle||row.service_title,address:draft?.address||row.address,customer:draft?.customer||row.customer,contact:[draft?.phone||row.phone,draft?.email||row.email].filter(Boolean).join(' · '),region:row.region||'Berlin',date:draft?.date||row.scheduled_date,time:draft?.time||row.scheduled_time,plannedMinutes:row.planned_minutes||120,instructions:draft?.notes??row.notes,checklist:['Clean the space']},now());
  return created;
 }

 return {
  captureInquiry,STATUSES,photoLimit:JOB_PHOTO_LIMIT,
  availability(url){
   const date=url.searchParams.get('date')||'',time=url.searchParams.get('time')||'',minutes=Number(url.searchParams.get('minutes')||120),exclude=url.searchParams.get('exclude')||'';
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)||!Number.isInteger(minutes)||minutes<15||minutes>1440)throw new HttpError(400,'Use a date and 24-hour time.');
   if(exclude&&!uuid.test(exclude))throw new HttpError(400,'Job not found.');
   return {workers:workersFor({scheduled_date:date,scheduled_time:time,planned_minutes:minutes},exclude)};
  },
  today(){
   const today=localDate(now(),timeZone);
   const items=listRows().map(present).filter(item=>item.status!=='declined');
   const jobs=items.filter(item=>item.date===today&&item.status!=='cancelled');
   const attention=items.filter(item=>item.status==='new');
   const out=jobs.filter(item=>item.worker&&['assigned','in_progress','done'].includes(item.status));
   const names=new Set(out.map(item=>item.worker.id));
   return {date:today,label:labelDate(today,timeZone),currency,photoLimit:JOB_PHOTO_LIMIT,counts:{newRequests:attention.length,jobsToday:jobs.length,workersOut:names.size},attention,jobs,workersOut:out.map(item=>({name:item.worker.name,summary:`${item.serviceTitle}, ${item.address}`}))};
  },
  list(url){
   const status=url.searchParams.get('status')||'';
   const range=url.searchParams.get('range')||'';
   if(status&&!STATUSES.includes(status))throw new HttpError(400,'Unknown status.');
   if(range&&!['today','week','month'].includes(range))throw new HttpError(400,'Unknown range.');
   const today=localDate(now(),timeZone);
   let items=listRows().map(present);
   if(status)items=items.filter(item=>item.status===status);
   if(range)items=items.filter(item=>inRange(item,range,today));
   return {items,total:items.length,currency,photoLimit:JOB_PHOTO_LIMIT,statuses:STATUSES};
  },
  detail(id){
   const row=must(id),view=present(row);
   const jobId=row.job_id||'';
   view.workers=workersFor(row,jobId).map(worker=>({id:worker.id,name:worker.name,availability:worker.availability}));
   if(view.worker)view.worker.availability=view.workers.find(worker=>worker.id===view.worker.id)?.availability||'free';
   return view;
  },
  receiveNew(input){
   const service=services.includes(input?.service)?input.service:'home';
   const area=Number.isInteger(input?.areaM2)&&input.areaM2>=1&&input.areaM2<=100000?input.areaM2:70;
   const rate=Number.isInteger(input?.rateCents)&&input.rateCents>0?input.rateCents:rateCents(service);
   const price=Number.isInteger(input?.priceCents)&&input.priceCents>=0?input.priceCents:area*rate;
   const date=/^\d{4}-\d{2}-\d{2}$/.test(input?.date||'')?input.date:localDate(now(),timeZone);
   const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input?.time||'')?input.time:'09:00';
   const address=text(String(input?.address||''),250,true);
   const customer=text(String(input?.customer||'Customer'),100,true);
   const phone=text(String(input?.phone||''),40);
   const email=text(String(input?.email||''),254);
   const notes=text(String(input?.notes||''),2000);
   const title=text(String(input?.serviceTitle||siteTitle(service)||'Home cleaning'),150)||'Home cleaning';
   const minutes=Number.isInteger(input?.plannedMinutes)&&input.plannedMinutes>=15&&input.plannedMinutes<=1440?input.plannedMinutes:120;
   const region=text(String(input?.region||'Berlin'),100)||'Berlin';
   const id=randomUUID();
   db.prepare(`INSERT INTO ops_requests(id,ref,inquiry_id,job_id,service,service_title,area_m2,price_cents,rate_cents,address,customer,phone,email,notes,scheduled_date,scheduled_time,planned_minutes,region,status,created_at)
    VALUES(?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,nextRef(),service,title,area,price,rate,address,customer,phone,email,notes,date,time,minutes,region,'new',now());
   return this.detail(id);
  },
  create(body){
   const draft=validateDraft(body,null);
   const id=randomUUID();
   db.prepare(`INSERT INTO ops_requests(id,ref,inquiry_id,job_id,service,service_title,area_m2,price_cents,rate_cents,address,customer,phone,email,notes,scheduled_date,scheduled_time,planned_minutes,region,status,created_at)
    VALUES(?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,nextRef(),draft.service,draft.serviceTitle,draft.area,draft.priceCents,draft.rate,draft.address,draft.customer,draft.phone,'',draft.notes,draft.date,draft.time,120,'Berlin','accepted',now());
   if(draft.employeeId)this.assign(id,{employeeId:draft.employeeId,version:1});
   return this.detail(id);
  },
  update(id,body){
   const row=must(id);
   if(!Number.isInteger(body?.version)||body.version!==row.version)throw new HttpError(409,'This job changed. Refresh and try again.');
   const job=row.job_id?data.job(row.job_id):null;
   const status=statusOf(row,job);
   if(['declined','cancelled','done','in_progress'].includes(status))throw new HttpError(409,'This job can no longer be edited.');
   const draft=validateDraft(body,row);
   db.prepare(`UPDATE ops_requests SET service=?,service_title=?,area_m2=?,price_cents=?,rate_cents=?,address=?,customer=?,phone=?,notes=?,scheduled_date=?,scheduled_time=?,version=version+1 WHERE id=?`).run(draft.service,draft.serviceTitle,draft.area,draft.priceCents,draft.rate,draft.address,draft.customer,draft.phone,draft.notes,draft.date,draft.time,row.id);
   if(job&&job.state==='assigned'){
    db.prepare('UPDATE jobs SET title=?,address=?,customer=?,contact=?,scheduled_date=?,scheduled_time=?,instructions=?,version=version+1 WHERE id=?').run(draft.serviceTitle,draft.address,draft.customer,[draft.phone,row.email].filter(Boolean).join(' · '),draft.date,draft.time,draft.notes,job.id);
    planning.enqueue(data.job(job.id),'changed');
   }
   const current=db.prepare('SELECT * FROM ops_requests WHERE id=?').get(row.id);
   if(typeof draft.employeeId==='string'&&draft.employeeId!==job?.employee_id)this.assign(current.id,{employeeId:draft.employeeId,version:current.version});
   else if(draft.employeeId===null&&status==='assigned')throw new HttpError(400,'Cancel the job instead of removing its only worker.');
   return this.detail(row.id);
  },
  accept(id,body){
   const row=must(id);
   if(!Number.isInteger(body?.version)||body.version!==row.version)throw new HttpError(409,'This job changed. Refresh and try again.');
   if(statusOf(row,row.job_id?data.job(row.job_id):null)!=='new')throw new HttpError(409,'Only a new request can be accepted.');
   db.prepare("UPDATE ops_requests SET status='accepted', version=version+1 WHERE id=?").run(row.id);
   if(row.inquiry_id&&store.get(row.inquiry_id))store.setStatus(row.inquiry_id,'confirmed');
   const view=this.detail(row.id);
   const mail=queueMail(row,'accepted',`Request accepted · ${row.ref}`,`Hello ${row.customer},\n\nYour cleaning request ${row.ref} is accepted. The visit is not assigned to a worker yet.\n\nNo charge has been taken online. Payment on site is arranged with the company.\n`);
   return {...view,...mail};
  },
  decline(id,body){
   const row=must(id);
   if(!Number.isInteger(body?.version)||body.version!==row.version)throw new HttpError(409,'This job changed. Refresh and try again.');
   const status=statusOf(row,row.job_id?data.job(row.job_id):null);
   if(!['new','accepted'].includes(status))throw new HttpError(409,'Only an incoming request can be declined.');
   const reason=body.reason===undefined?'':body.reason;
   if(typeof reason!=='string'||!declineReasons.has(reason))throw new HttpError(400,'Choose a decline reason or leave it empty.');
   const message=text(typeof body.message==='string'?body.message:'',500);
   db.prepare("UPDATE ops_requests SET status='declined', decline_reason=?, decline_message=?, version=version+1 WHERE id=?").run(reason,message,row.id);
   if(row.inquiry_id)store.setNote(row.inquiry_id,['Declined',reason,message].filter(Boolean).join(' · ').slice(0,2000));
   const reasonLabel={fully_booked:'Fully booked',outside_area:'Outside service area',other:'Other'}[reason]||'';
   const mail=queueMail(row,'declined',`Request declined · ${row.ref}`,`Hello ${row.customer},\n\nThe company cannot take request ${row.ref}${reasonLabel?` (${reasonLabel})`:''}.\n${message?message+'\n':''}\nNo charge. Nothing was paid online.\n`);
   return {...this.detail(row.id),...mail};
  },
  assign(id,body){
   if(!body||body.employeeIds||Array.isArray(body.employeeId)||Array.isArray(body.workers))throw new HttpError(400,'Exactly one worker per job.');
   if(typeof body.employeeId!=='string'||!uuid.test(body.employeeId))throw new HttpError(400,'Choose one worker.');
   const row=must(id);
   if(!Number.isInteger(body.version)||body.version!==row.version)throw new HttpError(409,'This job changed. Refresh and try again.');
   const job=row.job_id?data.job(row.job_id):null;
   const status=statusOf(row,job);
   if(status==='new')throw new HttpError(409,'Accept the request before assigning a worker.');
   if(!['accepted','assigned'].includes(status))throw new HttpError(409,'This job cannot be assigned now.');
   const employee=data.employee(body.employeeId);
   if(!employee?.active)throw new HttpError(400,'Choose one active worker.');
   if(job&&job.state!=='assigned')throw new HttpError(409,'Reassign is only available before the job starts.');
   if(job?.employee_id===employee.id)throw new HttpError(409,'This worker is already assigned.');
   const warnings=planning.conflicts({employeeId:employee.id,date:row.scheduled_date,time:row.scheduled_time,plannedMinutes:row.planned_minutes},job?.id||'');
   if(!job){
    const created=writeJob(row,null,employee.id);
    db.prepare("UPDATE ops_requests SET job_id=?, status='assigned', version=version+1 WHERE id=?").run(created.id,row.id);
   }else{
    const previous=job.employee_id;
    const moved=db.prepare('UPDATE jobs SET employee_id=?, version=version+1 WHERE id=? AND state=?').run(employee.id,job.id,'assigned');
    if(!moved.changes)throw new HttpError(409,'Reassign is only available before the job starts.');
    db.prepare("UPDATE employee_notifications SET mail_status='superseded', read_at=? WHERE job_id=? AND employee_id=? AND read_at IS NULL").run(now(),job.id,previous);
    planning.enqueue(data.job(job.id),'changed');
    db.prepare("UPDATE ops_requests SET status='assigned', version=version+1 WHERE id=?").run(row.id);
   }
   const view=this.detail(row.id);
   view.scheduleWarnings=warnings;
   return view;
  },
  cancel(id,body){
   const row=must(id);
   if(!Number.isInteger(body?.version)||body.version!==row.version)throw new HttpError(409,'This job changed. Refresh and try again.');
   const job=row.job_id?data.job(row.job_id):null;
   const status=statusOf(row,job);
   if(['declined','cancelled','done'].includes(status))throw new HttpError(409,'This job cannot be cancelled.');
   if(job)data.ownerAction(job.id,{action:'cancel',version:job.version,reason:'Cancelled by the company'},now());
   db.prepare("UPDATE ops_requests SET status='cancelled', version=version+1 WHERE id=?").run(row.id);
   let mail={emailQueued:false};
   if(body.notifyCustomer!==false)mail=queueMail({...row},'cancelled',`Appointment cancelled · ${row.ref}`,`Hello ${row.customer},\n\nAppointment ${row.ref} on ${row.scheduled_date} ${row.scheduled_time} was cancelled.\n\nNo charge. Nothing was paid online.\n`);
   return {...this.detail(row.id),...mail};
  },
  start(id,body){
   const row=must(id);
   if(!Number.isInteger(body?.version)||body.version!==row.version)throw new HttpError(409,'This job changed. Refresh and try again.');
   const job=row.job_id?data.job(row.job_id):null;
   if(statusOf(row,job)!=='assigned'||!job)throw new HttpError(409,'Start is available after one worker is assigned.');
   data.workerAction(job.id,job.employee_id,{action:'start',version:job.version},now());
   return this.detail(row.id);
  },
  complete(id,body){
   const row=must(id);
   if(!Number.isInteger(body?.version)||body.version!==row.version)throw new HttpError(409,'This job changed. Refresh and try again.');
   const job=row.job_id?data.job(row.job_id):null;
   if(statusOf(row,job)!=='in_progress'||!job)throw new HttpError(409,'Done is available while the job is in progress.');
   const checklist=JSON.parse(job.checklist);
   data.workerAction(job.id,job.employee_id,{action:'finish',version:job.version,done:checklist.map(()=>true),report:job.report||'Marked done.'},now());
   return this.detail(row.id);
  },
  sendReport(id){
   const view=this.detail(id);
   if(view.status!=='done'||!view.report)throw new HttpError(409,'A finished job report is required.');
   const row=must(id);
   const mail=queueMail(row,'report',`Cleaning report · ${row.ref}`,`Hello ${row.customer},\n\nThe visit ${row.ref} is done (${view.report.durationLabel}).\n${view.report.note?view.report.note+'\n':''}${view.report.onsiteMethod?`Paid on site: ${view.report.onsiteMethod}.\n`:''}\nNo online payment was taken.\n`);
   return {...view,...mail};
  },
  pdf(id){
   const view=this.detail(id);
   const lines=[
    'KlarraumApp job report',
    view.ref+'  '+view.status,
    view.serviceTitle,
    view.dateLabel+'  '+view.time,
    view.address,
    view.areaM2+' m2',
    (view.priceCents/100).toFixed(2)+' '+currency,
    view.worker?view.worker.name:'Unassigned',
    view.report?view.report.durationLabel:'',
    view.report?.note||'',
    view.report?.onsiteMethod?('Paid on site: '+view.report.onsiteMethod):'No online payment',
    'Photos: '+(view.photos?.length||0)+' / '+JOB_PHOTO_LIMIT,
   ].filter(Boolean);
   return pdfDocument(lines);
  },
 };
}
