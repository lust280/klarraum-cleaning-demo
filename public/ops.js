const $ = selector => document.querySelector(selector);
const view = $('#view');
const title = $('#title');
let csrf = '';
let currency = 'EUR';
const labels = {new:'New',accepted:'Accepted',assigned:'Assigned',in_progress:'In progress',done:'Done',declined:'Declined',cancelled:'Cancelled'};
function statusMap(item){
 const steps=Array.isArray(item.chain)&&item.chain.length?item.chain:['new','accepted','assigned','in_progress','done'];
 const map=el('ol',null,'status-map');
 map.setAttribute('aria-label','Status');
 const current=steps.indexOf(item.status);
 steps.forEach((step,index)=>{
  const node=el('li',labels[step]||step,index<current?'passed':index===current?'current':'');
  if(index===current)node.setAttribute('aria-current','step');
  map.append(node);
 });
 if(item.status==='declined'||item.status==='cancelled'){
  const branch=el('li',labels[item.status],'current');
  branch.setAttribute('aria-current','step');
  map.append(branch);
 }
 return map;
}
async function move(item,action){
 const saved=await api(`api/admin/ops/jobs/${item.id}/${action}`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({version:item.version})});
 toast(labels[saved.status]||'Saved');
 return saved;
}
const services = [['home','Home'],['office','Office'],['deep','Deep']];

function el(tag, text, className){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}
function money(cents){const amount=(Number(cents)||0)/100;return new Intl.NumberFormat('en-IE',{style:'currency',currency,maximumFractionDigits:amount%1?2:0}).format(amount);}
function toast(text){const node=$('#toast');node.textContent=text;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{node.textContent='';},2400);}
function fail(error){const node=$('#ops-error');node.hidden=false;node.textContent=error.message||'Something went wrong.';}
function clearError(){$('#ops-error').hidden=true;}
async function api(path, options={}){
 const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...options.headers}});
 const data=await response.json().catch(()=>({}));
 if(response.status===401){$('#gate').hidden=false;$('.ops-app').hidden=true;throw new Error('Sign in required.');}
 if(!response.ok)throw new Error(data.error||'Request failed.');
 return data;
}
function pill(status){return el('span',labels[status]||status,`pill ${status}`);}
function card(item, extra){
 const node=el('article',null,'card');
 node.append(statusMap(item),el('p',item.time,'time'),el('h2',`${item.serviceTitle}${item.areaM2?` · ${item.areaM2} m²`:''}`));
 const row=el('div',null,'row');row.append(el('span',money(item.priceCents),'price'),pill(item.status));node.append(row);
 if(item.address)node.append(el('p',item.address));
 if(extra)node.append(extra);
 return node;
}
function setNav(name){document.querySelectorAll('[data-nav]').forEach(link=>{link.classList.toggle('active',link.dataset.nav===name);});}

