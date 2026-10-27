// The commercial catalogue is intentionally server-side. Browser values are
// never trusted for a plan, included seats, or price.
export const plans=Object.freeze({
  solo:Object.freeze({key:'solo',name:'Solo',baseCents:2900,included:1,seatCents:0,storageBytes:5*1024**3}),
  starter:Object.freeze({key:'starter',name:'Starter',baseCents:4900,included:3,seatCents:700,storageBytes:20*1024**3}),
  team:Object.freeze({key:'team',name:'Team',baseCents:8900,included:6,seatCents:700,storageBytes:50*1024**3}),
  growth:Object.freeze({key:'growth',name:'Growth',baseCents:14900,included:12,seatCents:600,storageBytes:100*1024**3}),
  business:Object.freeze({key:'business',name:'Business',baseCents:21900,included:20,seatCents:500,storageBytes:150*1024**3}),
  custom:Object.freeze({key:'custom',name:'Custom',baseCents:0,included:0,seatCents:0,storageBytes:0})
});

export const planList=Object.freeze(Object.values(plans));
export const extraStorageCentsPerGb=150;
export function planFor(key){return plans[key]||null;}
export function requestedPlanForWorkers(workers){
  if(!Number.isSafeInteger(workers)||workers<0) return plans.solo;
  if(workers<=1)return plans.solo;
  if(workers<=3)return plans.starter;
  if(workers<=6)return plans.team;
  if(workers<=12)return plans.growth;
  if(workers<=20)return plans.business;
  return plans.custom;
}
export function planEstimate(plan,activeWorkers=0){
  if(plan.key==='custom')return null;
  return plan.baseCents+Math.max(0,activeWorkers-plan.included)*plan.seatCents;
}
export function storageState(limitBytes,usedBytes){
  if(!limitBytes)return {level:'custom',ratio:null};
  const ratio=Math.max(0,usedBytes||0)/limitBytes;
  return {ratio,level:ratio>=.95?'critical':ratio>=.8?'warning':'ok'};
}
