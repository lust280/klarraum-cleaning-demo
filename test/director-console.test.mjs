import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDirector,directorConfig} from '../director.mjs';
import {hashPassword} from '../lib/security.mjs';
import {
  DEMO_NOW, TRIAL_DAYS, attention, cleared, clock, createConsole, endingTrials,
  filterCompanies, formatDate, formatEuro, groupByPlan, paymentsView, replyToThread,
  saasPlans, seatsUsed, supportBadge, trialDaysLeft,
} from '../lib/director-console.mjs';

test('pilot plans, trial length and demo attention stay inside the operator rules',()=>{
  assert.deepEqual(['starter','pro','plus'].map(key=>[saasPlans[key].name,saasPlans[key].monthlyCents,saasPlans[key].seats]),[
    ['Starter',4900,2],['Pro',8900,5],['Plus',14900,10],
  ]);
  assert.equal(TRIAL_DAYS,5);
  assert.equal(clock(DEMO_NOW),'10:42');
  assert.equal(formatDate('2026-11-12'),'12 Nov 2026');
  assert.equal(formatEuro(8900),'€89.00');
  const model=createConsole();
  for(const company of model.companies){
    assert.equal(seatsUsed(company),company.team.filter(member=>member.role!=='Admin').length);
    assert.ok(seatsUsed(company)<=saasPlans[company.plan].seats);
    const days=trialDaysLeft(company,model.now);
    if(company.status==='trial')assert.ok(days>=0&&days<=TRIAL_DAYS);
  }
  assert.equal(trialDaysLeft({status:'trial',trialEnds:'2026-11-03'},DEMO_NOW),5);
  assert.equal(trialDaysLeft({status:'trial',trialEnds:'2026-11-04'},DEMO_NOW),6);
  const late=structuredClone(model.companies[0]);
  late.id='late';late.status='trial';late.trialEnds='2026-11-04';late.listName='Late Co';
  const withLate={...model,companies:[...model.companies,late]};
  assert.equal(endingTrials(withLate).some(item=>item.companyId==='late'),false);
  const board=attention(model);
  assert.deepEqual(board.trials.map(item=>[item.name,item.days]),[['Fresh Clean',2]]);
  assert.deepEqual(board.support.map(item=>item.topic),['Payment question','Calendar not syncing']);
  assert.equal(board.support.some(item=>/past due/i.test(item.topic+item.name)),false);
  assert.equal(board.storage.length,1);
  assert.equal(board.storage[0].name,'Fresh Clean');
  assert.equal(board.clear,false);
  assert.equal(board.total,4);
  assert.equal(attention(cleared(model)).clear,true);
  assert.equal(supportBadge(model),2);
  for(const company of model.companies){
    assert.notEqual(`${seatsUsed(company)} / ${saasPlans[company.plan].seats}`,'8 / 10');
    assert.equal(company.name,company.listName);
  }
});

test('companies filter by status and the payments panel is read-only demo data',()=>{
  const model=createConsole();
  assert.deepEqual(filterCompanies(model.companies,{status:'trial'}).map(company=>company.id),['fresh']);
  assert.deepEqual(filterCompanies(model.companies,{status:'past_due'}).map(company=>company.id),['cleanpro']);
  assert.deepEqual(filterCompanies(model.companies,{query:'sparkle'}).map(company=>company.id),['sparkle']);
  assert.deepEqual(groupByPlan(model.companies).map(group=>group.plan.name),['Starter','Pro','Plus']);
  const paid=paymentsView(model.companies.find(company=>company.id==='sparkle'));
  assert.equal(paid.live,false);
  assert.equal(paid.saas.rows[0][1],'Pro €89/mo');
  assert.equal(paid.saas.rows[1][1],'Active');
  assert.match(paid.saas.rows[3][1],/€89\.00 Paid/);
  assert.equal(paid.connect.note,'Partner money · read-only');
  assert.equal(paid.connect.rows[0][1],'Connected');
  assert.match(paid.connect.rows[1][1],/•/);
  const pastDue=paymentsView(model.companies.find(company=>company.id==='cleanpro'));
  assert.equal(pastDue.saas.rows[1][1],'Past due');
  assert.match(pastDue.saas.rows[3][1],/Failed/);
  assert.equal(pastDue.connect.rows[0][1],'Connected');
  const trial=paymentsView(model.companies.find(company=>company.id==='fresh'));
  assert.equal(trial.saas.rows[1][1],'Trial');
  assert.equal(trial.saas.rows[3][1],'No card');
  assert.equal(trial.connect.rows[0][1],'Not connected');
  assert.equal(paymentsView(model.companies.find(company=>company.id==='blitz')).connect.rows[0][1],'Error');
  assert.equal(paymentsView(model.companies.find(company=>company.id==='nordhaus')).connect.rows[0][1],'Disconnected');
  const ended=paymentsView({...model.companies.find(company=>company.id==='fresh'),status:'readonly',subscription:{status:'readonly',nextInvoice:null,lastPayment:null}});
  assert.equal(ended.saas.rows[1][1],'Read-only');
  assert.deepEqual(ended.saas.rows[2],['Booking','Paused']);
  assert.deepEqual(ended.saas.rows[4],['Still open','Billing, Help, and Export']);
  assert.equal(ended.live,false);
  const reply=replyToThread(model,'cleanpro','<img src=x onerror="window.__xss=1">');
  assert.equal(reply.messages.at(-1).body,'<img src=x onerror="window.__xss=1">');
  assert.equal(reply.messages.at(-1).sender,'operator');
  assert.equal(reply.unread,0);
  assert.equal(supportBadge(model),1);
  assert.throws(()=>replyToThread(model,'cleanpro','   '),/1–4000/);
  assert.equal(createConsole().threads.find(thread=>thread.companyId==='cleanpro').unread,1);
});

