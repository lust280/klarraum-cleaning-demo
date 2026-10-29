// The commercial catalogue is intentionally server-side. Browser values are
// never trusted for a plan, included seats, or price.
// Partner self-serve tariffs are locked in lib/partner-admin.mjs
// (Starter €49 / 2 seats, Pro €89 / 5, Plus €149 / 10, 5-day Pro trial).
// This list still feeds the director console until that wave switches over.
export const plans=Object.freeze({
  // Extra-seat prices are the smallest round dollars that make the next plan
  // strictly cheaper once headcount reaches that plan's included seats.
  // Solo $15 (2 seats × $15 = $30 > $20). Starter $15, not $12 (3 × $12 = $36 < $40).
  // Team $12, not $10 (6 × $10 only ties Business). Business $10, not $8 (8 × $8 = $64 < $70).
  // Scale's 21st–25th seats at $10 cost more than moving to Plus ($259).
  // Plus stays self-serve above 25 seats at $8; Custom is only a negotiated plan.
  solo:Object.freeze({key:'solo',name:'Solo',baseCents:2900,included:1,seatCents:1500,storageBytes:5*1024**3}),
  starter:Object.freeze({key:'starter',name:'Starter',baseCents:4900,included:3,seatCents:1500,storageBytes:20*1024**3}),
  team:Object.freeze({key:'team',name:'Team',baseCents:8900,included:6,seatCents:1200,storageBytes:50*1024**3}),
  growth:Object.freeze({key:'growth',name:'Business',baseCents:14900,included:12,seatCents:1000,storageBytes:100*1024**3}),
  business:Object.freeze({key:'business',name:'Scale',baseCents:21900,included:20,seatCents:1000,storageBytes:150*1024**3}),
  plus:Object.freeze({key:'plus',name:'Plus',baseCents:25900,included:25,seatCents:800,storageBytes:250*1024**3}),
  custom:Object.freeze({key:'custom',name:'Custom',baseCents:0,included:0,seatCents:0,storageBytes:0})
});

export const planList=Object.freeze(Object.values(plans));
export const extraStorageCentsPerGb=150;
export const customDomainCents=9900;
const planOrder=['solo','starter','team','growth','business','plus'];
export function nextPlan(key){const index=planOrder.indexOf(key);return index>=0&&index<planOrder.length-1?plans[planOrder[index+1]]:null;}
export function planFor(key){return plans[key]||null;}
export function requestedPlanForWorkers(workers){
  if(!Number.isSafeInteger(workers)||workers<0) return plans.solo;
  if(workers<=1)return plans.solo;
  if(workers<=3)return plans.starter;
  if(workers<=6)return plans.team;
  if(workers<=12)return plans.growth;
  if(workers<=20)return plans.business;
  return plans.plus;
}
export function planEstimate(plan,activeWorkers=0){
  if(plan.key==='custom')return null;
  return plan.baseCents+Math.max(0,activeWorkers-plan.included)*plan.seatCents;
}
export function overagePrefersUpgrade(key){
  const plan=plans[key],upcoming=nextPlan(key);
  if(!plan||!upcoming)return null;
  return planEstimate(plan,upcoming.included)>upcoming.baseCents;
}
export function storageState(limitBytes,usedBytes){
  if(!limitBytes)return {level:'custom',ratio:null};
  const ratio=Math.max(0,usedBytes||0)/limitBytes;
  return {ratio,level:ratio>=.95?'critical':ratio>=.8?'warning':'ok'};
}