async function showToday(){
 setNav('today');
 const data=await api('api/admin/ops/today');
 currency=data.currency||'EUR';
 title.textContent=`Today ${data.label}`;
 view.replaceChildren();
 const kpis=el('div',null,'kpis');
 for(const [label,value] of [['New requests',data.counts.newRequests],['Jobs today',data.counts.jobsToday],['Workers out',data.counts.workersOut]]){
  const box=el('div',null,'kpi');box.append(el('span',label),el('strong',String(value)));kpis.append(box);
 }
 view.append(kpis);
 if(!data.jobs.length&&!data.attention.length){
  const empty=el('div',null,'empty');
  empty.append(el('h2','No jobs today'),el('p','Open Jobs or share your booking link.'));
  const actions=el('div',null,'actions');
  const open=el('a','Open Jobs','btn');open.href='#/jobs';
  const share=el('button','Share booking link','btn-line');
  share.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.origin+'/');toast('Copied');}catch{toast('Copy the booking link from the address bar.');}});
  actions.append(open,share);empty.append(actions);view.append(empty);return;
 }
 const paint=list=>{
  for(const item of list){
   const actions=el('div',null,'actions');
   const open=el('a','Open','btn-line');open.href=`#/jobs/${item.id}`;actions.append(open);
   if(item.status==='new'){
    const accept=el('button','Accept','btn');
    accept.addEventListener('click',async()=>{accept.disabled=true;try{await move(item,'accept');await showToday();}catch(error){fail(error);accept.disabled=false;}});
    const decline=el('button','Decline','btn-line');decline.addEventListener('click',()=>declineSheet(item,()=>showToday()));
    actions.append(accept,decline);
   }
   if(item.status==='accepted'){const assign=el('a','Assign','btn');assign.href=`#/jobs/${item.id}`;actions.append(assign);}
   if(item.status==='assigned'){
    const start=el('button','Start','btn');
    start.addEventListener('click',async()=>{start.disabled=true;try{await move(item,'start');await showToday();}catch(error){fail(error);start.disabled=false;}});
    actions.append(start);
   }
   if(item.status==='in_progress'){
    const done=el('button','Done','btn');
    done.addEventListener('click',async()=>{done.disabled=true;try{await move(item,'done');await showToday();}catch(error){fail(error);done.disabled=false;}});
    actions.append(done);
   }
   const box=card(item,actions);
   if(item.status==='new')box.querySelector('h2').before(el('p','Attention'));
   view.append(box);
  }
 };
 paint(data.attention);
 paint(data.jobs.filter(job=>job.status!=='new'));
 if(data.workersOut.length){
  const panel=el('section',null,'card');panel.append(el('h2','Workers out'));
  for(const worker of data.workersOut)panel.append(el('p',`${worker.name} — ${worker.summary}`));
  view.append(panel);
 }
}

async function showJobs(range='today',status=''){
 setNav('jobs');title.textContent='Jobs';
 const data=await api(`api/admin/ops/jobs?range=${encodeURIComponent(range)}&status=${encodeURIComponent(status)}`);
 currency=data.currency||'EUR';
 view.replaceChildren();
 const ranges=el('div',null,'filters');
 for(const [key,label] of [['today','Today'],['week','Week'],['month','Month']]){
  const button=el('button',label,key===range?'active':'');button.addEventListener('click',()=>showJobs(key,status).catch(fail));ranges.append(button);
 }
 const filters=el('div',null,'filters');
 for(const [key,label] of [['','All'],['new','New'],['accepted','Accepted'],['assigned','Assigned'],['in_progress','In progress'],['done','Done']]){
  const button=el('button',label,key===status?'active':'');button.addEventListener('click',()=>showJobs(range,key).catch(fail));filters.append(button);
 }
 const create=el('a','New job','btn');create.href='#/jobs/new';
 view.append(ranges,filters,create);
 if(!data.items.length){
  const empty=el('div',null,'empty');empty.append(el('h2','No jobs yet.'),el('p','Jobs from your booking site appear here.'));view.append(empty);return;
 }
 const wide=matchMedia('(min-width:960px)').matches;
 const refresh=()=>showJobs(range,status);
 if(!wide){
  for(const item of data.items){
   const actions=el('div',null,'actions');
   const open=el('a','Open','btn-line');open.href=`#/jobs/${item.id}`;actions.append(open);
   if(item.status==='new'){
    const accept=el('button','Accept','btn');
    accept.addEventListener('click',async()=>{accept.disabled=true;try{await move(item,'accept');await refresh();}catch(error){fail(error);accept.disabled=false;}});
    const decline=el('button','Decline','btn-line');decline.addEventListener('click',()=>declineSheet(item,refresh));
    actions.append(accept,decline);
   }
   if(item.status==='accepted'){const assign=el('a','Assign','btn');assign.href=`#/jobs/${item.id}`;actions.append(assign);}
   if(item.status==='assigned'){
    const start=el('button','Start','btn');
    start.addEventListener('click',async()=>{start.disabled=true;try{await move(item,'start');await refresh();}catch(error){fail(error);start.disabled=false;}});
    actions.append(start);
   }
   if(item.status==='in_progress'){
    const done=el('button','Done','btn');
    done.addEventListener('click',async()=>{done.disabled=true;try{await move(item,'done');await refresh();}catch(error){fail(error);done.disabled=false;}});
    actions.append(done);
   }
   view.append(card(item,actions));
  }
  return;
 }
 const table=document.createElement('table');
 const head=document.createElement('tr');
 for(const name of ['Date','Service','Address','Worker','Price','Status'])head.append(el('th',name));
 table.append(head);
 for(const item of data.items){
  const row=document.createElement('tr');
  row.append(el('td',`${item.dateLabel} ${item.time}`),el('td',item.serviceTitle),el('td',item.address),el('td',item.worker?.name||'—'),el('td',money(item.priceCents)));
  const cell=el('td');cell.append(statusMap(item),pill(item.status));
  const open=el('a','Open','btn-line');open.href=`#/jobs/${item.id}`;cell.append(open);
  if(item.status==='new'){
   const accept=el('button','Accept','btn');
   accept.addEventListener('click',async()=>{accept.disabled=true;try{await move(item,'accept');await refresh();}catch(error){fail(error);accept.disabled=false;}});
   const decline=el('button','Decline','btn-line');decline.addEventListener('click',()=>declineSheet(item,refresh));
   cell.append(accept,decline);
  }
  if(item.status==='accepted'){const assign=el('a','Assign','btn');assign.href=`#/jobs/${item.id}`;cell.append(assign);}
  if(item.status==='assigned'){
   const start=el('button','Start','btn');
   start.addEventListener('click',async()=>{start.disabled=true;try{await move(item,'start');await refresh();}catch(error){fail(error);start.disabled=false;}});
   cell.append(start);
  }
  if(item.status==='in_progress'){
   const done=el('button','Done','btn');
   done.addEventListener('click',async()=>{done.disabled=true;try{await move(item,'done');await refresh();}catch(error){fail(error);done.disabled=false;}});
   cell.append(done);
  }
  row.append(cell);table.append(row);
 }
 view.append(table);
}

