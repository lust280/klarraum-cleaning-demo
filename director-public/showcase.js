import {salesPlans, salesCurrencies, formatSalesPrice, currencyFromAcceptLanguage} from '/plans.mjs';

const copy={
 en:{
  features:'Features',pricing:'Pricing',login:'Log in',trial:'Start free trial →',
  hero:'Your cleaning business website and ops in one place',
  site:'Site',calculator:'Calculator',schedule:'Schedule',team:'Team',reports:'Reports',
  workers:'Included seats',
  featSite:'Site with calculator',featOwner:'Owner cabinet',featEmployee:'Employee app',featReports:'Monthly PDF & CSV reports',
  supportStarter:'Email and the Help thread',supportPro:'Priority support',supportPlus:'Priority support and a personal contact',
  choose:'Choose',trialBadge:'5-day trial',per:'/ month',trialNote:'5 days free, no card',
  flatPrice:'Flat monthly price. No per-seat fee.',addonPrice:'Paid add-on',
  domain:'Custom domain',domainHelp:'Add your own domain (for example, yourcleaning.com).',request:'Add add-on',
  loginNote:'Owners sign in on their own company address, then open Company administration.',
  assist:'Need a negotiated Custom plan? Request assisted setup.',
  googleTitle:'Continue with Google',
  googleHelp:'Choose a plan, then continue with Google. We open your company on that plan, start the 5-day Pro trial, and sign you in as the owner. No card.',
  googleMissing:'Google sign-in is not set up on this server yet. You can still confirm a trial by email below.',
  googleDenied:'Google sign-in was cancelled. Choose the plan and continue when you are ready.',
  googleContinue:'Continue with Google',
  emailTrial:'Prefer email confirmation',
  retention:'Photos and other media are kept on a 12-month rolling basis. Older media may be removed so storage stays comfortable for the plan.',
  currencyLabel:'Currency',languageLabel:'Language',
  trialTitle:'Start your 5-day trial',
  trialLead:'No card required. Pro is',
  trialAfter:'per month after the 5-day trial.',
  companyName:'Company name',yourName:'Your name',businessEmail:'Work email',plan:'Plan',language:'Language',
  sendEmail:'Send confirmation email',
  consent:'I agree to the <a href="/platform-terms.html">Terms</a> and acknowledge the <a href="/platform-privacy.html">Privacy Policy</a>.',
  demoNote:'This is a public demonstration. Use a fictional email ending in .invalid.',
  assistTitle:'Request assisted setup',
  assistLead:'For a negotiated Custom plan or a move from another system. This does not create an account or a charge.',
  phone:'Phone',country:'Country',workersCount:'Workers',note:'Note',
  assistConsent:'Klarraum may use these details to review this request.',
  sendRequest:'Send request',
  required:'Please complete the required fields and accept the consent checkbox.',
  sending:'Sending the confirmation email…',
  sendingButton:'Sending confirmation…',
  sent:'Confirmation email sent. Open its link to create the workspace password.',
  demoIntro:'Confirmation would be sent by email. ',
  demoLink:'Demo: open the confirmation link',
  sendingRequest:'Sending your request…',
  sendingRequestButton:'Sending application…',
  sentRequest:'Application received. We will review it before creating any account.',
  failed:'The request could not be completed. Please try again.',
 },
 de:{
  features:'Funktionen',pricing:'Preise',login:'Anmelden',trial:'Kostenlos testen →',
  hero:'Website und Betrieb Ihrer Reinigungsfirma an einem Ort',
  site:'Seite',calculator:'Rechner',schedule:'Planung',team:'Team',reports:'Berichte',
  workers:'Plätze inklusive',
  featSite:'Seite mit Rechner',featOwner:'Inhaberkabinett',featEmployee:'Mitarbeiter-App',featReports:'Monatsberichte PDF & CSV',
  supportStarter:'E-Mail und Hilfe-Thread',supportPro:'Bevorzugter Support',supportPlus:'Bevorzugter Support und eine persönliche Kontaktperson',
  choose:'Wählen',trialBadge:'5 Tage testen',per:'/ Monat',trialNote:'5 Tage kostenlos, ohne Karte',
  flatPrice:'Fester Monatspreis. Keine Gebühr pro Platz.',addonPrice:'Kostenpflichtiges Add-on',
  domain:'Eigene Domain',domainHelp:'Eigene Adresse, zum Beispiel ihrefirma.de.',request:'Add-on',
  loginNote:'Inhaber melden sich über die Adresse ihrer Firma an und öffnen dann die Verwaltung.',
  assist:'Individueller Tarif? Einrichtung anfragen.',
  googleTitle:'Mit Google fortfahren',
  googleHelp:'Plan wählen und mit Google fortfahren. Wir öffnen die Firma auf diesem Plan, starten die 5-tägige Pro-Testphase und melden Sie als Inhaber an. Keine Karte.',
  googleMissing:'Google-Anmeldung ist auf diesem Server noch nicht eingerichtet. Die Testphase kann weiterhin per E-Mail bestätigt werden.',
  googleDenied:'Google-Anmeldung wurde abgebrochen. Wählen Sie den Plan und fahren Sie fort, wenn Sie bereit sind.',
  googleContinue:'Mit Google fortfahren',
  emailTrial:'Lieber per E-Mail bestätigen',
  retention:'Fotos und andere Medien bleiben 12 Monate im rollierenden Speicher. Ältere Medien können entfernt werden, damit der Speicher zum Plan passt.',
  currencyLabel:'Währung',languageLabel:'Sprache',
  trialTitle:'5-Tage-Test starten',
  trialLead:'Keine Karte nötig. Pro kostet',
  trialAfter:'pro Monat nach der 5-Tage-Testphase.',
  companyName:'Firmenname',yourName:'Ihr Name',businessEmail:'Geschäftliche E-Mail',plan:'Plan',language:'Sprache',
  sendEmail:'Bestätigungsmail senden',
  consent:'Ich akzeptiere die <a href="/platform-terms.html">Bedingungen</a> und nehme die <a href="/platform-privacy.html">Datenschutzerklärung</a> zur Kenntnis.',
  demoNote:'Dies ist eine öffentliche Demonstration. Verwenden Sie eine erfundene E-Mail mit der Endung .invalid.',
  assistTitle:'Einrichtung anfragen',
  assistLead:'Für einen individuellen Tarif oder einen Wechsel aus einem anderen System. Es entsteht kein Konto und keine Belastung.',
  phone:'Telefon',country:'Land',workersCount:'Mitarbeiter',note:'Notiz',
  assistConsent:'Klarraum darf diese Angaben zur Prüfung der Anfrage verwenden.',
  sendRequest:'Anfrage senden',
  required:'Bitte füllen Sie die Pflichtfelder aus und akzeptieren Sie die Einwilligung.',
  sending:'Die Bestätigungsmail wird gesendet…',
  sendingButton:'Wird gesendet…',
  sent:'Bestätigungsmail gesendet. Öffnen Sie den Link, um das Passwort des Inhabers zu erstellen.',
  demoIntro:'Die Bestätigung würde per E-Mail gesendet. ',
  demoLink:'Demo: Bestätigungslink öffnen',
  sendingRequest:'Ihre Anfrage wird gesendet…',
  sendingRequestButton:'Anfrage wird gesendet…',
  sentRequest:'Anfrage erhalten. Wir prüfen sie, bevor ein Konto entsteht.',
  failed:'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.',
 },
 ru:{
  features:'Возможности',pricing:'Цены',login:'Войти',trial:'Начать пробный период →',
  hero:'Сайт и работа клининговой компании в одном месте',
  site:'Сайт',calculator:'Калькулятор',schedule:'Расписание',team:'Команда',reports:'Отчёты',
  workers:'Мест включено',
  featSite:'Сайт с калькулятором',featOwner:'Кабинет владельца',featEmployee:'Приложение сотрудника',featReports:'Месячные отчёты PDF и CSV',
  supportStarter:'Почта и ветка помощи',supportPro:'Приоритетная поддержка',supportPlus:'Приоритетная поддержка и личный контакт',
  choose:'Выбрать',trialBadge:'5 дней пробного периода',per:'/ месяц',trialNote:'5 дней бесплатно, без карты',
  flatPrice:'Фиксированная цена в месяц. Без доплаты за место.',addonPrice:'Платное дополнение',
  domain:'Свой домен',domainHelp:'Подключите свой домен, например yourcleaning.com.',request:'Добавить',
  loginNote:'Владельцы входят по адресу своей компании и открывают управление.',
  assist:'Нужен индивидуальный тариф? Запросите помощь с настройкой.',
  googleTitle:'Продолжить с Google',
  googleHelp:'Выберите тариф и продолжите с Google. Мы откроем компанию на этом тарифе, начнём 5-дневный пробный период Pro и войдём как владелец. Карта не нужна.',
  googleMissing:'Вход через Google на этом сервере ещё не настроен. Пробный период можно подтвердить по почте.',
  googleDenied:'Вход через Google отменён. Выберите тариф и продолжите, когда будете готовы.',
  googleContinue:'Продолжить с Google',
  emailTrial:'Лучше подтвердить по почте',
  retention:'Фото и другие файлы хранятся 12 месяцев скользящим окном. Более старые файлы могут быть удалены, чтобы хранилище соответствовало тарифу.',
  currencyLabel:'Валюта',languageLabel:'Язык',
  trialTitle:'Начать 5-дневный пробный период',
  trialLead:'Карта не нужна. Pro стоит',
  trialAfter:'в месяц после 5-дневного пробного периода.',
  companyName:'Название компании',yourName:'Ваше имя',businessEmail:'Рабочая почта',plan:'Тариф',language:'Язык',
  sendEmail:'Отправить письмо для подтверждения',
  consent:'Я принимаю <a href="/platform-terms.html">Условия</a> и ознакомлен с <a href="/platform-privacy.html">Политикой конфиденциальности</a>.',
  demoNote:'Это публичная демонстрация. Используйте вымышленный адрес с окончанием .invalid.',
  assistTitle:'Запросить помощь с настройкой',
  assistLead:'Для индивидуального тарифа или переноса из другой системы. Аккаунт и списание не создаются.',
  phone:'Телефон',country:'Страна',workersCount:'Сотрудники',note:'Комментарий',
  assistConsent:'Klarraum может использовать эти данные, чтобы рассмотреть запрос.',
  sendRequest:'Отправить запрос',
  required:'Заполните обязательные поля и отметьте согласие.',
  sending:'Отправляем письмо…',
  sendingButton:'Отправка…',
  sent:'Письмо отправлено. Откройте ссылку, чтобы задать пароль владельца.',
  demoIntro:'Подтверждение было бы отправлено по почте. ',
  demoLink:'Демо: открыть ссылку подтверждения',
  sendingRequest:'Отправляем запрос…',
  sendingRequestButton:'Отправка заявки…',
  sentRequest:'Заявка получена. Мы рассмотрим её до создания аккаунта.',
  failed:'Запрос не выполнен. Попробуйте ещё раз.',
 },
};
const publicPlans=['starter','pro','plus'];
function stored(key){try{return localStorage.getItem(key);}catch{return null;}}
function store(key,value){try{localStorage.setItem(key,value);}catch{/* Keep it for this visit. */}}
function initialLanguage(){
  const saved=stored('klarraum-showcase-lang');
  if(saved==='de'||saved==='ru'||saved==='en')return saved;
  const stamped=document.documentElement.dataset.locale;
  if(stamped==='de'||stamped==='ru'||stamped==='en')return stamped;
  const tag=(navigator.language||'en').toLowerCase();
  if(tag.startsWith('de'))return 'de';
  if(tag.startsWith('ru'))return 'ru';
  return 'en';
}
function initialCurrency(){
  const query=new URLSearchParams(location.search).get('currency');
  if(salesCurrencies.includes(query))return query;
  const saved=stored('klarraum-showcase-currency');
  if(salesCurrencies.includes(saved))return saved;
  const stamped=document.documentElement.dataset.currency;
  if(salesCurrencies.includes(stamped))return stamped;
  const list=navigator.languages?.length?navigator.languages:[navigator.language||''];
  return currencyFromAcceptLanguage(list.filter(Boolean).join(','));
}
let language=initialLanguage();
let currency=initialCurrency();
let chosenPlan=new URLSearchParams(location.search).get('plan');
if(!publicPlans.includes(chosenPlan))chosenPlan='pro';
function priceFor(key){
  return formatSalesPrice(salesPlans[key].amounts[currency],currency);
}
function paint(){
  document.documentElement.dataset.currency=currency;
  for(const node of document.querySelectorAll('[data-sales-price]')){
    const key=node.dataset.salesPrice;
    const price=priceFor(key);
    if(node.tagName==='OPTION')node.textContent=`${salesPlans[key].name} — ${price}`;
    else if(/[€$£]\d+/.test(node.textContent))node.textContent=node.textContent.replace(/[€$£]\d+/,price);
    else node.textContent=price;
  }
  for(const input of document.querySelectorAll('[data-sales-currency]'))input.value=currency;
  for(const button of document.querySelectorAll('[data-currency-choice]'))button.setAttribute('aria-pressed',String(button.dataset.currencyChoice===currency));
  const link=document.querySelector('#google-start');
  const email=document.querySelector('#email-trial');
  if(link)link.href=`/api/google/signup/start?plan=${encodeURIComponent(chosenPlan)}&currency=${encodeURIComponent(currency)}`;
  if(email){
    email.dataset.plan=chosenPlan;
    if(email.tagName==='A')email.href=`/for-companies.html?plan=${encodeURIComponent(chosenPlan)}&currency=${encodeURIComponent(currency)}#trial-panel`;
  }
  for(const button of document.querySelectorAll('[data-choose-plan]'))button.setAttribute('aria-pressed',String(button.dataset.choosePlan===chosenPlan));
}
function render(){
  const text=copy[language]||copy.en;
  document.documentElement.lang=language;
  for(const node of document.querySelectorAll('[data-i18n]')){if(text[node.dataset.i18n])node.textContent=text[node.dataset.i18n];}
  for(const node of document.querySelectorAll('[data-i18n-html]')){if(text[node.dataset.i18nHtml])node.innerHTML=text[node.dataset.i18nHtml];}
  for(const node of document.querySelectorAll('[data-i18n-label]')){if(text[node.dataset.i18nLabel])node.setAttribute('aria-label',text[node.dataset.i18nLabel]);}
  for(const button of document.querySelectorAll('[data-lang]'))button.setAttribute('aria-pressed',String(button.dataset.lang===language));
  globalThis.__klarraumSales={language,currency,text};
  paint();
}
for(const button of document.querySelectorAll('[data-lang]'))button.addEventListener('click',()=>{
  language=button.dataset.lang==='ru'?'ru':button.dataset.lang==='de'?'de':'en';
  store('klarraum-showcase-lang',language);
  render();
});
for(const button of document.querySelectorAll('[data-currency-choice]'))button.addEventListener('click',()=>{
  if(!salesCurrencies.includes(button.dataset.currencyChoice))return;
  currency=button.dataset.currencyChoice;
  store('klarraum-showcase-currency',currency);
  const url=new URL(location.href);
  url.searchParams.set('currency',currency);
  url.searchParams.set('plan',chosenPlan);
  history.replaceState(null,'',url.pathname+url.search+url.hash);
  render();
});
render();
for(const button of document.querySelectorAll('[data-choose-plan]'))button.addEventListener('click',()=>{
  chosenPlan=publicPlans.includes(button.dataset.choosePlan)?button.dataset.choosePlan:chosenPlan;
  const url=new URL(location.href);
  url.searchParams.set('plan',chosenPlan);
  url.searchParams.set('currency',currency);
  url.hash='google-signup';
  history.replaceState(null,'',url.pathname+url.search+url.hash);
  paint();
  document.querySelector('#google-signup')?.scrollIntoView({behavior:'smooth',block:'start'});
});
document.addEventListener('klarraum-sales-refresh',()=>{currency=initialCurrency();render();});
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
