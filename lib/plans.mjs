// Public self-serve catalogue. Marketing, signup, and partner billing use the
// same three euro plans. Browser values are never trusted for a plan, seats,
// or price. There is no per-seat fee: a fuller team moves to the next plan.
// Partner Admin (lib/partner-admin.mjs) is the same ladder:
// Starter €49 / 2 seats, Pro €89 / 5, Plus €149 / 10, 5-day Pro trial.
export const plans=Object.freeze({
  starter:Object.freeze({key:'starter',name:'Starter',baseCents:4900,included:2,seatCents:0,storageBytes:20*1024**3}),
  pro:Object.freeze({key:'pro',name:'Pro',baseCents:8900,included:5,seatCents:0,storageBytes:50*1024**3}),
  plus:Object.freeze({key:'plus',name:'Plus',baseCents:14900,included:10,seatCents:0,storageBytes:100*1024**3}),
  custom:Object.freeze({key:'custom',name:'Custom',baseCents:0,included:0,seatCents:0,storageBytes:0})
});

export const planList=Object.freeze(Object.values(plans));
export const extraStorageCentsPerGb=150;
export const customDomainCents=9900;
const planOrder=['starter','pro','plus'];
export function nextPlan(key){const index=planOrder.indexOf(key);return index>=0&&index<planOrder.length-1?plans[planOrder[index+1]]:null;}
export function planFor(key){return plans[key]||null;}
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
