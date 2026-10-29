// Public self-serve catalogue. Marketing, signup, and partner billing use the
// same three plans. The face amount is the same in EUR, USD, and GBP. This is
// a catalogue, not a live exchange rate. Browser values are never trusted for
// a plan, seats, or price. There is no per-seat fee: a fuller team moves to
// the next plan. Partner Admin (lib/partner-admin.mjs) is the same ladder:
// Starter 49 / 2 seats, Pro 89 / 5, Plus 149 / 10, 5-day Pro trial.
export const plans=Object.freeze({
  starter:Object.freeze({key:'starter',name:'Starter',baseCents:4900,included:2,seatCents:0,storageBytes:20*1024**3}),
  pro:Object.freeze({key:'pro',name:'Pro',baseCents:8900,included:5,seatCents:0,storageBytes:50*1024**3}),
  plus:Object.freeze({key:'plus',name:'Plus',baseCents:14900,included:10,seatCents:0,storageBytes:100*1024**3}),
  custom:Object.freeze({key:'custom',name:'Custom',baseCents:0,included:0,seatCents:0,storageBytes:0})
});

export const planList=Object.freeze(Object.values(plans));
export const extraStorageCentsPerGb=150;
export const customDomainCents=9900;
export const salesCurrencies=Object.freeze(['EUR','USD','GBP']);
export const salesPlans=Object.freeze({
  starter:Object.freeze({key:'starter',name:'Starter',seats:2,amounts:Object.freeze({EUR:4900,USD:4900,GBP:4900})}),
  pro:Object.freeze({key:'pro',name:'Pro',seats:5,trialDays:5,amounts:Object.freeze({EUR:8900,USD:8900,GBP:8900})}),
  plus:Object.freeze({key:'plus',name:'Plus',seats:10,amounts:Object.freeze({EUR:14900,USD:14900,GBP:14900})})
});
export const salesDomainCents=9900;
export const salesTimeZone=Object.freeze({EUR:'Europe/Berlin',USD:'America/New_York',GBP:'Europe/London'});
const salesSymbols=Object.freeze({EUR:'€',USD:'$',GBP:'£'});
const planOrder=['starter','pro','plus'];
export function nextPlan(key){const index=planOrder.indexOf(key);return index>=0&&index<planOrder.length-1?plans[planOrder[index+1]]:null;}
export function planFor(key){return plans[key]||null;}
export function normalizeSalesCurrency(value){
  const code=String(value||'').trim().toUpperCase();
  return salesCurrencies.includes(code)?code:'';
}
export function formatSalesPrice(cents,currency){
  const code=normalizeSalesCurrency(currency)||'EUR';
  const amount=Math.round(Number(cents)||0)/100;
  return `${salesSymbols[code]}${Number.isInteger(amount)?String(amount):amount.toFixed(2)}`;
}
function parseAccept(header){
  return String(header||'').split(',').map((part,index)=>{
    const [raw,...params]=part.trim().split(';');
    let q=1;
    for(const param of params){
      const [key,value]=param.trim().split('=');
      if(key==='q')q=Number(value);
    }
    return {tag:raw.trim(),q:Number.isFinite(q)?q:0,index};
  }).filter(item=>item.tag&&item.tag!=='*'&&item.q>0).sort((a,b)=>b.q-a.q||a.index-b.index);
}
export function currencyFromLocale(tag){
  const parts=String(tag||'').trim().toLowerCase().replace(/_/g,'-').split('-').filter(Boolean);
  if(parts.includes('us'))return 'USD';
  if(parts.includes('gb')||parts.includes('uk'))return 'GBP';
  return 'EUR';
}
export function currencyFromAcceptLanguage(header){
  const items=parseAccept(header);
  return items.length?currencyFromLocale(items[0].tag):'EUR';
}
export function languageFromAcceptLanguage(header){
  for(const item of parseAccept(header)){
    const lang=item.tag.toLowerCase().split('-')[0];
    if(lang==='de'||lang==='ru'||lang==='en')return lang;
  }
  return 'en';
}
export function resolveSignupPlan(planKey,currency){
  const plan=plans[planKey];
  if(!plan||plan.key==='custom')return null;
  const code=normalizeSalesCurrency(currency)||'EUR';
  return {key:plan.key,name:plan.name,baseCents:plan.baseCents,included:plan.included,seatCents:plan.seatCents,storageBytes:plan.storageBytes,currency:code,sales:true,trialDays:5};
}
export function applySalesRequest(html,acceptLanguage=''){
  const currency=currencyFromAcceptLanguage(acceptLanguage);
  const language=languageFromAcceptLanguage(acceptLanguage);
  let out=String(html);
  out=out.replace(/<html\b([^>]*)>/,(full,attrs)=>{
    let next=attrs;
    next=next.includes('data-currency=')?next.replace(/data-currency="[A-Z]{3}"/,`data-currency="${currency}"`):`${next} data-currency="${currency}"`;
    next=next.includes('data-locale=')?next.replace(/data-locale="[a-z]{2}"/,`data-locale="${language}"`):`${next} data-locale="${language}"`;
    return `<html${next}>`;
  });
  out=out.replace(/data-currency-choice="(EUR|USD|GBP)" aria-pressed="(?:true|false)"/g,(_,choice)=>`data-currency-choice="${choice}" aria-pressed="${choice===currency}"`);
  out=out.replace(/data-sales-currency value="(?:EUR|USD|GBP)"/g,`data-sales-currency value="${currency}"`);
  out=out.replace(/([?&]currency=)(EUR|USD|GBP)/g,`$1${currency}`);
  out=out.replace(/data-sales-price="(starter|pro|plus|domain)"([^>]*)>([^<]*)</g,(match,key,attrs,text)=>{
    const cents=key==='domain'?salesDomainCents:salesPlans[key].amounts[currency];
    const price=formatSalesPrice(cents,currency);
    const next=/[€$£]\d+/.test(text)?text.replace(/[€$£]\d+/,price):price;
    return `data-sales-price="${key}"${attrs}>${next}<`;
  });
  return out;
}
export function requestedPlanForWorkers(workers){
  if(!Number.isSafeInteger(workers)||workers<0) return plans.starter;
  if(workers<=2)return plans.starter;
  if(workers<=5)return plans.pro;
  return plans.plus;
}
export function planEstimate(plan,activeWorkers=0){
  if(plan.key==='custom')return null;
  return plan.baseCents+Math.max(0,activeWorkers-plan.included)*plan.seatCents;
}
export function overagePrefersUpgrade(key){
  const plan=plans[key],upcoming=nextPlan(key);
  if(!plan||!upcoming||!plan.seatCents)return null;
  return planEstimate(plan,upcoming.included)>upcoming.baseCents;
}
export function storageState(limitBytes,usedBytes){
  if(!limitBytes)return {level:'custom',ratio:null};
  const ratio=Math.max(0,usedBytes||0)/limitBytes;
  return {ratio,level:ratio>=.95?'critical':ratio>=.8?'warning':'ok'};
}
