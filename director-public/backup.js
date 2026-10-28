import {t,lang} from './director-i18n.js';
export function createBackupPanel({api,busy,getCsrf}){
 const $=s=>document.querySelector(s);
 function scheduleLine(data){
 const when=data.automatic?t('backupDaily'):t('backupManual');
 const external=data.externalStorage==='incomplete'?t('backupExternalIncomplete'):data.externalStorage==='configured'?(data.lastScheduled?.externalStorage==='uploaded'?t('backupUploaded'):data.lastScheduled?.externalStorage==='failed'?t('backupUploadFailed'):t('backupExternalReady')):t('backupExternalOff');
 const last=data.lastScheduled?.createdAt?' '+t('backupScheduleLast')+': '+new Date(data.lastScheduled.createdAt).toLocaleString(lang)+'.':'';
 return when+' '+external+last;
}
async function refresh(){const data=await api('backups/status');const item=data.lastPrepared;$('#backup-status').textContent=(item?t('backupLast')+': '+new Date(item.createdAt).toLocaleString(lang)+' · '+item.companies+' '+t('companies')+' · '+Math.ceil(item.size/1024)+' KB. ':t('backupNone')+' ')+scheduleLine(data);}
 $('#backup-form').onsubmit=e=>{e.preventDefault();const form=e.target;busy(e.submitter,async()=>{
  const password=form.elements.backupPassword.value;if(password!==form.elements.backupRepeat.value)throw new Error(t('backupMismatch'));
  $('#backup-progress').hidden=false;
  try{
   const response=await fetch('/api/director/backups/download',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':getCsrf()},body:JSON.stringify({password})});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||t('failed'));}
   const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='klarraum-platform-'+new Date().toISOString().slice(0,10)+'.klrb';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);await refresh();
  }finally{form.reset();$('#backup-progress').hidden=true;}
 });};
 return {refresh};
}
