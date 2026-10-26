import {t as translateUI} from './i18n.js';
import {applySite} from './site.js';
import {estimate, DEFAULT_PRICING} from './pricing.js';
const $ = selector => document.querySelector(selector);
const form = $('#quote');
const service=$('#service'), area=$('#area'), frequency=$('#frequency'), windows=$('#windows');
const result=$('#result'), error=$('#form-error'), submit=$('#submit-inquiry');
let currencyCode='USD',businessTimeZone='America/New_York';let currency=new Intl.NumberFormat('en-US',{style:'currency',currency:currencyCode});
let siteConfig=null;
let pricing=DEFAULT_PRICING, live=false, demoMode=false, token='', tokenAt=0, sending=false;
let requestKey=crypto.randomUUID();
const staticHost = location.hostname.endsWith('.github.io');
async function api(path, options={}) {
  const response=await fetch(new URL(path,location.href),{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...options.headers}});
  const data=await response.json().catch(()=>({error:'Server nicht erreichbar. Bitte später erneut versuchen.'}));
  if(!response.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen.');
  return data;
}
function update(){
  result.hidden=true; error.hidden=true;
  try { $('#price').value=currency.format(estimate(service.value,Number(area.value),frequency.value,windows.checked,pricing)); }
  catch { $('#price').value='Fläche prüfen'; }
}
function updatePricingLabels(){
  $('#windows-label').textContent=translateUI(`Fensterreinigung ergänzen (+${currency.format(pricing.windows)})`);
  for(const option of frequency.options){
    const base={once:translateUI('Einmalig'),weekly:translateUI('Wöchentlich'),fortnightly:translateUI('Alle 2 Wochen')}[option.value];
    const discount=Math.round((1-pricing.discounts[option.value])*100);
    option.textContent=base+(discount?` · −${discount} %`:'');
  }
  const labels={home:'Wohnung',office:'Büro',deep:translateUI('Grundreinigung')};
  const rateText=Object.entries(pricing.rates).filter(([key])=>siteConfig?.services[key]?.enabled!==false).map(([key,rate])=>`${siteConfig?.services[key]?.title||labels[key]} ${currency.format(rate)}/m²`).join(', ');
  const extra=siteConfig?.windowsEnabled===false?'':` Fenster zusätzlich ${currency.format(pricing.windows)}.`;
  $('#pricing-explanation').textContent=translateUI(`Orientierung: ${rateText}. Mindestpreis ${currency.format(pricing.minimum)}.${extra} Rabatt und Mindestpreis werden im Rechner berücksichtigt. Ein verbindliches Angebot folgt nach Abstimmung.`);
  update();
}
form.addEventListener('input',()=>{if(!sending){requestKey=crypto.randomUUID();update();}});
form.addEventListener('submit',async event=>{
  event.preventDefault(); if(sending || !form.reportValidity()) return;
  error.hidden=true;
  const email=$('#customer-email'), phone=$('#customer-phone');
  email.setCustomValidity('');
  if(!email.value.trim() && !phone.value.trim()){
    email.setCustomValidity('Bitte E-Mail oder Telefonnummer angeben.');email.reportValidity();email.setCustomValidity('');return;
  }
  if(!live && !demoMode){
    $('#message').value=`DEMO — NICHT VERSENDET\n\nName: ${$('#customer-name').value}\nE-Mail: ${email.value || '—'}\nTelefon: ${phone.value || '—'}\nPLZ: ${$('#postcode').value}\nAdresse: ${$('#address').value || 'Wird abgestimmt'}\nWunschtermin: ${$('#date').value || 'Offen'}\nLeistung: ${service.selectedOptions[0].text}\nFläche: ${area.value} m²\nRhythmus: ${frequency.selectedOptions[0].text}\nFenster: ${windows.checked?'Ja':'Nein'}\nPreisorientierung: ${$('#price').value}\nNachricht: ${$('#comments').value || '—'}`;
    $('#success-message').textContent=translateUI('Demo: Ihre Eingaben wurden zur Vorschau zusammengestellt. Es wurde nichts versendet oder auf dem Server gespeichert. Diese Vorschau erscheint nicht in der Verwaltung.');
    $('#demo-text').hidden=false;result.hidden=false;result.focus();return;
  }
  sending=true;submit.disabled=true;submit.textContent=translateUI('Wird gespeichert …');
  const inputs=[...form.querySelectorAll('input,select,textarea')];
  const payload={service:service.value,area:Number(area.value),frequency:frequency.value,windows:windows.checked,
    name:$('#customer-name').value,email:email.value,phone:phone.value,postcode:$('#postcode').value,
    address:$('#address').value,date:$('#date').value,message:$('#comments').value,
    privacy:$('#privacy').checked,website:$('#website').value};
  inputs.forEach(input=>input.disabled=true);
  try{
    if(Date.now()-tokenAt>3000000 || !token){
      token=(await api('api/form-token')).token;tokenAt=Date.now();
    }
    const wait=2100-(Date.now()-tokenAt);
    if(wait>0) await new Promise(resolve=>setTimeout(resolve,wait));
    const transmitted=demoMode?{service:payload.service,area:payload.area,frequency:payload.frequency,windows:payload.windows,privacy:payload.privacy,website:payload.website,token}:{...payload,token};
    const data=await api(demoMode?'api/demo/inquiries':'api/inquiries',{method:'POST',headers:{'Idempotency-Key':requestKey},body:JSON.stringify(transmitted)});
    $('#success-message').textContent=data.demo?`Testanfrage gespeichert. Nummer: ${data.id}. Öffnen Sie die Verwaltung und klicken Sie auf Aktualisieren. Dort erscheint „Demo-Kunde“ mit Ihren Reinigungsangaben. Kontaktdaten wurden nicht übertragen. Keine echte Buchung; Testdaten können bei einem Neustart verloren gehen.`:`Vielen Dank! Ihre Anfrage wurde gespeichert. Nummer: ${data.id}. Preisorientierung: ${currency.format(data.price)}. Dies ist noch keine Termin- oder Auftragsbestätigung.`;
    $('#demo-text').hidden=true;form.reset();requestKey=crypto.randomUUID();update();result.hidden=false;result.focus();
  }catch(err){error.textContent=translateUI(err.message);error.hidden=false;}
  finally{sending=false;inputs.forEach(input=>input.disabled=false);submit.disabled=false;submit.textContent=demoMode?translateUI('Testanfrage an Verwaltung senden ↗︎'):translateUI('Unverbindliche Anfrage senden ↗︎');}
});
document.querySelectorAll('[data-service]').forEach(link=>link.addEventListener('click',()=>{service.value=link.dataset.service;requestKey=crypto.randomUUID();update();}));
$('#legal-open').addEventListener('click',()=>$('#legal').showModal());
const setToday=()=>{$('#date').min=new Intl.DateTimeFormat('en-CA',{timeZone:businessTimeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());};setToday();
async function init(){
  updatePricingLabels();
  $('#customer-fields').disabled=false;
  if(staticHost)return;
  try{
    const config=await api('api/config');pricing=config.pricing;currencyCode=config.currency||currencyCode;businessTimeZone=config.timeZone||businessTimeZone;currency=new Intl.NumberFormat(navigator.language||'en-US',{style:'currency',currency:currencyCode});setToday();updatePricingLabels();
    if(config.site){siteConfig=config.site;applySite(config.site);updatePricingLabels();}
    update();
    demoMode=Boolean(config.demoMode);
    if(demoMode){
      $('#connection-note').textContent=translateUI('Server-Demo: Nur Reinigungsangaben werden in der Verwaltung gespeichert. Name, E-Mail, Telefon und Adresse werden NICHT übertragen; dort erscheinen feste fiktive Beispieldaten. Testdaten können bei einem Neustart verloren gehen.');
      $('#submit-note').textContent=translateUI('Testanfrage für die Verwaltung. Keine echte Buchung und kein E-Mail-Versand.');
      submit.textContent=translateUI('Testanfrage an Verwaltung senden ↗︎');
      $('#customer-name').value='Demo customer';$('#customer-email').value='demo@example.invalid';$('#postcode').value='10001';$('#address').value='123 Example Street (fictional)';
      const data=await api('api/form-token');token=data.token;tokenAt=Date.now();return;
    }
    if(!config.live)return;
    live=true;$('#customer-fields').disabled=false;
    $('#mode-banner').textContent=translateUI(`${config.site?.company.name || config.business.name} · ${config.site?.company.area || 'Your local service area'}`);
    $('#connection-note').textContent=translateUI('Unverbindliche Anfrage. Mindestens einen Kontaktweg angeben; * sind Pflichtfelder.');
    $('#submit-note').textContent=translateUI('Ihre Anfrage wird gespeichert. Ein Auftrag entsteht erst nach persönlicher Abstimmung.');
    $('#price-note').textContent=translateUI('Der Rechner zeigt eine unverbindliche Preisorientierung. Der konkrete Leistungsumfang und Endpreis werden vor einer Beauftragung abgestimmt.');
    $('.total small').textContent=config.business.priceNote;
    $('#footer-mode').textContent='Reinigungsservice';
    submit.textContent=translateUI('Unverbindliche Anfrage senden ↗︎');
    $('#legal').querySelector('p').textContent='Eine Anfrage ist unverbindlich und keine Buchungsbestätigung. Die tatsächlichen Anbieter- und Datenschutzhinweise finden Sie über die Links im Fußbereich.';
    const data=await api('api/form-token');token=data.token;tokenAt=Date.now();
  }catch{
    $('#connection-note').textContent='Der Anfragedienst ist gerade nicht erreichbar. Diese Ansicht funktioniert nur als Demo; es wird nichts versendet.';
    live=false;demoMode=false;$('#customer-fields').disabled=false;
    submit.textContent='Anfragetext vorbereiten (ohne Versand)';
    $('#submit-note').textContent='Keine Übermittlung möglich. Bitte später erneut versuchen.';
  }
}
init();
