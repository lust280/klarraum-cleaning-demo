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
  const data=await response.json().catch(()=>({error:'The service is unavailable. Please try again later.'}));
  if(!response.ok) throw new Error(data.error || 'Your inquiry could not be sent.');
  return data;
}
function update(){
  result.hidden=true; error.hidden=true;
  try { $('#price').value=currency.format(estimate(service.value,Number(area.value),frequency.value,windows.checked,pricing)); }
  catch { $('#price').value='Fläche prüfen'; }
}
function updatePricingLabels(){
  $('#windows-label').textContent=`Add window cleaning (+${currency.format(pricing.windows)})`;
  for(const option of frequency.options){
    const base={once:'Once',weekly:'Weekly',fortnightly:'Every two weeks'}[option.value];
    const discount=Math.round((1-pricing.discounts[option.value])*100);
    option.textContent=base+(discount?` · −${discount} %`:'');
  }
  const labels={home:'Home',office:'Office',deep:'Deep cleaning'};
  const rateText=Object.entries(pricing.rates).filter(([key])=>siteConfig?.services[key]?.enabled!==false).map(([key,rate])=>`${siteConfig?.services[key]?.title||labels[key]} ${currency.format(rate)}/m²`).join(', ');
  const extra=siteConfig?.windowsEnabled===false?'':` Window cleaning is an additional ${currency.format(pricing.windows)}.`;
  $('#pricing-explanation').textContent=`Estimate: ${rateText}. Minimum price ${currency.format(pricing.minimum)}. ${extra} Discounts and the minimum price are included in the calculator. A final quote follows after the details are agreed.`;
  update();
}
form.addEventListener('input',()=>{if(!sending){requestKey=crypto.randomUUID();update();}});
form.addEventListener('submit',async event=>{
  event.preventDefault(); if(sending || !form.reportValidity()) return;
  error.hidden=true;
  const email=$('#customer-email'), phone=$('#customer-phone');
  email.setCustomValidity('');
  if(!email.value.trim() && !phone.value.trim()){
    email.setCustomValidity('Please provide an email address or phone number.');email.reportValidity();email.setCustomValidity('');return;
  }
  if(!live && !demoMode){
    $('#message').value=`DEMO — NOT SENT\n\nName: ${$('#customer-name').value}\nEmail: ${email.value || '—'}\nPhone: ${phone.value || '—'}\nPostal code: ${$('#postcode').value}\nAddress: ${$('#address').value || 'To be agreed'}\nPreferred date: ${$('#date').value || 'Open'}\nService: ${service.selectedOptions[0].text}\nArea: ${area.value} m²\nFrequency: ${frequency.selectedOptions[0].text}\nWindows: ${windows.checked?'Yes':'No'}\nEstimate: ${$('#price').value}\nMessage: ${$('#comments').value || '—'}`;
    $('#success-message').textContent='Demo: your details were prepared as a preview. Nothing was sent or saved on the server. This preview does not appear in administration.';
    $('#demo-text').hidden=false;result.hidden=false;result.focus();return;
  }
  sending=true;submit.disabled=true;submit.textContent='Saving …';
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
    $('#success-message').textContent=data.demo?`Fictional test saved. Reference: ${data.id}. Open administration and select Refresh. “Demo customer” will appear with the cleaning details. Contact details were not sent. This is not a real booking; test data may be lost after a restart.`:`Thank you. Your inquiry was saved. Reference: ${data.id}. Estimate: ${currency.format(data.price)}. This is not a confirmed appointment or job.`;
    $('#demo-text').hidden=true;form.reset();requestKey=crypto.randomUUID();update();result.hidden=false;result.focus();
  }catch(err){error.textContent=translateUI(err.message);error.hidden=false;}
  finally{sending=false;inputs.forEach(input=>input.disabled=false);submit.disabled=false;submit.textContent=demoMode?'Send fictional test to owner ↗︎':'Send inquiry ↗︎';}
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
      $('#connection-note').textContent='Server demo: only cleaning details are saved in administration. Name, email, phone and address are NOT sent; fixed fictional examples appear there. Test data may be lost after a restart.';
      $('#submit-note').textContent='Fictional test for administration. No real booking or email is sent.';
      submit.textContent='Send fictional test to owner ↗︎';
      $('#customer-name').value='Demo customer';$('#customer-email').value='demo@example.invalid';$('#postcode').value='10001';$('#address').value='123 Example Street (fictional)';
      const data=await api('api/form-token');token=data.token;tokenAt=Date.now();return;
    }
    if(!config.live)return;
    live=true;$('#customer-fields').disabled=false;
    $('#mode-banner').textContent=translateUI(`${config.site?.company.name || config.business.name} · ${config.site?.company.area || 'Your local service area'}`);
    $('#connection-note').textContent='Non-binding inquiry. Provide at least one way to contact you; * fields are required.';
    $('#submit-note').textContent='Your inquiry is saved. A job begins only after a personal agreement.';
    $('#price-note').textContent='The calculator provides a non-binding estimate. The exact scope and final price are agreed before work begins.';
    $('.total small').textContent=config.business.priceNote;
    $('#footer-mode').textContent='Cleaning service';
    submit.textContent='Send inquiry ↗︎';
    $('#legal').querySelector('p').textContent='An inquiry is non-binding and does not confirm a booking. Find the provider and privacy information through the footer links.';
    const data=await api('api/form-token');token=data.token;tokenAt=Date.now();
  }catch{
    $('#connection-note').textContent='The inquiry service is unavailable. This view works as a demo only; nothing will be sent.';
    live=false;demoMode=false;$('#customer-fields').disabled=false;
    submit.textContent='Prepare inquiry text (not sent)';
    $('#submit-note').textContent='Sending is unavailable. Please try again later.';
  }
}
init();
