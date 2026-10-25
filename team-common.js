export const labels={assigned:'Geplant',working:'In Arbeit',paused:'Pausiert',submitted:'Zur Prüfung',closed:'Abgenommen',cancelled:'Storniert'};
export function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
export function button(label,fn,className='secondary'){const node=el('button',label,'button small '+className);node.type='button';node.addEventListener('click',async()=>{node.disabled=true;try{await fn();}finally{node.disabled=false;}});return node;}
export function hours(milliseconds){return (milliseconds/3600000).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' Std.';}
export function duration(milliseconds){const seconds=Math.floor(Math.max(0,milliseconds)/1000);return `${Math.floor(seconds/3600).toString().padStart(2,'0')}:${Math.floor(seconds/60)%60<10?'0':''}${Math.floor(seconds/60)%60}:${(seconds%60).toString().padStart(2,'0')}`;}
export function displayJob(job){
 const card=el('article',undefined,'inquiry job-card');card.dataset.job=job.id;
 const head=el('div',undefined,'inquiry-head');head.append(el('h2',job.title),el('span',labels[job.state],'badge'));card.append(head);
 card.append(el('p',`${job.scheduled_date} · ${job.scheduled_time} Uhr (Deutschland) · ${job.region}`,'meta'));
 const grid=el('div',undefined,'inquiry-grid');
 for(const text of [`Objekt: ${job.address}`,`Kontakt: ${job.customer||'—'} · ${job.contact||'—'}`,`Mitarbeiter: ${job.employeeName}`,`Geplant: ${job.planned_minutes} Minuten`])grid.append(el('p',text));card.append(grid);
 const time=el('strong',duration(job.workedMilliseconds),'work-time');card.append(time);
 if(job.state==='working'){time.dataset.timerBase=String(job.workedMilliseconds);time.dataset.timerStarted=String(performance.now());}
 card.append(el('p','Auftragszeit (Stunden:Minuten:Sekunden), keine vollständige Arbeitszeit- oder Lohnabrechnung.','fine left'));
 if(job.instructions)card.append(el('p',job.instructions));
 if(job.review_note)card.append(el('p','Rückmeldung: '+job.review_note,'form-notice'));
 if(job.report)card.append(el('p','Bericht: '+job.report));
 if(['submitted','closed'].includes(job.state)){const list=el('ul');for(const item of job.checklist)list.append(el('li',(item.done?'✓ ':'○ ')+item.text));card.append(list);}
 if(job.photos?.length){const photos=el('div',undefined,'job-photos');for(const item of job.photos){const link=el('a');link.href=item.url;link.target='_blank';link.rel='noopener';const img=el('img');img.src=item.url;img.alt='Privates Arbeitsfoto zum Auftrag';img.loading='lazy';link.append(img);photos.append(link);}card.append(photos);}
 return card;
}
setInterval(()=>{for(const node of document.querySelectorAll('[data-timer-base]'))node.textContent=duration(Number(node.dataset.timerBase)+performance.now()-Number(node.dataset.timerStarted));},1000);