function workerList(job, reassign=false){
 const wrap=el('section',null,'card');
 wrap.append(el('h2',job.worker&&!reassign?'Assigned worker':'Assign worker'));
 const people=reassign||!job.worker?job.workers:[job.workers.find(worker=>worker.id===job.worker.id)].filter(Boolean);
 for(const worker of people){
  const row=el('div',null,'worker card');
  row.append(el('strong',worker.name),el('span',worker.availability==='busy'?'Busy':'Free',`avail ${worker.availability}`));
  if(!job.worker||reassign){
   const button=el('button',worker.id===job.worker?.id?'Assigned':'Assign',worker.id===job.worker?.id?'btn':'btn');
   button.disabled=worker.id===job.worker?.id;
   button.addEventListener('click',async()=>{button.disabled=true;try{await api(`api/admin/ops/jobs/${job.id}/assign`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({employeeId:worker.id,version:job.version})});toast('Saved');location.hash=`#/jobs/${job.id}`;location.reload();}catch(error){fail(error);button.disabled=false;}});
   row.append(button);
  }
  wrap.append(row);
 }
 if(job.worker&&!reassign&&['assigned','accepted'].includes(job.status)){
  const again=el('button','Reassign','btn-line');again.addEventListener('click',()=>{wrap.replaceWith(workerList(job,true));});wrap.append(again);
 }
 return wrap;
}

async function showJob(id){
 setNav('jobs');
 const job=await api('api/admin/ops/jobs/'+id);
 currency=job.currency||'EUR';
 title.textContent='Job';
 view.replaceChildren();
 const back=el('a','‹ Jobs','back');back.href='#/jobs';
 const summary=el('article',null,'card');
 summary.append(statusMap(job),el('h2',job.serviceTitle),el('p',`${job.dateLabel} ${job.time}`),el('p',job.address),el('p',job.areaM2?`${job.areaM2} m²`:''),el('p',job.customer),el('span',money(job.priceCents),'price'),pill(job.status));
 const layout=el('div',null,'layout');
 const main=el('div');main.append(summary);
 const actions=el('div',null,'actions');
 if(job.status==='new'){
  const accept=el('button','Accept','btn');
  accept.addEventListener('click',async()=>{accept.disabled=true;try{await move(job,'accept');await showJob(job.id);}catch(error){fail(error);accept.disabled=false;}});
  const decline=el('button','Decline','btn-line');decline.addEventListener('click',()=>declineSheet(job));
  actions.append(accept,decline);
 }
 if(job.status==='assigned'){
  const start=el('button','Start','btn');
  start.addEventListener('click',async()=>{start.disabled=true;try{await move(job,'start');await showJob(job.id);}catch(error){fail(error);start.disabled=false;}});
  actions.append(start);
 }
 if(job.status==='in_progress'){
  const done=el('button','Done','btn');
  done.addEventListener('click',async()=>{done.disabled=true;try{await move(job,'done');await showJob(job.id);}catch(error){fail(error);done.disabled=false;}});
  actions.append(done);
 }
 if(['new','accepted','assigned'].includes(job.status)){
  const edit=el('a','Edit job','btn-line');edit.href=`#/jobs/${job.id}/edit`;
  const cancel=el('button','Cancel job','btn-line');cancel.addEventListener('click',()=>cancelSheet(job));
  actions.append(edit,cancel);
 }
 if(job.status==='done'){const report=el('a','Job report','btn');report.href=`#/jobs/${job.id}/report`;actions.append(report);}
 const photos=el('a',`Photos (${job.photos.length}/${job.photoLimit})`,'btn-line');photos.href=`#/jobs/${job.id}/photos`;actions.append(photos);
 main.append(actions);
 layout.append(main);
 if(['accepted','assigned'].includes(job.status))layout.append(workerList(job));
 view.append(back,layout);
}

