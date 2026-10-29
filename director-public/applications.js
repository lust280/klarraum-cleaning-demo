const text={applicationsEmpty:'There are no company applications yet.',applicant:'Applicant',workers:'Workers',applicationStatus:'Application status',new:'New',reviewing:'Reviewing',rejected:'Rejected',approved:'Approved',approveTrial:'Approve and start 5-day trial',foundingGranted:'Founding-company offer assigned.',foundingNotGranted:'Standard trial; founding offer limit is already used.',save:'Save',name:'Name'};
const t=key=>text[key]||key;

export function createApplications({api,busy,el,label,invite,onApproved}) {
 let items=[];const $=s=>document.querySelector(s);
 const select=(text,name,value,choices)=>{const node=el('label',text),input=el('select');input.name=name;for(const [key,title] of choices){const option=el('option',title);option.value=key;option.selected=key===value;input.append(option);}node.append(input);return node;};
 const moneyLabel=(text,name,value,step='0.01')=>{const node=label(text,name,value,'number'),input=node.querySelector('input');input.step=step;input.min='0';return node;};
 function render(){
  const target=$('#applications');target.replaceChildren();
  if(!items.length){target.append(el('p',t('applicationsEmpty')));return;}
  for(const item of items){
   const card=el('article');card.append(el('h3',item.companyName),el('p',`${t('applicant')}: ${item.ownerName} · ${item.email}`));
   if(item.phone||item.country)card.append(el('p',[item.phone,item.country].filter(Boolean).join(' · '),'meta'));
   card.append(el('p',`${t('workers')}: ${item.workers} · Plan: ${item.planKey} · ${t('applicationStatus')}: ${t(item.status)}`));
   if(item.note)card.append(el('p',item.note));
   card.append(el('p',new Date(item.createdAt).toLocaleString(document.documentElement.lang),'meta'));
   if(item.status==='approved'){card.append(el('p',item.foundingOffer?t('foundingGranted'):t('foundingNotGranted')));target.append(card);continue;}
   const statusForm=el('form');statusForm.append(select(t('applicationStatus'),'status',item.status,[['new',t('new')],['reviewing',t('reviewing')],['rejected',t('rejected')]]));const save=el('button',t('save'),'secondary');statusForm.append(save);statusForm.addEventListener('submit',event=>{event.preventDefault();busy(save,async()=>{await api('applications/'+item.id+'/status',{method:'PUT',body:{status:statusForm.elements.status.value,version:item.version}});await refresh();});});card.append(statusForm);
   if(item.status!=='rejected'){
    const approve=el('details');approve.append(el('summary',t('approveTrial')));const form=el('form');
    form.append(label(t('name'),'name',item.companyName));
    const button=el('button',t('approveTrial'));form.append(button);form.addEventListener('submit',event=>{event.preventDefault();busy(button,async()=>{const result=await api('applications/'+item.id+'/approve',{method:'POST',body:{name:form.elements.name.value,version:item.version}});invite(result.inviteUrl);await onApproved();await refresh();});});approve.append(form);card.append(approve);
   }
   target.append(card);
  }
 }
 async function refresh(){items=(await api('applications')).items;render();}
 return {refresh};
}
