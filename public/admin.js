import {t as translateUI} from './i18n.js';
import {loadSiteEditor,hasSiteChanges,clearSiteChanges} from './admin-site.js';
const $=s=>document.querySelector(s);
let csrf='',offset=0,total=0,deleteId='';
const noteDrafts=new Map();
const statusNames={new:translateUI('Neu'),contacted:translateUI('Kontaktiert'),confirmed:translateUI('Vereinbart'),completed:translateUI('Abgeschlossen')};
const serviceNames={home:translateUI('Wohnung / Haus'),office:'Büro',deep:translateUI('Grundreinigung')};
const frequencyNames={once:translateUI('Einmalig'),weekly:translateUI('Wöchentlich'),fortnightly:translateUI('Alle 2 Wochen')};
let currency=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
let dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'});
function showError(error){$('#admin-error').textContent=translateUI(error.message);$('#admin-error').hidden=false;}
function clearError(){$('#admin-error').hidden=true;}
async function api(path,options={}){
 const response=await fetch(new URL(path,location.href),{...options,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...options.headers}});
 const data=await response.json().catch(()=>({error:'The administration service is unavailable.'}));
 if(!response.ok){if(response.status===401)showLogin();throw new Error(data.error||'Action failed.');}
 return data;
}
function showLogin(){$('#dashboard').hidden=true;$('#login-panel').hidden=false;$('#logout').hidden=true;$('#inquiries').replaceChildren();csrf='';}
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function button(text,action,className='secondary'){const node=el('button',text,`button small ${className}`);node.type='button';node.addEventListener('click',async()=>{node.disabled=true;clearError();try{await action();}catch(error){showError(error);}finally{node.disabled=false;}});return node;}
const localDate=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:dateFormat.resolvedOptions().timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${value.year}-${value.month}-${value.day}`;};
function renderAttention(summary,jobs){
 const box=$('#owner-attention');if(!box)return;const dateNode=$('#today-date');if(dateNode)dateNode.textContent=new Intl.DateTimeFormat(document.documentElement.lang||'en',{month:'long',day:'numeric',timeZone:dateFormat.resolvedOptions().timeZone}).format(new Date());
 const items=[['New requests',String(summary.new||0)],['Jobs today',String(jobs.length)]];
 if((summary.new||0)>0)items.unshift(['Attention','New inquiry']);
 box.replaceChildren(...items.map(([title,detail])=>{const card=el('article');card.append(el('h3',title),el('strong',detail));return card;}));
}
async function loadToday(){
 const day=localDate();
 const data=await api(`api/admin/calendar?from=${day}&to=${day}&employee=`);
 const list=$('#today-jobs');
 const jobs=data.items||[];
 list.replaceChildren(...(jobs.length?jobs.map(job=>{const link=el('a',undefined,'today-job');link.href='./ops.html#/jobs';link.append(el('strong',job.time||'—'),el('span',job.title||'Untitled job'),el('small',`${job.employeeName||'Unassigned'} · ${job.minutes||0} min`));return link;}):[el('p','No jobs scheduled today.','empty-state compact-empty')]));
 return jobs;
}
async function load(){
 const filter=$('#status-filter').value;
 const [data,summary,jobs]=await Promise.all([api(`api/admin/inquiries?offset=${offset}&status=${encodeURIComponent(filter)}`),api('api/admin/summary'),loadToday()]);
 renderAttention(summary,jobs||[]);
 document.querySelectorAll('[data-stat]').forEach(node=>node.textContent=String(summary[node.dataset.stat]));
 total=data.total;$('#count').textContent=translateUI(`${total} Anfrage${total===1?'':'n'} · ${total?offset+1:0}–${Math.min(offset+50,total)}`);
 $('#previous').disabled=offset===0;$('#next').disabled=offset+50>=total;
 const nodes=data.items.map(item=>{
  const card=el('article',undefined,'inquiry');
  const head=el('div',undefined,'inquiry-head');const title=el('div');title.append(el('h2',item.name),el('div',translateUI(`${dateFormat.format(item.createdAt)} · ${item.id.slice(0,8)}`),'meta'));
  head.append(title,el('span',statusNames[item.status],'badge'));card.append(head);
  const grid=el('div',undefined,'inquiry-grid');
  for(const text of [`Email: ${item.email||'—'}`,`Phone: ${item.phone||'—'}`,`Postal code: ${item.postcode}`,`Address: ${item.address||'To be agreed'}`,`Service: ${item.serviceTitle||serviceNames[item.service]} · ${item.area} m²`,`Frequency: ${frequencyNames[item.frequency]}`,`Windows: ${item.windows?'Yes':'No'}`,...(item.tipPercent?[`Cleaner tip: ${item.tipPercent}% · ${currency.format(item.tipAmount||0)}`]:[]),`Preferred date: ${item.date||'Open'}`,`Preferred time: ${item.preferredTime||'Open'}`,`Estimate: ${currency.format(item.price)}`])grid.append(el('p',text));
  card.append(grid);
  if(item.message)card.append(el('p',item.message));
  const delivery={demo:'Fictional test · no email · contact details omitted',sent:'Notification sent',pending:'Notification pending',failed:'Notification failed — inquiry was saved'};
  const deliveryText=item.notificationError==='mail_not_configured'?'Saved, but email is not configured. Set the platform Resend key, sender, and company contact email.':delivery[item.notification];
  card.append(el('p',deliveryText,`badge ${item.notification==='failed'?'failed':''}`));
  const actions=el('div',undefined,'actions');const select=el('select');select.setAttribute('aria-label',`Status for ${item.name}`);
  for(const [value,label] of Object.entries(statusNames)){const option=el('option',label);option.value=value;select.append(option);}select.value=item.status;
  select.addEventListener('change',async()=>{select.disabled=true;clearError();try{await api(`api/admin/inquiries/${item.id}`,{method:'PATCH',body:JSON.stringify({status:select.value})});await load();}catch(error){select.value=item.status;showError(error);}finally{select.disabled=false;}});
  actions.append(select);
  if(item.notification!=='sent' && !item.demo)actions.append(button(translateUI('E-Mail erneut versuchen'),async()=>{await api(`api/admin/inquiries/${item.id}/retry-mail`,{method:'POST'});await load();}));
  actions.append(button(translateUI('Löschen'),async()=>{deleteId=item.id;$('#delete-dialog').showModal();},'danger'));
  const assign=el('a',translateUI('Auftrag erstellen'),'button small secondary');assign.href='./ops.html#/jobs/new';actions.append(assign);
  card.append(actions);
  const notes=el('div',undefined,'note-editor');const label=el('label',translateUI('Interne Notiz (nur für die Verwaltung)'));label.htmlFor='note-'+item.id;
  const input=el('textarea');input.id='note-'+item.id;input.rows=2;input.maxLength=2000;input.value=noteDrafts.get(item.id)??item.note??'';
  input.addEventListener('input',()=>noteDrafts.set(item.id,input.value));
  const feedback=el('p','', 'fine');
  const save=button(translateUI('Notiz speichern'),async()=>{await api(`api/admin/inquiries/${item.id}/note`,{method:'PUT',body:JSON.stringify({note:input.value})});noteDrafts.delete(item.id);feedback.textContent=translateUI('Notiz gespeichert.');});
  notes.append(label,input,save,feedback);card.append(notes);return card;
 });
 $('#inquiries').replaceChildren(...(nodes.length?nodes:[el('p',translateUI('Hier erscheinen Ihre eingegangenen Anfragen.'),'empty-state')]));
}
async function loadSettings(){
 const {pricing}=await api('api/admin/settings');const form=$('#pricing-form');
 for(const key of ['home','office','deep'])form.elements[key].value=pricing.rates[key];
 for(const key of ['weekly','fortnightly'])form.elements[key].value=Math.round((1-pricing.discounts[key])*100);
 form.elements.minimum.value=pricing.minimum;form.elements.windows.value=pricing.windows;
}
async function loadCompanyPreferences(){const value=await api('api/admin/company-preferences');const form=$('#company-preferences-form');form.elements.timeZone.value=value.timeZone;form.elements.currency.value=value.currency;form.elements.customDomain.value=value.customDomain;form.elements.timeZone.disabled=value.locked;const domainMessage=value.customDomain?`Custom domain requested: ${value.customDomain}. It will stay pending until hosting and DNS connection are enabled.`:'';$('#company-preferences-status').textContent=[value.locked?'Time zone is locked because jobs already exist. Currency can still be changed.':'',domainMessage].filter(Boolean).join(' ');currency=new Intl.NumberFormat('en-US',{style:'currency',currency:value.currency});dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:value.timeZone});}
function supportMessage(item){const ai=item.kind==='ai',node=el('p',item.body,item.sender==='director'?(ai?'from-director ai-reply':'from-director'):'from-company'),meta=el('small',`${ai?'AI · KlarraumApp support':item.sender==='director'?'KlarraumApp support':'You'} · ${dateFormat.format(item.created_at)}`);node.append(meta);return node;}
async function loadPlatformSupport(){const panel=$('#platform-support');try{const data=await api('api/platform-support');panel.hidden=false;const messages=$('#platform-support-messages');messages.replaceChildren(...data.items.map(supportMessage));const unread=data.unread||0,count=$('#platform-support-count');count.hidden=!unread;count.textContent=unread?String(unread):'';}catch{panel.hidden=true;}}
async function loadPlatformPlan(){const panel=$('#platform-plan'),card=$('#plan-usage');try{const data=await api('api/platform-plan');panel.hidden=false;card.hidden=false;const gb=bytes=>`${(bytes/1024**3).toFixed(bytes>=10*1024**3?0:1)} GB`;const monthly=data.monthlyCents===null?'agreed individually':new Intl.NumberFormat('en-US',{style:'currency',currency:data.currency||'USD'}).format(data.monthlyCents/100);const storage=data.storageLimitBytes?`${gb(data.storageBytes)} of ${gb(data.storageLimitBytes)}`:'agreed individually';const warning=data.storageState?.level==='critical'?' Storage is at 95% or more: contact support before uploading more photos.':data.storageState?.level==='warning'?' Storage is at 80% or more: plan an export or extra storage.':'';const used=data.activeWorkers;const included=data.includedWorkers||0;$('#platform-plan-status').textContent=`${data.planName} · current monthly price ${monthly} · active workers ${used ?? '—'} / ${included} included · photo and media storage ${storage}.${warning}`;panel.dataset.companyName=data.companyName||'';$('#plan-usage-name').textContent=data.planName||'Plan';$('#plan-usage-price').textContent=monthly==='agreed individually'?monthly:`${monthly} / mo`;$('#plan-usage-workers').textContent=used==null?'Worker count unavailable':included>0?`${used} of ${included} workers used`:`${used} active workers · seats agreed individually`;
 const full=included>0&&used!=null&&used>=included;
 const extra=data.seatCents?new Intl.NumberFormat('en-US',{style:'currency',currency:data.currency||'USD'}).format(data.seatCents/100):'';
 const hintText=full?(data.nextPlan?`All included seats are in use. ${extra?`Another worker is an extra ${extra}/month, or move to ${data.nextPlan.name} (${data.nextPlan.included} workers). `:''}Ask support to change the plan. No charge is taken here.`:'All included seats are in use. Ask support before adding more workers.'):'';
 for(const id of ['plan-usage-hint','plan-card-hint']){const hint=$( '#'+id);if(!hint)continue;hint.hidden=!hintText;hint.textContent=hintText;}$('#plan-usage-bar').style.width=`${included>0?Math.min(100,Math.round((used||0)/included*100)):0}%`;$('#plan-usage-storage').textContent=`Storage ${storage}.${warning} Photos and other media are kept on a 12-month rolling basis. Older media may be removed so storage stays within the plan.`;}catch{panel.hidden=true;card.hidden=true;}}
function fillInquiryForm(data){const form=$('#inquiry-setup-form');form.elements.contactEmail.value=data.contactEmail||'';form.elements.phone.value=data.phone||'';form.elements.owner.value=data.owner||'';form.elements.address.value=data.address||'';form.elements.priceNote.value=data.priceNote||'';form.elements.postcodes.value=data.postcodes||'';form.elements.privacyDetails.value=data.privacyDetails||'';form.elements.additionalLegal.value=data.additionalLegal||'';form.elements.legalReviewed.checked=Boolean(data.legalReviewed);form.elements.inquiries.value=data.inquiries||'auto';$('#inquiry-setup-state').textContent=data.accepting?'· accepting':data.demo?'· demo only':'· not accepting';$('#inquiry-setup-status').textContent=data.accepting?'Customers can send inquiries.':(data.blockers||'');}
async function loadInquirySetup(){const panel=$('#inquiry-setup');try{const data=await api('api/platform-inquiries');panel.hidden=false;fillInquiryForm(data);}catch{panel.hidden=true;}}
function showIntegrations(session){
 const ready=session.integrations||{};
 if(ready.stripe){const note=el('p','Stripe keys are present. Checkout stays off in this version.','form-notice');note.id='integrations-note';$('#dashboard')?.prepend(note);}
 if(!ready.googleCalendar)return;
 const panel=el('details','','settings');panel.id='google-calendar';panel.open=false;
 const summary=el('summary','Google Calendar'),status=el('p','Checking Google Calendar…');status.id='google-calendar-status';
 const actions=el('div','','actions');
 const connect=el('button','Connect Google Calendar','button');connect.type='button';
 connect.addEventListener('click',async()=>{connect.disabled=true;try{const data=await api('api/admin/google-calendar/connect',{method:'POST',body:JSON.stringify({})});if(!data.url)throw new Error('Google Calendar is not configured.');location.assign(data.url);}catch(error){showError(error);connect.disabled=false;}});
 const sync=el('button','Sync jobs','button secondary');sync.type='button';
 sync.addEventListener('click',async()=>{sync.disabled=true;try{const data=await api('api/admin/google-calendar/sync',{method:'POST',body:JSON.stringify({})});status.textContent=`Copied ${data.copied} job${data.copied===1?'':'s'} to Google Calendar.`;}catch(error){showError(error);}finally{sync.disabled=false;}});
 const disconnect=el('button','Disconnect','button secondary');disconnect.type='button';
 disconnect.addEventListener('click',async()=>{disconnect.disabled=true;try{await api('api/admin/google-calendar/disconnect',{method:'POST',body:JSON.stringify({})});status.textContent='Google Calendar disconnected. Existing Google events are left in place.';}catch(error){showError(error);}finally{disconnect.disabled=false;}});
 actions.append(connect,sync,disconnect);panel.append(summary,el('p','Connect one Google Calendar for this company. Job title, time, worker name and service address are copied. Customer phone and email are not. Stripe is not involved.'),status,actions);
 $('#dashboard')?.append(panel);
 api('api/admin/google-calendar').then(data=>{const query=new URLSearchParams(location.search).get('google');status.textContent=query==='denied'?'Google Calendar was not connected.':data.connected?'Connected. Use Sync jobs to copy upcoming visits.':'Not connected. Nothing is sent to Google until you connect.'}).catch(()=>{status.textContent='Google Calendar is not available.';});
}
async function openDashboard(){const session=await api('api/admin/session');csrf=session.csrf;$('#login-panel').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=false;showIntegrations(session);const notice=$('#notice');if(session.demoMode){notice.hidden=false;notice.textContent=translateUI('Testbetrieb: Hier erscheinen Testanfragen mit fiktiven Kontaktdaten. Echte Anfragen sind ausgeschaltet. Daten können bei einem Neustart verloren gehen.');}else{notice.hidden=true;notice.textContent='';}document.querySelectorAll('[data-demo-copy]').forEach(node=>{node.hidden=true;});await Promise.all([load(),loadSettings(),loadCompanyPreferences(),loadSiteEditor(api),loadPlatformSupport(),loadPlatformPlan(),loadInquirySetup()]);if(!session.demoMode)await showCompanySetup();}
async function showCompanySetup(){const panel=$('#company-setup');if(!panel)return;const prefs=await api('api/admin/company-preferences');panel.hidden=prefs.setupComplete===true;if(prefs.setupComplete)return;const form=panel.querySelector('form');form.elements.timeZone.value=prefs.timeZone||'America/New_York';form.elements.currency.value=prefs.currency||'USD';const site=await api('api/admin/site').catch(()=>null);const company=site?.content?.company;if(company){if(company.area&&company.area!=='Your local service area')form.elements.city.value=company.area;form.elements.phone.value=company.phone||'';form.elements.email.value=company.email||'';}}
$('#login-form').addEventListener('submit',async event=>{event.preventDefault();clearError();const submit=event.submitter;submit.disabled=true;try{const data=await api('api/admin/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});csrf=data.csrf;$('#password').value='';await openDashboard();}catch(error){showError(error);}finally{submit.disabled=false;}});
$('#logout').addEventListener('click',async()=>{if((hasSiteChanges()||noteDrafts.size)&&!confirm(translateUI('Abmelden und ungespeicherte Änderungen verwerfen?')))return;clearError();try{await api('api/admin/logout',{method:'POST'});clearSiteChanges();noteDrafts.clear();showLogin();$('#notice').textContent=translateUI('Sie sind abgemeldet.');}catch(error){showError(error);}});
$('#refresh').addEventListener('click',()=>{clearError();load().catch(showError);});
$('#status-filter').addEventListener('change',()=>{offset=0;load().catch(showError);});
$('#previous').addEventListener('click',()=>{offset=Math.max(0,offset-50);load().catch(showError);});
$('#next').addEventListener('click',()=>{offset+=50;load().catch(showError);});
$('#delete-cancel').addEventListener('click',()=>$('#delete-dialog').close());
$('#delete-confirm').addEventListener('click',async()=>{const node=$('#delete-confirm');node.disabled=true;clearError();try{await api(`api/admin/inquiries/${deleteId}`,{method:'DELETE'});$('#delete-dialog').close();noteDrafts.delete(deleteId);if(offset>=total-1)offset=Math.max(0,offset-50);await load();}catch(error){showError(error);}finally{node.disabled=false;}});
$('#pricing-form').addEventListener('submit',async event=>{event.preventDefault();clearError();const fields=event.currentTarget.elements;const button=event.submitter;button.disabled=true;try{const pricing={rates:Object.fromEntries(['home','office','deep'].map(key=>[key,Number(fields[key].value)])),discounts:{once:1,weekly:1-Number(fields.weekly.value)/100,fortnightly:1-Number(fields.fortnightly.value)/100},minimum:Number(fields.minimum.value),windows:Number(fields.windows.value)};await api('api/admin/settings',{method:'PUT',body:JSON.stringify(pricing)});$('#pricing-status').textContent=translateUI('Preise gespeichert. Neue Kalkulationen verwenden diese Werte.');}catch(error){showError(error);}finally{button.disabled=false;}});
$('#company-preferences-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=event.submitter;button.disabled=true;try{const value=await api('api/admin/company-preferences',{method:'PUT',body:JSON.stringify({timeZone:form.elements.timeZone.value,currency:form.elements.currency.value,customDomain:form.elements.customDomain.value})});await loadCompanyPreferences();$('#company-preferences-status').textContent=`Saved: ${value.timeZone} · ${value.currency}.${value.customDomain?` Domain request saved for ${value.customDomain}; connection is pending hosting setup.`:''}`;await load();}catch(error){showError(error);}finally{button.disabled=false;}});

function openSupportWith(message){const panel=$('#platform-support');if(panel.hidden)return;panel.open=true;panel.querySelector('textarea[name=message]').value=message;panel.scrollIntoView({behavior:'smooth',block:'center'});panel.querySelector('textarea[name=message]').focus();}
$('#request-plan-change').addEventListener('click',()=>openSupportWith('I would like to discuss changing my plan or adding worker seats.'));
$('#request-storage').addEventListener('click',()=>openSupportWith('I would like to add storage to my company account.'));
$('#cancel-subscription')?.addEventListener('click',()=>openSupportWith('CANCEL SUBSCRIPTION: Please end this subscription at the end of the current period and keep the company data until I separately request deletion. Do not start a new charge.'));
$('#account-closure-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=event.submitter,name=form.elements.companyName.value.trim(),expected=$('#platform-plan').dataset.companyName;if(name!==expected){$('#account-closure-status').textContent='Enter the company name exactly as shown in your plan.';return;}button.disabled=true;try{await api('api/platform-support',{method:'POST',body:JSON.stringify({message:`ACCOUNT CLOSURE REQUEST: Company name confirmed by owner: ${name}. The owner requests closure and understands that KlarraumApp will confirm the request and provide a 30-day cancellation period before permanent deletion.`})});form.reset();$('#account-closure-status').textContent='Closure request sent. KlarraumApp will confirm the 30-day cancellation date in the private support thread.';await loadPlatformSupport();}catch(error){showError(error);}finally{button.disabled=false;}});
$('#inquiry-setup-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=event.submitter;button.disabled=true;try{const data=await api('api/platform-inquiries',{method:'PUT',body:JSON.stringify({contactEmail:form.elements.contactEmail.value,phone:form.elements.phone.value,owner:form.elements.owner.value,address:form.elements.address.value,priceNote:form.elements.priceNote.value,postcodes:form.elements.postcodes.value,privacyDetails:form.elements.privacyDetails.value,additionalLegal:form.elements.additionalLegal.value,legalReviewed:form.elements.legalReviewed.checked,inquiries:form.elements.inquiries.value})});fillInquiryForm(data);$('#inquiry-setup-status').textContent=data.accepting?'Saved. Customers can send inquiries.':`Saved. ${data.blockers||'Inquiries stay off until the missing pieces are ready.'}`;}catch(error){showError(error);}finally{button.disabled=false;}});
$('#platform-support-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=event.submitter;button.disabled=true;try{await api('api/platform-support',{method:'POST',body:JSON.stringify({message:form.elements.message.value})});form.reset();$('#platform-support-status').textContent='Message sent to KlarraumApp support.';await loadPlatformSupport();}catch(error){showError(error);}finally{button.disabled=false;}});
async function init(){
 if(location.hostname.endsWith('.github.io')){$('#notice').textContent='The public preview has no administrator access. Administration requires the configured server.';return;}
 const googleToken=new URLSearchParams(location.hash.slice(1)).get('google');
 if(googleToken){
  history.replaceState(null,'',location.pathname+location.search);
  try{
   const response=await fetch(new URL('api/admin/google-session',location.href),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:googleToken})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||'Google sign-in could not be finished.');
   csrf=data.csrf;await openDashboard();return;
  }catch(error){showLogin();showError(error);return;}
 }
 try{await openDashboard();}catch(error){showLogin();$('#notice').textContent='Sign in with your administrator password. Sign-in is unavailable until a server is configured.';if(!error.message.includes('sign in'))showError(error);}
}
$('#company-setup-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=event.submitter;button.disabled=true;clearError();try{await api('api/admin/company-setup',{method:'POST',body:JSON.stringify({city:form.elements.city.value,phone:form.elements.phone.value,email:form.elements.email.value,timeZone:form.elements.timeZone.value,currency:form.elements.currency.value})});$('#company-setup').hidden=true;await loadCompanyPreferences();await loadSiteEditor(api);}catch(error){showError(error);}finally{button.disabled=false;}});
$('#company-setup-skip')?.addEventListener('click',async()=>{clearError();try{await api('api/admin/company-setup',{method:'POST',body:JSON.stringify({skip:true})});$('#company-setup').hidden=true;}catch(error){showError(error);}});
init();
window.addEventListener('beforeunload',event=>{if(noteDrafts.size){event.preventDefault();event.returnValue='';}});

// The shared-host director is available only on the root fictional-data demo.
if(location.pathname==='/admin.html'&&!location.hostname.endsWith('.github.io')){
 fetch(new URL('api/config',location.href)).then(r=>r.ok?r.json():null).then(config=>{
  if(!config?.demoMode)return;const link=document.createElement('a');link.className='button small secondary';link.href='./director.html';link.textContent='Director console';document.querySelector('header')?.append(link);
 }).catch(()=>{});
}