function declineSheet(job,after){
 const sheet=$('#sheet');sheet.hidden=false;sheet.replaceChildren();
 const panel=el('div',null,'panel');
 panel.append(el('h2','Decline this request?'),el('p',`${job.serviceTitle}${job.areaM2?` · ${job.areaM2} m²`:''}`),el('p',`${job.dateLabel}, ${job.time}`),el('p',`${money(job.priceCents)} — pay on site`),el('p',`${job.customer} · ${job.address}`),el('h3','Reason (optional)'));
 const reasons=el('div',null,'reasons');let reason='fully_booked';
 for(const [key,label] of [['fully_booked','Fully booked'],['outside_area','Outside service area'],['other','Other']]){
  const button=el('button',label,key===reason?'btn':'btn-line');
  button.addEventListener('click',()=>{reason=key;reasons.querySelectorAll('button').forEach(item=>item.className='btn-line');button.className='btn';});
  reasons.append(button);
 }
 const message=document.createElement('textarea');message.maxLength=500;message.placeholder='Message to customer (optional)';
 panel.append(reasons,message,el('p','The customer gets an email. No charge for them.'));
 const confirm=el('button','Decline request','btn-danger');
 confirm.addEventListener('click',async()=>{confirm.disabled=true;try{await api(`api/admin/ops/jobs/${job.id}/decline`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({version:job.version,reason,message:message.value})});sheet.hidden=true;toast('Declined');if(after)await after();else location.hash='#/jobs';}catch(error){fail(error);confirm.disabled=false;}});
 const keep=el('button','Keep request','btn-line');keep.addEventListener('click',()=>{sheet.hidden=true;});
 panel.append(confirm,keep);sheet.append(panel);
}

function cancelSheet(job){
 const sheet=$('#sheet');sheet.hidden=false;sheet.replaceChildren();
 const panel=el('div',null,'panel');
 const notify=document.createElement('input');notify.type='checkbox';notify.checked=true;
 const label=el('label','Notify customer');label.prepend(notify);
 panel.append(el('h2','Cancel this job?'),el('p',job.serviceTitle),label);
 const confirm=el('button','Cancel job','btn-danger');
 confirm.addEventListener('click',async()=>{confirm.disabled=true;try{await api(`api/admin/ops/jobs/${job.id}/cancel`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({version:job.version,notifyCustomer:notify.checked})});sheet.hidden=true;toast('Saved');location.hash='#/jobs';}catch(error){fail(error);confirm.disabled=false;}});
 const keep=el('button','Keep job','btn-line');keep.addEventListener('click',()=>{sheet.hidden=true;});
 panel.append(confirm,keep);sheet.append(panel);
}

