import {plans} from '/plans.mjs';
const copy={
 en:{
  heroTitle:'Run your cleaning business from one place.',
  heroBody:'Klarraum gives every company its own workspace for customer requests, team planning, completed work and monthly records.',
  domainTitle:'Start quickly. Connect your own domain later.',
  domainBody:'Your workspace receives a KlarraumApp address automatically. A custom domain is a one-time $99 setup, not a monthly fee.',
  kicker:'Plans',
  title:'Same tools. More seats and storage as you grow.',
  trial:'Start 15-day trial',
  workers:'Workers included',
  storage:'Photo and media storage',
  features:'Customer page, jobs, calendar, reports, owner and employee access',
  included:'Included',
  domainNote:'Custom domain is a one-time $99 setup. It is not added to the monthly price.',
  custom:'21+ workers are priced individually.',
  month:'/ month',
 },
 de:{
  heroTitle:'Reinigungsbetrieb an einem Ort führen.',
  heroBody:'Klarraum gibt jeder Firma einen eigenen Arbeitsbereich für Anfragen, Einsatzplanung, abgeschlossene Arbeit und Monatsberichte.',
  domainTitle:'Schnell starten. Eigene Domain später verbinden.',
  domainBody:'Der Arbeitsbereich erhält automatisch eine KlarraumApp-Adresse. Eine eigene Domain kostet einmalig 99 $, nicht monatlich.',
  kicker:'Tarife',
  title:'Gleiche Funktionen. Mehr Plätze und Speicher, wenn das Team wächst.',
  trial:'15 Tage testen',
  workers:'Enthaltene Mitarbeiter',
  storage:'Foto- und Medienspeicher',
  features:'Kundenseite, Einsätze, Kalender, Berichte, Inhaber- und Mitarbeiterzugang',
  included:'Enthalten',
  domainNote:'Eine eigene Domain kostet einmalig 99 $. Sie kommt nicht zum Monatspreis dazu.',
  custom:'Ab 21 Mitarbeitern wird der Preis einzeln vereinbart.',
  month:'/ Monat',
 },
};
const order=['solo','starter','team','growth','business'];
let language='en';
try{if(localStorage.getItem('klarraum-showcase-lang')==='de')language='de';}catch{/* Private browsing can block storage. */}
function text(key){return copy[language][key];}
function dollars(cents){return '$'+cents/100;}
function storage(bytes){return Math.round(bytes/1024**3)+' GB';}
function render(root){
 if(!root)return;
 const t=text;
 const head=order.map(key=>{const plan=plans[key];return `<th scope="col"><b>${plan.name}</b><strong>${dollars(plan.baseCents)}</strong><small>${t('month')}</small><a href="/for-companies.html?plan=${plan.key}#trial-panel">${t('trial')}</a></th>`;}).join('');
 root.innerHTML=`<p class="eyebrow">${t('kicker')}</p><h2>${t('title')}</h2><div class="compare-scroll"><table class="compare"><thead><tr><th scope="col"></th>${head}</tr></thead><tbody>
 <tr><th scope="row">${t('workers')}</th>${order.map(key=>`<td>${plans[key].included}</td>`).join('')}</tr>
 <tr><th scope="row">${t('storage')}</th>${order.map(key=>`<td>${storage(plans[key].storageBytes)}</td>`).join('')}</tr>
 <tr><th scope="row">${t('features')}</th>${order.map(()=>`<td>${t('included')}</td>`).join('')}</tr>
 </tbody></table></div><p class="domain-note">${t('domainNote')}</p><p class="domain-note">${t('custom')}</p>`;
}
function apply(){
 document.documentElement.lang=language;
 for(const node of document.querySelectorAll('[data-t]'))node.textContent=text(node.dataset.t);
 for(const button of document.querySelectorAll('[data-lang]'))button.setAttribute('aria-pressed',String(button.dataset.lang===language));
 render(document.querySelector('#plan-compare'));
}
for(const button of document.querySelectorAll('[data-lang]'))button.addEventListener('click',()=>{language=button.dataset.lang;try{localStorage.setItem('klarraum-showcase-lang',language);}catch{/* Keep the choice for this visit. */}apply();});
apply();
