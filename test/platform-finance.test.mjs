import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DirectorStore} from '../lib/director-store.mjs';
import {PlatformFinance,forecast,checkedEntry,financeCsv} from '../lib/platform-finance.mjs';
const scenario={companies:10,workersPerCompany:10,baseCents:7900,included:3,seatCents:500,fixedCents:5000,perCompanyCents:200,perWorkerCents:50,supportMinutes:60,hourlyCents:2000,feeBps:300,feeFixedCents:30,marginBps:3000};
test('forecast separates revenue, support, fees and target margin with cent rounding',()=>{
 const r=forecast(scenario);assert.equal(r.monthlyPerCompanyCents,11400);assert.equal(r.revenueCents,114000);assert.equal(r.supportCents,20000);assert.equal(r.costBeforeFeesCents,32000);assert.equal(r.feesCents,3720);assert.equal(r.totalCostCents,35720);assert.equal(r.contributionCents,78280);assert.equal(r.breakEvenPerCompanyCents,3330);assert.equal(r.targetPerCompanyCents,4821);
 // The rounded target must cover costs and the selected margin, and one cent less must not.
 const revenue=r.targetPerCompanyCents*scenario.companies;
 assert.ok(revenue-r.costBeforeFeesCents-scenario.companies*scenario.feeFixedCents-Math.ceil(revenue*scenario.feeBps/10000)>=revenue*.30);
 const tiny=forecast({...scenario,companies:1,workersPerCompany:0,fixedCents:99,perCompanyCents:0,perWorkerCents:0,supportMinutes:0,feeFixedCents:0});
 const tinyRevenue=tiny.targetPerCompanyCents;assert.ok((tinyRevenue-99-Math.ceil(tinyRevenue*.03))*10000>=tinyRevenue*3000);
 const none=forecast({...scenario,companies:0});assert.equal(none.breakEvenPerCompanyCents,null);assert.equal(none.targetPerCompanyCents,null);assert.equal(none.marginBps,null);assert.equal(none.contributionCents,-5000);
 assert.throws(()=>forecast({...scenario,marginBps:9700}));assert.throws(()=>forecast({...scenario,feeBps:3000,marginBps:7000}));assert.throws(()=>forecast({...scenario,companies:-1}));assert.throws(()=>forecast({...scenario,fixedCents:0.5}));
});
test('actual ledger preserves corrections, request retries, monthly boundaries and immutable snapshots',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'platform-finance-'));let store=new DirectorStore(join(dir,'director.sqlite')),finance=new PlatformFinance(store);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const company=store.create({name:'Fictional company',baseCents:7900,included:3,seatCents:500}).row;
 const entry=(type,amount,date='2026-10-26',note='Test')=>({type,amountCents:amount,date,note,category:type==='expense'?'hosting':'subscription',companyId:null});
 const key=randomUUID(),expense=entry('expense',2900,'2026-10-01','=SUM(A1:A3)');finance.add(expense,key);finance.add(expense,key);
 assert.throws(()=>finance.add({...expense,amountCents:3000},key));finance.add({...entry('income',11400),companyId:company.id},randomUUID());finance.add(entry('refund',1000),randomUUID());finance.add(entry('expense',9000,'2026-11-01'),randomUUID());
 let report=finance.report('2026-10');assert.equal(report.entries.length,3);assert.equal(report.incomeCents,11400);assert.equal(report.refundCents,1000);assert.equal(report.expenseCents,2900);assert.equal(report.netCents,7500);
 const snapshot=finance.snapshot('2026-10');finance.void(key,'Duplicate supplier bill');finance.void(key,'Retry');report=finance.report('2026-10');assert.equal(report.expenseCents,0);assert.equal(report.entries.length,3);assert.equal(report.entries.find(x=>x.id===key).void_reason,'Duplicate supplier bill');assert.equal(finance.getSnapshot(snapshot.id).expenseCents,2900);assert.equal(finance.snapshots('2026-10').length,1);
 assert.ok(financeCsv(snapshot).includes("'=SUM(A1:A3)"));assert.throws(()=>finance.add({...entry('expense',100),companyId:randomUUID()},randomUUID()));assert.throws(()=>finance.report('2026-13'));assert.throws(()=>checkedEntry(entry('income',100,'2026-02-30')));assert.throws(()=>finance.void(key,''));
 store.close();store=new DirectorStore(join(dir,'director.sqlite'));finance=new PlatformFinance(store);assert.equal(finance.getSnapshot(snapshot.id).netCents,7500);assert.equal(finance.report('2026-10').netCents,10400);
});
