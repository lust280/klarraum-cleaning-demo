import {t as translateUI} from './i18n.js';
import {applySite} from './site.js';
import {estimate, DEFAULT_PRICING} from './pricing.js';
const $ = selector => document.querySelector(selector);
const form = $('#quote');
const service=$('#service'), area=$('#area'), frequency=$('#frequency'), windows=$('#windows');
const result=$('#result'), error=$('#form-error'), submit=$('#submit-inquiry');
let currencyCode='USD',businessTimeZone='America/New_York';let currency=new Intl.NumberFormat('en-US',{style:'currency',currency:currencyCode});
let siteConfig=null;
let bookingConfig={enabled:true,dateEnabled:true,timeEnabled:true};
let pricing=DEFAULT_PRICING, live=false, demoMode=false, token='', tokenAt=0, sending=false;
let requestKey=crypto.randomUUID();
let tipPercent=0;
let areaUnit='metric';
const SQUARE_FEET_PER_SQUARE_METRE=10.7639;
const areaInSquareMetres=()=>areaUnit==='imperial'?Math.round(Number(area.value)/SQUARE_FEET_PER_SQUARE_METRE):Number(area.value);
function setAreaUnit(unit,{convert=true}={}){
  if(unit===areaUnit)return;
  const current=Number(area.value)||0;
  area.value=String(convert?(unit==='imperial'?Math.round(current*SQUARE_FEET_PER_SQUARE_METRE):Math.round(current/SQUARE_FEET_PER_SQUARE_METRE)):current);
  areaUnit=unit;
  area.min=unit==='imperial'?'215':'20';area.max=unit==='imperial'?'10764':'1000';
  $('#area-unit').textContent=unit==='imperial'?'ft²':'m²';
  $('#area-help').textContent=unit==='imperial'?'Square feet':'Square metres';
  document.querySelectorAll('[data-unit]').forEach(button=>button.classList.toggle('active',button.dataset.unit===unit));
  update();
}
const staticHost = location.hostname.endsWith('.github.io');
async function api(path, options={}) {
  const response=await fetch(new URL(path,location.href),{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...options.headers}});
  const data=await response.json().catch(()=>({error:'The service is unavailable. Please try again later.'}));
  if(!response.ok) throw new Error(data.error || 'Your inquiry could not be sent.');
  return data;
}
function syncAreaRange(){
  const range=$('#area-range');
  if(!range)return;
  range.min=area.min;range.max=area.max;range.value=area.value;
}
function update(){
  result.hidden=true; error.hidden=true;
  syncAreaRange();
  try { const cleaningPrice=estimate(service.value,areaInSquareMetres(),frequency.value,windows.checked,pricing);const tipAmount=Math.round(cleaningPrice*tipPercent)/100;$('#price').value=currency.format(cleaningPrice+tipAmount);$('#summary-base').textContent=currency.format(cleaningPrice);const tipSummary=$('#tip-summary');tipSummary.hidden=tipPercent===0;$('#summary-tip').textContent=currency.format(tipAmount); }
  catch { $('#price').value='Check area';$('#summary-base').textContent='—';$('#tip-summary').hidden=true; }
  const selectedService=service.selectedOptions[0]?.textContent||'';
  const selectedFrequency=frequency.selectedOptions[0]?.textContent||'';
  const summaryService=$('#summary-service'),summaryFrequency=$('#summary-frequency');
  if(summaryService)summaryService.textContent=selectedService;if(summaryFrequency)summaryFrequency.textContent=selectedFrequency;
  document.querySelectorAll('[data-service-select]').forEach(button=>button.classList.toggle('active',button.dataset.serviceSelect===service.value));
  document.querySelectorAll('[data-frequency]').forEach(button=>button.classList.toggle('active',button.dataset.frequency===frequency.value));
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
    $('#message').value=`DEMO — NOT SENT\n\nName: ${$('#customer-name').value}\nEmail: ${email.value || '—'}\nPhone: ${phone.value || '—'}\nPostal code: ${$('#postcode').value}\nAddress: ${$('#address').value || 'To be agreed'}\nPreferred date: ${$('#date').value || 'Open'}\nService: ${service.selectedOptions[0].text}\nArea: ${areaInSquareMetres()} m²\nTip: ${tipPercent}%\nFrequency: ${frequency.selectedOptions[0].text}\nWindows: ${windows.checked?'Yes':'No'}\nEstimate: ${$('#price').value}\nMessage: ${$('#comments').value || '—'}`;
    $('#success-message').textContent='Demo: your details were prepared as a preview. Nothing was sent or saved on the server. This preview does not appear in administration.';
    $('#demo-text').hidden=false;result.hidden=false;result.focus();return;
  }
  sending=true;submit.disabled=true;submit.textContent='Saving …';
  const inputs=[...form.querySelectorAll('input,select,textarea')];
  const payload={service:service.value,area:areaInSquareMetres(),frequency:frequency.value,windows:windows.checked,tipPercent,
    name:$('#customer-name').value,email:email.value,phone:phone.value,postcode:$('#postcode').value,
    address:$('#address').value,date:bookingConfig.dateEnabled?$('#date').value:'',preferredTime:bookingConfig.timeEnabled?$('#preferred-time').value:'',message:$('#comments').value,
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
    $('#success-message').textContent=data.demo?`Fictional test saved. Reference: ${data.id.slice(0,8)}. It is visible in administration as “Demo customer”. No contact details were sent.`:`Thank you. Your inquiry was saved. Reference: ${data.id}. Estimate: ${currency.format(data.price)}. This is not a confirmed appointment or job.`;
    $('#demo-text').hidden=true;form.reset();tipPercent=0;document.querySelectorAll('[data-tip]').forEach(option=>option.classList.toggle('active',Number(option.dataset.tip)===0));requestKey=crypto.randomUUID();update();result.hidden=false;result.focus();
  }catch(err){error.textContent=translateUI(err.message);error.hidden=false;}
  finally{sending=false;inputs.forEach(input=>input.disabled=false);submit.disabled=false;submit.textContent=demoMode?'Send fictional test to owner ↗︎':'Send request →';}
});
document.querySelectorAll('[data-service]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();service.value=link.dataset.service;requestKey=crypto.randomUUID();update();}));
document.querySelectorAll('[data-frequency]').forEach(button=>button.addEventListener('click',()=>{frequency.value=button.dataset.frequency;requestKey=crypto.randomUUID();update();}));
document.querySelectorAll('[data-tip]').forEach(button=>button.addEventListener('click',()=>{tipPercent=Number(button.dataset.tip);document.querySelectorAll('[data-tip]').forEach(option=>option.classList.toggle('active',Number(option.dataset.tip)===tipPercent));requestKey=crypto.randomUUID();update();}));
document.querySelectorAll('[data-unit]').forEach(button=>button.addEventListener('click',()=>{setAreaUnit(button.dataset.unit);requestKey=crypto.randomUUID();}));
$('#area-range')?.addEventListener('input',()=>{area.value=$('#area-range').value;requestKey=crypto.randomUUID();update();});
$('#legal-open').addEventListener('click',()=>$('#legal').showModal());
const setToday=()=>{$('#date').min=new Intl.DateTimeFormat('en-CA',{timeZone:businessTimeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());};setToday();
async function init(){
  updatePricingLabels();
  $('#customer-fields').disabled=false;
  if(staticHost)return;
  try{
    const config=await api('api/config');pricing=config.pricing;currencyCode=config.currency||currencyCode;businessTimeZone=config.timeZone||businessTimeZone;currency=new Intl.NumberFormat(navigator.language||'en-US',{style:'currency',currency:currencyCode});setToday();if(currencyCode==='USD')setAreaUnit('imperial');updatePricingLabels();
    if(config.site){siteConfig=config.site;if(config.site.tipEnabled===false)tipPercent=0;bookingConfig={...bookingConfig,...(config.site.booking||{})};applySite(config.site);updatePricingLabels();}
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
    if(!bookingConfig.enabled){ $('#connection-note').textContent='Online requests are currently paused. Please contact the company directly.'; return; }
    live=true;$('#customer-fields').disabled=false;
    $('#mode-banner').textContent=translateUI(`${config.site?.company.name || config.business.name} · ${config.site?.company.area || 'Your local service area'}`);
    $('#connection-note').textContent='Non-binding estimate. Add a way to reach you.';
    $('#submit-note').textContent='Your inquiry is saved. A job begins only after a personal agreement.';
    $('#price-note').textContent='Confirmed before work starts.';
    $('.total small').textContent=config.business.priceNote;
    $('#footer-mode').textContent='Cleaning service';
    submit.textContent='Send request →';
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
