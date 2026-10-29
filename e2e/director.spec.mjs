import {test,expect} from '@playwright/test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {createDirector,directorConfig} from '../director.mjs';
import {hashPassword} from '../lib/security.mjs';

let director,origin,directory;
test.beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'klarraum-director-e2e-'));
  const passwordHash=await hashPassword('director-browser-password');
  const port=await new Promise((resolve,reject)=>{
    const probe=createServer();
    probe.once('error',reject);
    probe.listen(0,'127.0.0.1',()=>{
      const value=probe.address().port;
      probe.close(()=>resolve(value));
    });
  });
  origin=`http://director.localhost:${port}`;
  director=createDirector(directorConfig({DIRECTOR_PASSWORD_HASH:passwordHash,DIRECTOR_DATA_DIR:directory,DIRECTOR_ORIGIN:origin,COMPANY_BASE_DOMAIN:'companies.localhost'}));
  await new Promise(resolve=>director.server.listen(port,'127.0.0.1',resolve));
});
test.afterAll(async()=>{
  if(director)await director.close();
  if(directory)await rm(directory,{recursive:true,force:true});
});

function nav(page,mobile){
  return page.locator(mobile?'.tabbar':'.sidebar');
}
function visibleLink(page,text){
  return page.locator('a:visible').filter({hasText:text});
}