async function showEditor(id){
 setNav('jobs');title.textContent=id?'Edit job':'New job';
 const job=id?await api('api/admin/ops/jobs/'+id):null;
 if(job)currency=job.currency||'EUR';
 view.replaceChildren();
 const back=el('a',id?'‹ Back to job':'‹ Jobs','back');back.href=id?`#/jobs/${id}`:'#/jobs';
 const form=document.createElement('form');form.className='card';
 const seg=el('div',null,'seg');let service=job?.service||'home';
 for(const [key,label] of services){const button=el('button',label,key===service?'active':'');button.type='button';button.addEventListener('click',()=>{service=key;seg.querySelectorAll('button').forEach(item=>item.classList.remove('active'));button.classList.add('active');refreshPrice();});seg.append(button);}
 const date=document.createElement('input');date.type='date';date.required=true;date.value=job?.date||'';
 const time=document.createElement('input');time.type='time';time.required=true;time.value=job?.time||'09:00';
 const area=document.createElement('input');area.inputMode='numeric';area.required=true;area.placeholder='70';area.value=job?.areaM2||'';
 const address=document.createElement('input');address.required=true;address.maxLength=250;address.placeholder='Lindenstraße 12, Berlin';address.value=job?.address||'';
 const customer=document.createElement('input');customer.required=true;customer.maxLength=100;customer.placeholder='Anna Weber';customer.value=job?.customer||'';
 const phone=document.createElement('input');phone.maxLength=40;phone.placeholder='+49 151 23456789';phone.value=job?.phone||'';
 const notes=document.createElement('textarea');notes.maxLength=2000;notes.placeholder='Key under the mat';notes.value=job?.notes||'';
 const assign=document.createElement('select');
 const empty=el('option','Unassigned');empty.value='';assign.append(empty);
 let workers=[];
 async function loadWorkers(){
  if(!date.value||!time.value)return;
  const data=await api(`api/admin/ops/availability?date=${date.value}&time=${time.value}&minutes=120&exclude=${job?.jobId||''}`);
  workers=data.workers;const current=assign.value||job?.worker?.id||'';
  assign.replaceChildren(empty);
  for(const worker of workers){const option=el('option',`${worker.name} · ${worker.availability==='busy'?'Busy':'Free'}`);option.value=worker.id;assign.append(option);}
  assign.value=current;
 }
 const settings=await api('api/admin/settings');
 const rates=Object.fromEntries(services.map(([key])=>[key,Math.round(settings.pricing.rates[key]*100)]));
 const formula=el('p','','formula');
 function refreshPrice(){
  const metres=Number(area.value),rate=rates[service];
  formula.textContent=metres>=20?`Price ${money(rate)} / m² – ${money(rate*metres)}`:'Price is the service rate per m² times the area.';
 }
 date.addEventListener('change',()=>loadWorkers().catch(fail));
 time.addEventListener('change',()=>loadWorkers().catch(fail));
 area.addEventListener('input',refreshPrice);
 const pair=el('div',null,'pair');
 const dateLabel=el('label','Date');dateLabel.append(date);const timeLabel=el('label','Time');timeLabel.append(time);pair.append(dateLabel,timeLabel);
 const areaLabel=el('label','Area (m²)');areaLabel.append(area);
 const serviceLabel=el('label','Service');serviceLabel.append(seg);
 form.append(serviceLabel,pair,areaLabel);
 for(const [name,field] of [['Address',address],['Customer',customer],['Phone',phone],['Notes',notes],['Assign worker',assign]]){
  const wrap=el('label',name);wrap.append(field);form.append(wrap);
 }
 const submit=el('button',id?'Save changes':'Create job','btn');submit.type='submit';
 form.addEventListener('submit',async event=>{
  event.preventDefault();submit.disabled=true;clearError();
  const body={service,date:date.value,time:time.value,areaM2:Number(area.value),address:address.value,customer:customer.value,phone:phone.value,notes:notes.value,employeeId:assign.value||null,version:job?.version};
  try{
   const saved=await api(id?`api/admin/ops/jobs/${id}`:'api/admin/ops/jobs',{method:id?'PUT':'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)});
   toast('Saved');location.hash=`#/jobs/${saved.id}`;
  }catch(error){fail(error);submit.disabled=false;}
 });
 form.append(formula,submit);view.append(back,form);refreshPrice();if(date.value)loadWorkers().catch(fail);
}

async function showPhotos(id){
 const job=await api('api/admin/ops/jobs/'+id);
 title.textContent='Photos';view.replaceChildren();
 const back=el('a','‹ Back to job','back');back.href=`#/jobs/${id}`;
 const grid=el('div',null,'photos');
 for(const photo of job.photos){const image=document.createElement('img');image.alt='Job photo';image.src=photo.url;grid.append(image);}
 for(let slot=job.photos.length;slot<job.photoLimit;slot++)grid.append(el('div','Add','slot'));
 view.append(back,el('h2','Photos'),grid,el('p',`Up to ${job.photoLimit} photos · kept 12 months`));
}

async function showReport(id){
 const job=await api('api/admin/ops/jobs/'+id);
 currency=job.currency||'EUR';title.textContent='Job report';view.replaceChildren();
 const back=el('a','‹ Back to job','back');back.href=`#/jobs/${id}`;
 const report=job.report||{};
 const summary=el('article',null,'card');
 summary.append(el('h2',`${job.serviceTitle} · ${job.address}`),el('p',`${job.dateLabel} · ${report.startedAt||job.time}${report.endedAt?`–${report.endedAt}`:''} · ${report.durationLabel||''}`),el('p',job.areaM2?`${job.areaM2} m²`:''),el('p',job.worker?.name||''));
 view.append(back,summary,el('h2',`Photos (${job.photos.length})`));
 const grid=el('div',null,'photos');
 for(const photo of job.photos){const image=document.createElement('img');image.alt='Report photo';image.src=photo.url;grid.append(image);}
 view.append(grid,el('h2','Customer signature'));
 const sign=el('div',null,'card');sign.append(el('p',report.signedBy?report.signedBy:'No signature yet','signature'),el('p',report.signedBy?`Signed by ${report.signedBy}${report.signedAt?` · ${report.signedAt}`:''}`:'The worker collects the signature on the job.'));
 const pay=el('div',null,'card');pay.append(el('h2','Payment'),el('p',report.onsiteMethod?`Paid on site · ${report.onsiteMethod==='cash'?'Cash':'Card'} · ${money(job.priceCents)}`:`Pay on site · ${money(job.priceCents)}`),el('p','No card payment is taken online.'));
 view.append(sign,pay,el('h2','Worker note'),el('p',report.note||'No note.'));
 const actions=el('div',null,'actions');
 const pdf=el('a','Download PDF','btn');pdf.href=`api/admin/ops/jobs/${id}/report.pdf`;
 const send=el('button','Send to customer','btn-line');
 send.addEventListener('click',async()=>{send.disabled=true;try{const result=await api(`api/admin/ops/jobs/${id}/report/send`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:'{}'});toast(result.emailQueued?'Saved':'No customer email on this job.');}catch(error){fail(error);}finally{send.disabled=false;}});
 actions.append(pdf,send);view.append(actions);
}

async function route(){
 clearError();
 const parts=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);
 try{
  if(parts[0]==='jobs'&&parts[1]==='new')return await showEditor(null);
  if(parts[0]==='jobs'&&parts[1]&&parts[2]==='edit')return await showEditor(parts[1]);
  if(parts[0]==='jobs'&&parts[1]&&parts[2]==='photos')return await showPhotos(parts[1]);
  if(parts[0]==='jobs'&&parts[1]&&parts[2]==='report')return await showReport(parts[1]);
  if(parts[0]==='jobs'&&parts[1])return await showJob(parts[1]);
  if(parts[0]==='jobs')return await showJobs();
  return await showToday();
 }catch(error){if(error.message!=='Sign in required.')fail(error);}
}

$('#menu').addEventListener('click',()=>{const side=$('#side');side.classList.toggle('open');$('#menu').setAttribute('aria-expanded',side.classList.contains('open')?'true':'false');});
$('#side').addEventListener('click',event=>{if(event.target.closest('a'))$('#side').classList.remove('open');});
$('#sign-out').addEventListener('click',async()=>{await api('api/admin/logout',{method:'POST',body:'{}'});location.href='./partner.html';});
addEventListener('hashchange',()=>route());

const session=await fetch('api/admin/session',{credentials:'same-origin'});
if(session.status===401){$('#gate').hidden=false;document.querySelector('.ops-app').hidden=true;}
else{const data=await session.json();csrf=data.csrf;currency=data.currency||'EUR';if(!location.hash)location.hash='#/today';await route();}