test('operator sign-in link is single use and demo Google is not a production login',async t=>{
  const passwordHash=await hashPassword('director-console-password');
  const directory=await mkdtemp(join(tmpdir(),'klarraum-console-'));
  const director=createDirector(directorConfig({DIRECTOR_PASSWORD_HASH:passwordHash,DIRECTOR_DATA_DIR:directory}));
  await new Promise(resolve=>director.server.listen(0,'127.0.0.1',resolve));
  const port=director.server.address().port;
  t.after(async()=>{await director.close();await rm(directory,{recursive:true,force:true});});
  function request(path,{method='GET',body,headers={}}={}){
    return new Promise((resolve,reject)=>{
      const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{Host:'director.localhost:3100',Origin:'http://director.localhost:3100','Content-Type':'application/json',...headers}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
          const text=Buffer.concat(chunks).toString();
          resolve({status:res.statusCode,location:res.headers.location||'',cookie:res.headers['set-cookie']?.[0]?.split(';')[0]||'',data:res.headers['content-type']?.includes('json')?JSON.parse(text):text});
        });
      });
      req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
    });
  }
  assert.equal((await request('/api/director/sign-in-link',{method:'POST',body:{email:'not-an-email'}})).status,400);
  const stranger=await request('/api/director/sign-in-link',{method:'POST',body:{email:'stranger@example.test'}});
  assert.equal(stranger.status,403);assert.match(stranger.data.error,/not an approved operator/);
  const issued=await request('/api/director/sign-in-link',{method:'POST',body:{email:'Operator@KlarraumApp.de'}});
  assert.equal(issued.status,200);assert.match(issued.data.devLink,/\/api\/director\/sign-in\?token=/);
  const consumed=await request(issued.data.devLink);
  assert.equal(consumed.status,302);assert.equal(consumed.location,'/#/attention');assert.match(consumed.cookie,/klarraum_director=/);
  assert.equal((await request(issued.data.devLink)).status,400);
  const session=await request('/api/director/session',{headers:{Cookie:consumed.cookie}});
  assert.equal(session.status,200);assert.ok(session.data.csrf);
  const page=await request('/director-console.mjs');
  assert.equal(page.status,200);assert.equal(page.data.includes('api.stripe.com'),false);assert.equal(page.data.includes('sk_live'),false);
  const demo=await request('/api/director/demo-signin',{method:'POST',body:{}});
  assert.equal(demo.status,200);assert.ok(demo.data.csrf);
  const productionDir=await mkdtemp(join(tmpdir(),'klarraum-console-prod-'));
  const production=createDirector(directorConfig({NODE_ENV:'production',DIRECTOR_ORIGIN:'https://platform.example.com',COMPANY_BASE_DOMAIN:'companies.example.com',DIRECTOR_PASSWORD_HASH:passwordHash,DIRECTOR_DATA_DIR:productionDir}));
  await new Promise(resolve=>production.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await production.close();await rm(productionDir,{recursive:true,force:true});});
  const prodPort=production.server.address().port;
  const denied=await new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port:prodPort,path:'/api/director/demo-signin',method:'POST',headers:{Host:'platform.example.com',Origin:'https://platform.example.com','Content-Type':'application/json'}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks).toString())}));
    });
    req.on('error',reject);req.end('{}');
  });
  assert.equal(denied.status,404);assert.match(denied.data.error,/not configured/);
});

const shell=await readFile(new URL('../director-public/index.html',import.meta.url),'utf8');
test('manual shell has three nav items and no AI controls',()=>{
  assert.match(shell,/data-nav="attention"/);
  assert.match(shell,/data-nav="companies"/);
  assert.match(shell,/data-nav="support"/);
  assert.equal(shell.includes('data-nav="ai"'),false);
  assert.equal(shell.includes('AI settings'),false);
  assert.equal(shell.includes('Manual | AI assist'),false);
  assert.match(shell,/15 minutes/);
  assert.equal(shell.includes('Finance'),false);
  assert.equal(shell.includes('Backup'),false);
});
