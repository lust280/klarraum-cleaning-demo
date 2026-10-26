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
async function load(){
 const filter=$('#status-filter').value;
 const [data,summary]=await Promise.all([api(`api/admin/inquiries?offset=${offset}&status=${encodeURIComponent(filter)}`),api('api/admin/summary')]);
 document.querySelectorAll('[data-stat]').forEach(node=>node.textContent=String(summary[node.dataset.stat]));
 total=data.total;$('#count').textContent=translateUI(`${total} Anfrage${total===1?'':'n'} · ${total?offset+1:0}–${Math.min(offset+50,total)}`);
 $('#previous').disabled=offset===0;$('#next').disabled=offset+50>=total;
 const nodes=data.items.map(item=>{
  const card=el('article',undefined,'inquiry');
  const head=el('div',undefined,'inquiry-head');const title=el('div');title.append(el('h2',item.name),el('div',translateUI(`${dateFormat.format(item.createdAt)} · ${item.id.slice(0,8)}`),'meta'));
  head.append(title,el('span',statusNames[item.status],'badge'));card.append(head);
  const grid=el('div',undefined,'inquiry-grid');
  for(const text of [`Email: ${item.email||'—'}`,`Phone: ${item.phone||'—'}`,`Postal code: ${item.postcode}`,`Address: ${item.address||'To be agreed'}`,`Service: ${item.serviceTitle||serviceNames[item.service]} · ${item.area} m²`,`Frequency: ${frequencyNames[item.frequency]}`,`Windows: ${item.windows?'Yes':'No'}`,`Preferred date: ${item.date||'Open'}`,`Estimate: ${currency.format(item.price)}`])grid.append(el('p',text));
  card.append(grid);
  if(item.message)card.append(el('p',item.message));
  const delivery={demo:'Fictional test · no email · contact details omitted',sent:'Notification sent',pending:'Notification pending',failed:'Notification failed — inquiry was saved'};
  card.append(el('p',delivery[item.notification],`badge ${item.notification==='failed'?'failed':''}`));
  const actions=el('div',undefined,'actions');const select=el('select');select.setAttribute('aria-label',`Status for ${item.name}`);
  for(const [value,label] of Object.entries(statusNames)){const option=el('option',label);option.value=value;select.append(option);}select.value=item.status;
  select.addEventListener('change',async()=>{select.disabled=true;clearError();try{await api(`api/admin/inquiries/${item.id}`,{method:'PATCH',body:JSON.stringify({status:select.value})});await load();}catch(error){select.value=item.status;showError(error);}finally{select.disabled=false;}});
  actions.append(select);
  if(item.notification!=='sent' && !item.demo)actions.append(button(translateUI('E-Mail erneut versuchen'),async()=>{await api(`api/admin/inquiries/${item.id}/retry-mail`,{method:'POST'});await load();}));
  actions.append(button(translateUI('Löschen'),async()=>{deleteId=item.id;$('#delete-dialog').showModal();},'danger'));
  const assign=el('a',translateUI('Auftrag erstellen'),'button small secondary');assign.href='./operations.html?inquiry='+encodeURIComponent(item.id);actions.append(assign);
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
async function loadCompanyPreferences(){const value=await api('api/admin/company-preferences');const form=$('#company-preferences-form');form.elements.timeZone.value=value.timeZone;form.elements.currency.value=value.currency;form.elements.timeZone.disabled=value.locked;$('#company-preferences-status').textContent=value.locked?'Time zone is locked because jobs already exist. Currency can still be changed.':'';currency=new Intl.NumberFormat('en-US',{style:'currency',currency:value.currency});dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:value.timeZone});}
async function openDashboard(){const session=await api('api/admin/session');csrf=session.csrf;$('#login-panel').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=false;$('#notice').textContent=session.live?translateUI('Anfragen werden angenommen. Neue Anfragen zuerst. Preise sind unverbindliche Orientierungen.'):session.demoMode?translateUI('Testbetrieb: Hier erscheinen Testanfragen mit fiktiven Kontaktdaten. Echte Anfragen sind ausgeschaltet. Daten können bei einem Neustart verloren gehen.'):translateUI('Testbetrieb: Der öffentliche Anfragenversand ist ausgeschaltet.');await Promise.all([load(),loadSettings(),loadCompanyPreferences(),loadSiteEditor(api)]);}
$('#login-form').addEventListener('submit',async event=>{event.preventDefault();clearError();const submit=event.submitter;submit.disabled=true;try{const data=await api('api/admin/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});csrf=data.csrf;$('#password').value='';await openDashboard();}catch(error){showError(error);}finally{submit.disabled=false;}});
$('#logout').addEventListener('click',async()=>{if((hasSiteChanges()||noteDrafts.size)&&!confirm(translateUI('Abmelden und ungespeicherte Änderungen verwerfen?')))return;clearError();try{await api('api/admin/logout',{method:'POST'});clearSiteChanges();noteDrafts.clear();showLogin();$('#notice').textContent=translateUI('Sie sind abgemeldet.');}catch(error){showError(error);}});
$('#refresh').addEventListener('click',()=>{clearError();load().catch(showError);});
$('#status-filter').addEventListener('change',()=>{offset=0;load().catch(showError);});
$('#previous').addEventListener('click',()=>{offset=Math.max(0,offset-50);load().catch(showError);});
$('#next').addEventListener('click',()=>{offset+=50;load().catch(showError);});
$('#delete-cancel').addEventListener('click',()=>$('#delete-dialog').close());
$('#delete-confirm').addEventListener('click',async()=>{const node=$('#delete-confirm');node.disabled=true;clearError();try{await api(`api/admin/inquiries/${deleteId}`,{method:'DELETE'});$('#delete-dialog').close();noteDrafts.delete(deleteId);if(offset>=total-1)offset=Math.max(0,offset-50);await load();}catch(error){showError(error);}finally{node.disabled=false;}});
$('#pricing-form').addEventListener('submit',async event=>{event.preventDefault();clearError();const fields=event.currentTarget.elements;const button=event.submitter;button.disabled=true;try{const pricing={rates:Object.fromEntries(['home','office','deep'].map(key=>[key,Number(fields[key].value)])),discounts:{once:1,weekly:1-Number(fields.weekly.value)/100,fortnightly:1-Number(fields.fortnightly.value)/100},minimum:Number(fields.minimum.value),windows:Number(fields.windows.value)};await api('api/admin/settings',{method:'PUT',body:JSON.stringify(pricing)});$('#pricing-status').textContent=translateUI('Preise gespeichert. Neue Kalkulationen verwenden diese Werte.');}catch(error){showError(error);}finally{button.disabled=false;}});
$('#company-preferences-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=event.submitter;button.disabled=true;try{const value=await api('api/admin/company-preferences',{method:'PUT',body:JSON.stringify({timeZone:form.elements.timeZone.value,currency:form.elements.currency.value})});await loadCompanyPreferences();$('#company-preferences-status').textContent=`Saved: ${value.timeZone} · ${value.currency}.`;await load();}catch(error){showError(error);}finally{button.disabled=false;}});
async function init(){
 if(location.hostname.endsWith('.github.io')){$('#notice').textContent='The public preview has no administrator access. Administration requires the configured server.';return;}
 try{await openDashboard();}catch(error){showLogin();$('#notice').textContent='Sign in with your administrator password. Sign-in is unavailable until a server is configured.';if(!error.message.includes('sign in'))showError(error);}
}
init();
window.addEventListener('beforeunload',event=>{if(noteDrafts.size){event.preventDefault();event.returnValue='';}});

// The shared-host director is available only on the root fictional-data demo.
if(location.pathname==='/admin.html'&&!location.hostname.endsWith('.github.io')){
 fetch(new URL('api/config',location.href)).then(r=>r.ok?r.json():null).then(config=>{
  if(!config?.demoMode)return;const link=document.createElement('a');link.className='button small secondary';link.href='./director.html';link.textContent='Director console';document.querySelector('header')?.append(link);
 }).catch(()=>{});
}
