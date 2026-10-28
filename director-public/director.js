import {t,money,translate,errorText} from './director-i18n.js';
import {createFinance} from './director-finance.js';
import {createBackupPanel} from './director-backup.js';
import {createApplications} from './director-applications.js';
import {plans} from '/plans.mjs';
translate();
let csrf='',companies=[],dashboardFilter='all';
const $=s=>document.querySelector(s);
function error(message=''){$('#error').textContent=errorText(message);$('#error').hidden=!message;if(message)$('#error').scrollIntoView({behavior:'smooth',block:'nearest'});}
async function api(path,options={}){const response=await fetch('/api/director/'+path,{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...options.headers},body:options.body===undefined?undefined:JSON.stringify(options.body)});const data=await response.json();if(!response.ok){if(response.status===401){$('#dashboard').hidden=true;$('#login').hidden=false;$('#logout').hidden=true;}throw new Error(data.error||t('failed'));}return data;}
function el(tag,text,cls){const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(cls)item.className=cls;return item;}
function label(text,name,value,type='text',required=type!=='date'){const node=el('label',text),input=el('input');Object.assign(input,{name,value:value??'',type,required});if(type==='number'){input.min='0';input.max='100000';input.step=name==='included'?'1':'0.01';}else if(type!=='date')input.maxLength=80;node.append(input);return node;}
function select(text,name,value,choices){const node=el('label',text),input=el('select');input.name=name;for(const [key,title] of choices){const option=el('option',title);option.value=key;option.selected=key===value;input.append(option);}node.append(input);return node;}
const catalogue=Object.fromEntries(Object.entries(plans).map(([key,plan])=>[key,{baseCents:plan.baseCents,included:plan.included,seatCents:plan.seatCents}]));
const planChoices=[['solo','Solo — $29'],['starter','Starter — $49'],['team','Team — $89'],['growth','Business — $149'],['business','Scale — $219'],['plus','Plus — $259'],['custom','Custom']];
const tariff=form=>{const planKey=form.elements.planKey?.value||'custom',plan=catalogue[planKey]||catalogue.custom;return {name:form.elements.name.value,planKey,...plan};};
const day=value=>value?new Date(value).toISOString().slice(0,10):'';
const cataloguePlans=[['solo','Solo'],['starter','Starter'],['team','Team'],['growth','Business'],['business','Scale'],['plus','Plus']];
function catalogueKey(c){return cataloguePlans.some(([key])=>key===c.planKey)?c.planKey:'custom';}
function matchesDashboard(c){if(dashboardFilter==='all')return true;if(dashboardFilter==='enabled')return c.status==='active';if(dashboardFilter==='workers')return (c.workers?.active||0)>0;return catalogueKey(c)===dashboardFilter;}
const shownInvites=new Map();
function invite(url,companyId){if(companyId)shownInvites.set(companyId,url);$('#invite-url').value=url;$('#invitation').hidden=false;$('#invite-url').focus();$('#invite-url').select();}
async function busy(button,task){button.disabled=true;button.setAttribute('aria-busy','true');error();try{await task();}catch(e){error(e.message);}finally{button.disabled=false;button.removeAttribute('aria-busy');}}
function renderAttention(){
 const box=$('#attention');if(!box)return;const items=[],soon=Date.now()+7*86400000;
 for(const c of companies){
  if(c.unreadSupport)items.push(['Unread support',`${c.name} · ${c.unreadSupport}`]);
  if(c.payment==='trial'&&c.trialEndsAt&&c.trialEndsAt<=soon)items.push(['Trial ending',c.name]);
  if(c.storageState?.level==='warning'||c.storageState?.level==='critical')items.push(['Storage',`${c.name} · ${c.storageState.level}`]);
  if(c.inquiries==='setup'&&c.activated)items.push(['Inquiries',`${c.name} needs contact and legal details`]);
  else if(c.inquiries==='paused')items.push(['Inquiries paused',c.name]);
 }
 box.hidden=!items.length;box.replaceChildren(...items.slice(0,8).map(([title,detail])=>{const card=el('article');card.append(el('h2',title),el('strong',detail));return card;}));
}
function companyCard(c){
  const card=el('article',undefined,'company-card payment-'+c.payment);card.append(el('h2',c.name),el('p',`${c.planName} · ${c.timeZone} · joined ${new Date(c.createdAt).toLocaleDateString(document.documentElement.lang)}`,'meta'));
  const gb=bytes=>`${(bytes/1024**3).toFixed(bytes>=10*1024**3?0:1)} GB`;card.append(el('p',`Plan: ${c.planName} · ${c.storageLimitBytes?`${gb(c.storageBytes)} of ${gb(c.storageLimitBytes)} used (${c.storageState.level})`:'storage agreed individually'}`,'meta'));
  const link=el('a',t('openSite'));link.href=c.origin;link.target='_blank';link.rel='noopener';card.append(link);
  const w=c.workers;card.append(el('p',w?`${t('active')}: ${w.active} · ${t('invited')}: ${w.invited} · ${t('disabled')}: ${w.disabled}`:t('unavailable')));
  card.append(el('p',`${t('owner')}: ${t(c.activated?'activated':'pending')} · ${t('access')}: ${t(c.status==='active'?'open':'suspended')} · payment: ${c.payment} · due: ${day(c.paymentDueAt)||day(c.trialEndsAt)||'not set'}`,'payment-summary'));
  if(!c.activated)card.append(el('p',t('awaitingOwner'),'notice'));
  card.append(el('p',c.estimatedCents===null?t('unavailable'):`${t('estimate')}: ${money(c.baseCents)} + ${Math.max(0,w.active-c.included)} × ${money(c.seatCents)} = ${money(c.estimatedCents)}/${t('monthUnit')}`));if(c.trialEndsAt)card.append(el('p',`Trial ends: ${new Date(c.trialEndsAt).toLocaleDateString(document.documentElement.lang)}`,'meta'));
  const form=el('form');form.append(label(t('name'),'name',c.name),select('Plan','planKey',c.planKey,planChoices),select(t('access'),'status',c.status,[['active',t('open')],['suspended',t('suspended')]]),select(t('payment'),'payment',c.payment,[['trial',t('trial')],['paid',t('paid')],['overdue',t('overdue')]]),label(t('paymentDue'),'paymentDueAt',day(c.paymentDueAt),'date'),label(t('lastPaid'),'lastPaidAt',day(c.lastPaidAt),'date'));
  const save=el('button',t('save'));form.append(save);form.addEventListener('submit',e=>{e.preventDefault();busy(save,async()=>{await api('companies/'+c.id,{method:'PUT',body:{...tariff(form),status:form.elements.status.value,payment:form.elements.payment.value,paymentDueAt:form.elements.paymentDueAt.value||null,lastPaidAt:form.elements.lastPaidAt.value||null,version:c.version}});await refresh();});});card.append(form);
  const actions=el('div',undefined,'actions');const support=el('button',c.unreadSupport?`Support (${c.unreadSupport})`:'Support','secondary'),thread=el('div',undefined,'support-thread');support.onclick=()=>busy(support,async()=>{const data=await api('companies/'+c.id+'/support');thread.replaceChildren(...data.items.map(item=>el('p',`${new Date(item.created_at).toLocaleString(document.documentElement.lang)} · ${item.sender}: ${item.body}`,item.sender==='company'?'support-company':'support-director')));const reply=el('form'),input=el('textarea');input.maxLength=4000;input.required=true;input.placeholder='Reply to company';const send=el('button','Send reply');reply.append(input,send);reply.onsubmit=e=>{e.preventDefault();busy(send,async()=>{await api('companies/'+c.id+'/support',{method:'POST',body:{message:input.value}});support.click();});};thread.append(reply);});actions.append(support);if(!c.activated){const button=el('button',t('newInvite'),'secondary');button.type='button';button.onclick=()=>busy(button,async()=>{const data=await api('companies/'+c.id+'/invite',{method:'POST',body:{}});invite(data.inviteUrl,c.id);await refresh();});actions.append(button);if(shownInvites.has(c.id)){const box=el('div',undefined,'invite-box'),field=el('input'),copy=el('button',t('copyInvite'),'secondary');field.readOnly=true;field.value=shownInvites.get(c.id);copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(field.value);copy.textContent=t('copied');}catch{field.focus();field.select();}};box.append(field,copy);card.append(box);}}
  if(c.payment==='trial'){const extend=el('button','Add 15 trial days','secondary');extend.onclick=()=>busy(extend,async()=>{await api('companies/'+c.id+'/trial/extend',{method:'POST',body:{}});await refresh();});actions.append(extend);}
  const history=el('button',t('history'),'secondary'),out=el('pre');history.type='button';history.onclick=()=>busy(history,async()=>{const data=await api('companies/'+c.id+'/events');out.textContent=data.items.map(x=>new Date(x.created_at).toLocaleString(document.documentElement.lang)+' · '+x.action+'\n'+x.details).join('\n\n');});actions.append(history);
  const removal=el('details',undefined,'company-delete'),removalSummary=el('summary',t('deleteCompany')),removalHelp=el('p',t('deleteHelp'),'meta'),removalForm=el('form'),removalName=el('input'),removalButton=el('button',t('deleteCompany'),'danger');removalName.maxLength=80;removalName.required=true;removalName.autocomplete='off';removalName.setAttribute('aria-label',t('deleteConfirm'));removalButton.type='submit';removalForm.append(removalName,removalButton);removalForm.addEventListener('submit',e=>{e.preventDefault();if(removalName.value!==c.name){error(t('deleteMismatch'));return;}busy(removalButton,async()=>{await api('companies/'+c.id+'/delete',{method:'POST',body:{name:removalName.value}});shownInvites.delete(c.id);await refresh();});});removal.append(removalSummary,removalHelp,removalForm);
  card.append(actions,thread,out,removal);return card;
}
function render(){
 const target=$('#companies');target.replaceChildren();const query=$('#search').value.toLowerCase();
 const visible=companies.filter(c=>matchesDashboard(c)&&(c.name+' '+c.id+' '+c.origin+' '+c.timeZone).toLowerCase().includes(query));
 const bands=cataloguePlans.slice();if(companies.some(c=>catalogueKey(c)==='custom'))bands.push(['custom','Custom']);
 for(const [key,title] of bands){
  const members=companies.filter(c=>catalogueKey(c)===key),shown=visible.filter(c=>catalogueKey(c)===key).sort((a,b)=>a.name.localeCompare(b.name));
  const group=el('details',undefined,'company-group'+(key==='custom'?' company-group-custom':''));group.open=key!=='custom'||shown.length>0;
  const summary=el('summary');summary.append(el('span',title,'plan-name'),el('b',String(members.length),'plan-count'));
  const list=el('div',undefined,'company-group-list');
  if(!shown.length)list.append(el('p',members.length?'No companies match this view.':'No companies on this plan.','meta'));
  for(const c of shown)list.append(companyCard(c));
  group.append(summary,list);target.append(group);
 }
 const metric=(title,value,filter)=>{const node=el('button',`${title}: ${value}`,'dashboard-metric'+(dashboardFilter===filter?' selected':''));node.type='button';node.onclick=()=>{dashboardFilter=filter;render();document.querySelector('#companies').scrollIntoView({behavior:'smooth',block:'start'});};return node;};
 const totals=$('#totals');totals.replaceChildren(metric(t('total'),companies.length,'all'),metric(t('open'),companies.filter(c=>c.status==='active').length,'enabled'),metric(t('activeWorkers'),companies.reduce((n,c)=>n+(c.workers?.active||0),0),'workers'));
 const overview=$('#plan-overview');let grid=overview.querySelector('.plan-filter-grid');if(!grid){grid=el('div',undefined,'plan-filter-grid');overview.append(grid);}grid.replaceChildren();for(const [key,title] of bands)grid.append(metric(title,companies.filter(c=>catalogueKey(c)===key).length,key));
 renderAttention();
 finance.companyOptions(companies);
}
document.addEventListener('invalid',event=>{const form=event.target.closest('form');if(!form)return;event.preventDefault();event.target.setAttribute('aria-invalid','true');if(form.dataset.reported)return;form.dataset.reported='1';const missing=[...form.querySelectorAll(':invalid')].map(field=>(field.closest('label')?.innerText||field.getAttribute('aria-label')||field.name||'').replace(/\s+/g,' ').trim()).filter(Boolean);error(t('completeFields')+(missing.length?' — '+missing.join(', '):''));queueMicrotask(()=>{delete form.dataset.reported;});},true);
document.addEventListener('input',event=>{if(event.target.closest('form'))event.target.removeAttribute('aria-invalid');});
document.addEventListener('change',event=>{if(event.target.closest('form'))event.target.removeAttribute('aria-invalid');});
const finance=createFinance({api,busy,el,label});
const backups=createBackupPanel({api,busy,getCsrf:()=>csrf});
async function refresh(){companies=(await api('companies')).items;render();}
const applications=createApplications({api,busy,el,label,invite,onApproved:refresh});
async function entered(){const status=await fetch('/api/platform/status').then(r=>r.ok?r.json():null).catch(()=>null);$('#demo-notice').hidden=!status?.demo;await refresh();await applications.refresh();await finance.refresh();await backups.refresh();$('#dashboard').hidden=false;$('#login').hidden=true;$('#logout').hidden=false;}
$('#login-form').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{csrf=(await api('login',{method:'POST',body:{password:e.target.elements.password.value}})).csrf;e.target.reset();await entered();});};
const createForm=$('#create-form');if(createForm)createForm.onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{const data=await api('companies',{method:'POST',body:tariff(e.target)});e.target.reset();invite(data.inviteUrl,data.company.id);await refresh();});};
$('#refresh').onclick=e=>busy(e.target,refresh);$('#search').oninput=render;
$('#dismiss-invite').onclick=()=>{$('#invite-url').value='';$('#invitation').hidden=true;};
$('#logout').onclick=e=>busy(e.target,async()=>{await api('logout',{method:'POST',body:{}});csrf='';companies=[];$('#companies').replaceChildren();$('#invite-url').value='';$('#invitation').hidden=true;$('#dashboard').hidden=true;$('#logout').hidden=true;$('#login').hidden=false;});
try{csrf=(await api('session')).csrf;await entered();}catch{/* Unauthenticated initial visit displays login. */}
