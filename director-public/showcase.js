const copy={
 en:{
  features:'Features',pricing:'Pricing',login:'Log in',trial:'Start free trial →',
  hero:'Your cleaning business website and ops in one place',
  site:'Site',calculator:'Calculator',schedule:'Schedule',team:'Team',reports:'Reports',
  workers:'Included workers',storage:'Photo storage',
  featSite:'Site with calculator',featOwner:'Owner cabinet',featEmployee:'Employee app',featReports:'Monthly PDF & CSV reports',
  choose:'Choose',best:'Best value',per:'/ month',
  domain:'Custom domain',domainHelp:'Add your own domain (for example, yourcleaning.com).',once:'one-time',request:'Add add-on',
  loginNote:'Owners sign in on their own company address, then open Company administration.',
  assist:'Need a negotiated Custom plan? Request assisted setup.',
  googleTitle:'Continue with Google',
  googleHelp:'Choose a plan, then continue with Google. We open your company on that plan, start the 15-day trial, and sign you in as the owner. No card.',
  googleMissing:'Google sign-in is not set up on this server yet. You can still confirm a trial by email below.',
  googleContinue:'Continue with Google',
  emailTrial:'Prefer email confirmation',
  retention:'Photos and other media are kept on a 12-month rolling basis. Older media may be removed so storage stays comfortable for the plan.',
 },
 de:{
  features:'Funktionen',pricing:'Preise',login:'Anmelden',trial:'Kostenlos testen →',
  hero:'Website und Betrieb Ihrer Reinigungsfirma an einem Ort',
  site:'Seite',calculator:'Rechner',schedule:'Planung',team:'Team',reports:'Berichte',
  workers:'Mitarbeiter inklusive',storage:'Fotospeicher',
  featSite:'Seite mit Rechner',featOwner:'Inhaberkabinett',featEmployee:'Mitarbeiter-App',featReports:'Monatsberichte PDF & CSV',
  choose:'Wählen',best:'Beste Wahl',per:'/ Monat',
  domain:'Eigene Domain',domainHelp:'Eigene Adresse, zum Beispiel ihrefirma.de.',once:'einmalig',request:'Add-on',
  loginNote:'Inhaber melden sich über die Adresse ihrer Firma an und öffnen dann die Verwaltung.',
  assist:'Individueller Tarif? Einrichtung anfragen.',
  googleTitle:'Mit Google fortfahren',
  googleHelp:'Plan wählen und mit Google fortfahren. Wir öffnen die Firma auf diesem Plan, starten die 15-Tage-Testphase und melden Sie als Inhaber an. Keine Karte.',
  googleMissing:'Google-Anmeldung ist auf diesem Server noch nicht eingerichtet. Die Testphase kann weiterhin per E-Mail bestätigt werden.',
  googleContinue:'Mit Google fortfahren',
  emailTrial:'Lieber per E-Mail bestätigen',
  retention:'Fotos und andere Medien bleiben 12 Monate im rollierenden Speicher. Ältere Medien können entfernt werden, damit der Speicher zum Plan passt.',
 },
};
let language='en';
try{if(localStorage.getItem('klarraum-showcase-lang')==='de')language='de';}catch{/* Storage can be blocked. */}
function render(){
 const text=copy[language];
 document.documentElement.lang=language;
 for(const node of document.querySelectorAll('[data-i18n]')){if(text[node.dataset.i18n])node.textContent=text[node.dataset.i18n];}
 for(const button of document.querySelectorAll('[data-lang]'))button.setAttribute('aria-pressed',String(button.dataset.lang===language));
}
for(const button of document.querySelectorAll('[data-lang]'))button.addEventListener('click',()=>{language=button.dataset.lang==='de'?'de':'en';try{localStorage.setItem('klarraum-showcase-lang',language);}catch{/* Keep it for this visit. */}render();});
render();
const publicPlans=['solo','starter','team','growth','business','plus'];
let chosenPlan=new URLSearchParams(location.search).get('plan');
if(!publicPlans.includes(chosenPlan))chosenPlan='team';
function applyChosenPlan(){
 const link=document.querySelector('#google-start');
 const email=document.querySelector('#email-trial');
 if(link)link.href='/api/google/signup/start?plan='+encodeURIComponent(chosenPlan);
 if(email){email.dataset.plan=chosenPlan;if(email.tagName==='A')email.href='/for-companies.html?plan='+encodeURIComponent(chosenPlan)+'#trial-panel';}
 for(const button of document.querySelectorAll('[data-choose-plan]'))button.setAttribute('aria-pressed',String(button.dataset.choosePlan===chosenPlan));
}
applyChosenPlan();
for(const button of document.querySelectorAll('[data-choose-plan]'))button.addEventListener('click',()=>{
 chosenPlan=publicPlans.includes(button.dataset.choosePlan)?button.dataset.choosePlan:chosenPlan;
 applyChosenPlan();
 history.replaceState(null,'',location.pathname+'?plan='+encodeURIComponent(chosenPlan)+'#google-signup');
 document.querySelector('#google-signup')?.scrollIntoView({behavior:'smooth',block:'start'});
});
const denied=document.querySelector('#google-denied');
if(denied&&new URLSearchParams(location.search).get('google')==='denied')denied.hidden=false;
const startLink=document.querySelector('#google-start'),missing=document.querySelector('#google-missing');
if(startLink){
 fetch('/api/google/signup/status').then(response=>response.ok?response.json():{enabled:false}).then(data=>{
  const enabled=Boolean(data?.enabled);
  startLink.hidden=!enabled;
  if(missing)missing.hidden=enabled;
 }).catch(()=>{startLink.hidden=true;if(missing)missing.hidden=false;});
}
