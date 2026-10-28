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
  assist:'Need 21+ workers? Request assisted setup.',
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
  assist:'Mehr als 20 Mitarbeiter? Einrichtung anfragen.',
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
