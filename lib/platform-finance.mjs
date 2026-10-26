import {randomUUID} from 'node:crypto';
const bad=message=>{const e=new Error(message);e.status=400;throw e;};
export const categories=['hosting','storage','backup','email','domain','support','payment_fees','marketing','other','subscription'];
export function monthChecked(value){if(typeof value!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value))bad('Select a valid month (YYYY-MM).');return value;}
function text(value,max){if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value))bad('Invalid note.');return value.trim();}
export function checkedEntry(input){
 if(!input||!['expense','income','refund'].includes(input.type)||!categories.includes(input.category))bad('Invalid entry type or category.');
 if(!Number.isSafeInteger(input.amountCents)||input.amountCents<=0||input.amountCents>100000000)bad('Amount must be positive whole cents.');
 if(typeof input.date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(input.date)||Number.isNaN(Date.parse(input.date+'T00:00:00Z'))||new Date(input.date+'T00:00:00Z').toISOString().slice(0,10)!==input.date)bad('Invalid date.');
 if(input.companyId!==null&&(typeof input.companyId!=='string'||!/^[a-f0-9-]{36}$/.test(input.companyId)))bad('Invalid company.');
 return {type:input.type,category:input.category,amountCents:input.amountCents,date:input.date,companyId:input.companyId,note:text(input.note??'',500)};
}
const limits={companies:10000,workersPerCompany:10000,baseCents:10000000,included:100000,seatCents:1000000,fixedCents:100000000,perCompanyCents:1000000,perWorkerCents:1000000,supportMinutes:10000,hourlyCents:1000000,feeBps:5000,feeFixedCents:1000000,marginBps:9500};
export function forecast(input){
 if(!input||typeof input!=='object')bad('Invalid forecast.');
 for(const [key,max] of Object.entries(limits))if(!Number.isSafeInteger(input[key])||input[key]<0||input[key]>max)bad('Invalid forecast field: '+key);
 if(input.feeBps+input.marginBps>=10000)bad('Fees and target margin must total less than 100%.');
 const n=input.companies,workers=n*input.workersPerCompany;
 const monthlyPerCompanyCents=input.baseCents+Math.max(0,input.workersPerCompany-input.included)*input.seatCents;
 const revenueCents=n*monthlyPerCompanyCents;
 const ceilDiv=(a,b)=>(a+b-1n)/b;
 const supportCents=Number(ceilDiv(BigInt(n)*BigInt(input.supportMinutes)*BigInt(input.hourlyCents),60n));
 const costBeforeFeesCents=input.fixedCents+n*input.perCompanyCents+workers*input.perWorkerCents+supportCents;
 const feesCents=Number(ceilDiv(BigInt(revenueCents)*BigInt(input.feeBps),10000n))+n*input.feeFixedCents;
 const totalCostCents=costBeforeFeesCents+feesCents,contributionCents=revenueCents-totalCostCents;
 const required=margin=>{
  if(!n)return null;
  const count=BigInt(n),cost=BigInt(costBeforeFeesCents+n*input.feeFixedCents),fee=BigInt(input.feeBps),target=BigInt(margin);
  let price=ceilDiv(cost*10000n,count*(10000n-fee-target));
  // Percent fees round upwards to cents. Continuous division alone may miss the target by a cent.
  while((count*price-cost-ceilDiv(count*price*fee,10000n))*10000n<count*price*target)price++;
  if(price>BigInt(Number.MAX_SAFE_INTEGER))bad('Forecast exceeds supported amount.');
  return Number(price);
 };
 return {input,workers,monthlyPerCompanyCents,revenueCents,supportCents,costBeforeFeesCents,feesCents,totalCostCents,contributionCents,marginBps:revenueCents?Math.floor(contributionCents*10000/revenueCents):null,breakEvenPerCompanyCents:required(0),targetPerCompanyCents:required(input.marginBps)};
}
export class PlatformFinance {
 constructor(store){this.store=store;this.db=store.db;this.db.exec(`
 CREATE TABLE IF NOT EXISTS platform_entries(id TEXT PRIMARY KEY,type TEXT NOT NULL,category TEXT NOT NULL,amount_cents INTEGER NOT NULL,date TEXT NOT NULL,company_id TEXT,note TEXT NOT NULL,created_at INTEGER NOT NULL,voided_at INTEGER,void_reason TEXT);
 CREATE INDEX IF NOT EXISTS platform_entry_date ON platform_entries(date);
 CREATE TABLE IF NOT EXISTS platform_snapshots(id TEXT PRIMARY KEY,month TEXT NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL);
 `);}
 add(input,key){
  const row=checkedEntry(input);
  if(typeof key!=='string'||! /^[a-f0-9-]{36}$/.test(key))bad('Idempotency-Key is required.');
  if(row.companyId&&!this.store.company(row.companyId))bad('Company not found.');
  const existing=this.db.prepare('SELECT * FROM platform_entries WHERE id=?').get(key);
  if(existing){if(existing.type!==row.type||existing.category!==row.category||existing.amount_cents!==row.amountCents||existing.date!==row.date||existing.company_id!==row.companyId||existing.note!==row.note){const e=new Error('Request key already used for another entry.');e.status=409;throw e;}return existing;}
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO platform_entries(id,type,category,amount_cents,date,company_id,note,created_at) VALUES(?,?,?,?,?,?,?,?)').run(key,row.type,row.category,row.amountCents,row.date,row.companyId,row.note,Date.now());this.store.event(row.companyId,'finance_entry',{id:key,type:row.type,amountCents:row.amountCents});this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  return this.db.prepare('SELECT * FROM platform_entries WHERE id=?').get(key);
 }
 void(id,reason){
  reason=text(reason,500);if(!reason)bad('A reason is required.');
  const item=this.db.prepare('SELECT * FROM platform_entries WHERE id=?').get(id);if(!item)bad('Entry not found.');if(item.voided_at)return item;
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE platform_entries SET voided_at=?,void_reason=? WHERE id=?').run(Date.now(),reason,id);this.store.event(item.company_id,'finance_void',{id,reason});this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  return this.db.prepare('SELECT * FROM platform_entries WHERE id=?').get(id);
 }
 report(month){
  monthChecked(month);const rows=this.db.prepare('SELECT e.*,c.name AS company_name FROM platform_entries e LEFT JOIN companies c ON c.id=e.company_id WHERE substr(e.date,1,7)=? ORDER BY e.date,e.id').all(month);
  if(rows.length>5000){const e=new Error('Monthly export limit reached (5000 entries). Contact the operator.');e.status=409;throw e;}
  let incomeCents=0,refundCents=0,expenseCents=0;const byCategory={};
  for(const row of rows){if(row.voided_at)continue;if(row.type==='income')incomeCents+=row.amount_cents;else if(row.type==='refund')refundCents+=row.amount_cents;else{expenseCents+=row.amount_cents;byCategory[row.category]=(byCategory[row.category]||0)+row.amount_cents;}}
  return {month,currency:'EUR',incomeCents,refundCents,expenseCents,netCents:incomeCents-refundCents-expenseCents,byCategory,entries:rows};
 }
 snapshot(month){const report=this.report(month),id=randomUUID(),createdAt=Date.now();const value={id,createdAt,...report};this.db.prepare('INSERT INTO platform_snapshots VALUES(?,?,?,?)').run(id,month,createdAt,JSON.stringify(value));return value;}
 snapshots(month){monthChecked(month);return this.db.prepare('SELECT id,month,created_at FROM platform_snapshots WHERE month=? ORDER BY created_at DESC,id LIMIT 100').all(month);}
 getSnapshot(id){const row=this.db.prepare('SELECT payload FROM platform_snapshots WHERE id=?').get(id);if(!row){const e=new Error('Snapshot not found.');e.status=404;throw e;}return JSON.parse(row.payload);}
}
export function financeCsv(report){
 const cell=value=>{let s=String(value??'');if(/^[\s]*[=+@\-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const rows=[['date','type','category','amount_EUR','company_id','company_name','note','voided_at','void_reason'],...report.entries.map(x=>[x.date,x.type,x.category,(x.amount_cents/100).toFixed(2),x.company_id,x.company_name,x.note,x.voided_at?new Date(x.voided_at).toISOString():'',x.void_reason])];
 return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
