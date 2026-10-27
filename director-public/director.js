import {t,money,translate,errorText} from './director-i18n.js';
import {createFinance} from './director-finance.js';
import {createBackupPanel} from './director-backup.js';
import {createApplications} from './director-applications.js';
translate();
let csrf='',companies=[];
const $=s=>document.querySelector(s);
function error(message=''){$('#error').textContent=errorText(message);$('#error').hidden=!message;}
async function api(path,options={}){const response=await fetch('/api/director/'+path,{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...options.headers},body:options.body===undefined?undefined:JSON.stringify(options.body)});const data=await response.json();if(!response.ok){if(response.status===401){$('#dashboard').hidden=true;$('#login').hidden=false;$('#logout').hidden=true;}throw new Error(data.error||t('failed'));}return data;}
function el(tag,text,cls){const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(cls)item.className=cls;return item;}
function label(text,name,value,type='text'){const node=el('label',text),input=el('input');Object.assign(input,{name,value,type,required:true});if(type==='number'){input.min='0';input.max='100000';input.step=name==='included'?'1':'0.01';}else input.maxLength=80;node.append(input);return node;}
function select(text,name,value,choices){const node=el('label',text),input=el('select');input.name=name;for(const [key,title] of choices){const option=el('option',title);option.value=key;option.selected=key===value;input.append(option);}node.append(input);return node;}
const catalogue={solo:{baseCents:2900,included:1,seatCents:0},starter:{baseCents:4900,included:3,seatCents:700},team:{baseCents:8900,included:6,seatCents:700},growth:{baseCents:14900,included:12,seatCents:600},business:{baseCents:21900,included:20,seatCents:500},custom:{baseCents:0,included:0,seatCents:0}};
const planChoices=[['solo','Solo — $29'],['starter','Starter — $49'],['team','Team — $89'],['growth','Growth — $149'],['business','Business — $219'],['custom','Custom']];
const tariff=form=>{const planKey=form.elements.planKey?.value||'custom',plan=catalogue[planKey]||catalogue.custom;return {name:form.elements.name.value,planKey,...plan};};
const day=value=>value?new Date(value).toISOString().slice(0,10):'';
function teamBand(c){const n=c.workers?.active||0;return n===0?[0,'No active employees']:n<=5?[1,'1–5 employees']:n<=10?[2,'6–10 employees']:n<=15?[3,'11–15 employees']:n<=50?[4,'16–50 employees']:[5,'51+ employees'];}
function invite(url){$('#invite-url').value=url;$('#invitation').hidden=false;$('#invite-url').focus();$('#invite-url').select();}
async function busy(button,task){button.disabled=true;error();try{await task();}catch(e){error(e.message);}finally{button.disabled=false;}}
function render(){
 const target=$('#companies');target.replaceChildren();const query=$('#search').value.toLowerCase();let last=-1,groupTarget=target;
 for(const c of companies.filter(c=>(c.name+' '+c.id+' '+c.origin+' '+c.timeZone).toLowerCase().includes(query)).sort((a,b)=>teamBand(a)[0]-teamBand(b)[0]||a.name.localeCompare(b.name))){
  const [band,title]=teamBand(c);if(band!==last){last=band;const group=el('details',undefined,'company-group'),summary=el('summary',title);groupTarget=el('div',undefined,'company-group-list');group.append(summary,groupTarget);target.append(group);}
  const card=el('article',undefined,'company-card payment-'+c.payment);card.append(el('h2',c.name),el('p',`${title} · ${c.timeZone} · joined ${new Date(c.createdAt).toLocaleDateString(document.documentElement.lang)}`,'meta'));
  const gb=bytes=>`${(bytes/1024**3).toFixed(bytes>=10*1024**3?0:1)} GB`;card.append(el('p',`Plan: ${c.planName} · ${c.storageLimitBytes?`${gb(c.storageBytes)} of ${gb(c.storageLimitBytes)} used (${c.storageState.level})`:'storage agreed individually'}`,'meta'));
  const link=el('a',t('openSite'));link.href=c.origin;link.target='_blank';link.rel='noopener';card.append(link);
  const w=c.workers;card.append(el('p',w?`${t('active')}: ${w.active} · ${t('invited')}: ${w.invited} · ${t('disabled')}: ${w.disabled}`:t('unavailable')));
  card.append(el('p',`${t('owner')}: ${t(c.activated?'activated':'pending')} · ${t('access')}: ${t(c.status==='active'?'open':'suspended')} · payment: ${c.payment} · due: ${day(c.paymentDueAt)||day(c.trialEndsAt)||'not set'}`,'payment-summary'));
  card.append(el('p',c.estimatedCents===null?t('unavailable'):`${t('estimate')}: ${money(c.baseCents)} + ${Math.max(0,w.active-c.included)} × ${money(c.seatCents)} = ${money(c.estimatedCents)}/${t('monthUnit')}`));if(c.trialEndsAt)card.append(el('p',`Trial ends: ${new Date(c.trialEndsAt).toLocaleDateString(document.documentElement.lang)}`,'meta'));
  const form=el('form');form.append(label(t('name'),'name',c.name),select('Plan','planKey',c.planKey,planChoices),select(t('access'),'status',c.status,[['active',t('open')],['suspended',t('suspended')]]),select(t('payment'),'payment',c.payment,[['trial',t('trial')],['paid',t('paid')],['overdue',t('overdue')]]),label('Next payment due','paymentDueAt',day(c.paymentDueAt),'date'),label('Last payment received','lastPaidAt',day(c.lastPaidAt),'date'));
  const save=el('button',t('save'));form.append(save);form.addEventListener('submit',e=>{e.preventDefault();busy(save,async()=>{await api('companies/'+c.id,{method:'PUT',body:{...tariff(form),status:form.elements.status.value,payment:form.elements.payment.value,paymentDueAt:form.elements.paymentDueAt.value||null,lastPaidAt:form.elements.lastPaidAt.value||null,version:c.version}});await refresh();});});card.append(form);
  const actions=el('div',undefined,'actions');const support=el('button',c.unreadSupport?`Support (${c.unreadSupport})`:'Support','secondary'),thread=el('div',undefined,'support-thread');support.onclick=()=>busy(support,async()=>{const data=await api('companies/'+c.id+'/support');thread.replaceChildren(...data.items.map(item=>el('p',`${new Date(item.created_at).toLocaleString(document.documentElement.lang)} · ${item.sender}: ${item.body}`,item.sender==='company'?'support-company':'support-director')));const reply=el('form'),input=el('textarea');input.maxLength=4000;input.required=true;input.placeholder='Reply to company';const send=el('button','Send reply');reply.append(input,send);reply.onsubmit=e=>{e.preventDefault();busy(send,async()=>{await api('companies/'+c.id+'/support',{method:'POST',body:{message:input.value}});support.click();});};thread.append(reply);});actions.append(support);if(!c.activated){const button=el('button',t('newInvite'),'secondary');button.onclick=()=>busy(button,async()=>{const data=await api('companies/'+c.id+'/invite',{method:'POST',body:{}});invite(data.inviteUrl);await refresh();});actions.append(button);}
  if(c.payment==='trial'){const extend=el('button','Add 15 trial days','secondary');extend.onclick=()=>busy(extend,async()=>{await api('companies/'+c.id+'/trial/extend',{method:'POST',body:{}});await refresh();});actions.append(extend);}
  const history=el('button',t('history'),'secondary'),out=el('pre');history.onclick=()=>busy(history,async()=>{const data=await api('companies/'+c.id+'/events');out.textContent=data.items.map(x=>new Date(x.created_at).toLocaleString(document.documentElement.lang)+' · '+x.action+'\n'+x.details).join('\n\n');});actions.append(history);card.append(actions,thread,out);groupTarget.append(card);
 }
 const totals=$('#totals');totals.replaceChildren(el('p',`${t('total')}: ${companies.length}`),el('p',`${t('open')}: ${companies.filter(c=>c.status==='active').length}`),el('p',`${t('activeWorkers')}: ${companies.reduce((n,c)=>n+(c.workers?.active||0),0)}${companies.some(c=>!c.workers)?' ('+t('partial')+')':''}`));
 if(!companies.length)target.append(el('p',t('empty')));finance.companyOptions(companies);
}
const finance=createFinance({api,busy,el,label});
const backups=createBackupPanel({api,busy,getCsrf:()=>csrf});
async function refresh(){companies=(await api('companies')).items;render();}
const applications=createApplications({api,busy,el,label,invite,onApproved:refresh});
async function entered(){await refresh();await applications.refresh();await finance.refresh();await backups.refresh();$('#dashboard').hidden=false;$('#login').hidden=true;$('#logout').hidden=false;}
$('#login-form').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{csrf=(await api('login',{method:'POST',body:{password:e.target.elements.password.value}})).csrf;e.target.reset();await entered();});};
$('#create-form').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{const data=await api('companies',{method:'POST',body:tariff(e.target)});e.target.reset();invite(data.inviteUrl);await refresh();});};
$('#refresh').onclick=e=>busy(e.target,refresh);$('#search').oninput=render;
$('#dismiss-invite').onclick=()=>{$('#invite-url').value='';$('#invitation').hidden=true;};
$('#logout').onclick=e=>busy(e.target,async()=>{await api('logout',{method:'POST',body:{}});csrf='';companies=[];$('#companies').replaceChildren();$('#invite-url').value='';$('#invitation').hidden=true;$('#dashboard').hidden=true;$('#logout').hidden=true;$('#login').hidden=false;});
try{csrf=(await api('session')).csrf;await entered();}catch{/* Unauthenticated initial visit displays login. */}