test('email link opens the manual shell and the main panels',async({page},testInfo)=>{
  const mobile=testInfo.project.name==='mobile';
  await mkdir('/tmp/director-ui',{recursive:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/director.html');
  await expect(page.getByRole('heading',{name:'Operator sign in'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
  await expect(page.getByText('Manual | AI assist')).toHaveCount(0);
  await expect(page.getByText('AI settings')).toHaveCount(0);
  await expect(page.locator('.expiry')).toContainText('15 minutes');
  await expect(page.getByText('Costs and pricing')).toHaveCount(0);
  await page.getByLabel('Work email').fill('stranger@example.test');
  await page.getByRole('button',{name:'Send sign-in link'}).click();
  await expect(page.getByRole('alert')).toContainText('not an approved operator');
  await page.getByLabel('Work email').fill('operator@klarraumapp.de');
  await page.getByRole('button',{name:'Send sign-in link'}).click();
  await expect(page.getByRole('heading',{name:'Check your email'})).toBeVisible();
  await page.getByRole('link',{name:'Open the sign-in link'}).click();
  await expect(page.getByRole('heading',{name:'Attention'})).toBeVisible();
  await expect(page.getByRole('link',{name:/Fresh Clean — 2 days left/})).toBeVisible();
  await expect(page.getByText('6 days left')).toHaveCount(0);
  await expect(page.getByRole('link',{name:/Payment question/})).toBeVisible();
  await expect(page.getByText(/92% of 5 GB/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Approve'})).toHaveCount(0);
  await expect(page.getByText('Dismiss')).toHaveCount(0);
  await page.screenshot({path:`/tmp/director-ui/${testInfo.project.name}-attention.png`,fullPage:true});
  await expect(nav(page,mobile).getByRole('link')).toHaveCount(3);
  if(mobile)await expect(page.locator('.tabbar')).toBeVisible();
  else await expect(page.locator('.sidebar')).toBeVisible();

  await nav(page,mobile).getByRole('link',{name:/Companies/}).click();
  await expect(page.getByRole('heading',{name:'Companies'})).toBeVisible();
  await page.screenshot({path:`/tmp/director-ui/${testInfo.project.name}-companies.png`,fullPage:true});
  if(mobile){
    await page.getByLabel('Status').selectOption('trial');
    await expect(visibleLink(page,'Fresh Clean')).toBeVisible();
    await expect(visibleLink(page,'NordHaus')).toHaveCount(0);
    await page.getByLabel('Status').selectOption('all');
  }else{
    await expect(page.getByRole('columnheader',{name:'Plan'})).toBeVisible();
    await expect(page.getByRole('cell',{name:'Starter'})).toBeVisible();
    await expect(page.getByRole('cell',{name:'Plus'})).toBeVisible();
    await expect(page.getByRole('columnheader',{name:'AI hint'})).toHaveCount(0);
    await expect(page.getByRole('cell',{name:'Business'})).toHaveCount(0);
    await expect(page.getByRole('cell',{name:'Past due'})).toBeVisible();
  }
  await expect(page.getByLabel('Status')).toBeVisible();
  await page.getByLabel('Search companies').fill('Sparkle');
  await visibleLink(page,'Sparkle').click();
  await expect(page.getByRole('heading',{name:'Sparkle Berlin'})).toBeVisible();
  await expect(page.locator('strong:visible',{hasText:'anna@sparkleclean.de'})).toBeVisible();
  await page.screenshot({path:`/tmp/director-ui/${testInfo.project.name}-company.png`,fullPage:true});
  await page.getByRole('tab',{name:'Payments'}).click();
  await expect(page.getByRole('heading',{name:'KlarraumApp subscription'})).toBeVisible();
  await expect(page.getByText('Partner money · read-only')).toBeVisible();
  await expect(page.getByText('Pro €89/mo')).toBeVisible();
  await expect(page.getByText(/€89\.00 Paid/)).toBeVisible();
  await expect(page.getByText('Connected')).toBeVisible();
  await page.screenshot({path:`/tmp/director-ui/${testInfo.project.name}-payments.png`,fullPage:true});

  await nav(page,mobile).getByRole('link',{name:/Companies/}).click();
  await page.getByLabel('Search companies').fill('CleanPro');
  await visibleLink(page,'CleanPro').click();
  await page.getByRole('tab',{name:'Payments'}).click();
  await expect(page.locator('[data-panel="payments"]').getByText('Past due')).toBeVisible();
  await expect(page.getByText(/Failed/)).toBeVisible();
  await expect(page.getByText('acct_••••••9K4p')).toBeVisible();

  await nav(page,mobile).getByRole('link',{name:/Companies/}).click();
  await page.getByLabel('Search companies').fill('Blitz');
  await visibleLink(page,'Blitz').click();
  if(mobile)await expect(page.getByText('6 of 10 used')).toBeVisible();
  else await expect(page.getByText('6 / 10',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Payments'}).click();
  await expect(page.getByText('Error')).toBeVisible();

  await nav(page,mobile).getByRole('link',{name:/Companies/}).click();
  await page.getByLabel('Search companies').fill('Fresh');
  await visibleLink(page,'Fresh').click();
  await page.getByRole('tab',{name:'Payments'}).click();
  await expect(page.getByText('Not connected')).toBeVisible();
  await expect(page.getByText('No card')).toBeVisible();

  await nav(page,mobile).getByRole('link',{name:/Support/}).click();
  if(mobile)await page.getByRole('link',{name:/Payment question/}).click();
  await expect(page.getByText('Our customer paid twice, how to refund?')).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByText('Past due')).toHaveCount(0);
  const send=page.getByRole('button',{name:'Send'});
  await expect(send).toBeDisabled();
  await page.getByLabel('Write a reply').fill('<img src=x onerror="window.__xss=1">');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText('<img src=x onerror="window.__xss=1">')).toBeVisible();
  await page.screenshot({path:`/tmp/director-ui/${testInfo.project.name}-support.png`,fullPage:true});
  expect(await page.evaluate(()=>window.__xss)).toBeUndefined();

  await page.goto(origin+'/director.html#/attention/clear');
  await expect(page.getByRole('heading',{name:'All clear'})).toBeVisible();
  await expect(page.getByText('Nothing needs your attention right now.')).toBeVisible();
  await expect(page.getByText('Last checked 10:42')).toBeVisible();
  await page.screenshot({path:`/tmp/director-ui/${testInfo.project.name}-attention-empty.png`,fullPage:true});
  await page.getByRole('link',{name:'View companies'}).click();
  await expect(page.getByRole('heading',{name:'Companies'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
  await page.locator(mobile?'.topbar':'.sidebar').getByRole('button',{name:'Sign out'}).click();
  await expect(page.getByRole('heading',{name:'Operator sign in'})).toBeVisible();
  await page.screenshot({path:`/tmp/director-ui/${testInfo.project.name}-login.png`,fullPage:true});
  expect(errors).toEqual([]);
});

test('Continue with Google signs the demo operator into Attention',async({page})=>{
  await page.goto(origin+'/director.html');
  await page.getByRole('button',{name:'Continue with Google'}).click();
  await expect(page.getByRole('heading',{name:'Attention'})).toBeVisible();
  await expect(page.getByText('Trials ending')).toBeVisible();
  await expect(page.getByText('Support flags')).toBeVisible();
  await expect(page.getByText('Storage alerts')).toBeVisible();
});
