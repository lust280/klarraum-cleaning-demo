import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backupSchedule,runScheduledBackup,s3Authorization} from '../lib/backup-schedule.mjs';

const s3={PLATFORM_BACKUP_S3_ENDPOINT:'https://example.r2.cloudflarestorage.com',PLATFORM_BACKUP_S3_BUCKET:'backups',PLATFORM_BACKUP_S3_REGION:'auto',PLATFORM_BACKUP_S3_ACCESS_KEY_ID:'AKID',PLATFORM_BACKUP_S3_SECRET_ACCESS_KEY:'secret'};

test('backup schedule stays manual and off-site until the operator sets every required value',()=>{
 assert.deepEqual(backupSchedule({}),{scheduled:false,external:'not_configured'});
 assert.equal(backupSchedule({PLATFORM_BACKUP_SCHEDULE:'daily',PLATFORM_BACKUP_PASSWORD:'short',PLATFORM_BACKUP_DIR:'/tmp/x'}).scheduled,false);
 assert.equal(backupSchedule({PLATFORM_BACKUP_SCHEDULE:'daily',PLATFORM_BACKUP_PASSWORD:'a'.repeat(16),PLATFORM_BACKUP_DIR:'/tmp/x'}).scheduled,true);
 assert.equal(backupSchedule({...s3,PLATFORM_BACKUP_S3_SECRET_ACCESS_KEY:''}).external,'incomplete');
 assert.equal(backupSchedule(s3).external,'configured');
});

test('scheduled backup writes a local status and uploads only when storage is fully configured',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'klarraum-schedule-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const env={PLATFORM_BACKUP_SCHEDULE:'daily',PLATFORM_BACKUP_PASSWORD:'a'.repeat(16),PLATFORM_BACKUP_DIR:dir};
 let uploads=0;
 const now=new Date('2026-10-28T12:00:00.000Z');
 const createBackup=async({destination})=>{const {writeFile}=await import('node:fs/promises');await writeFile(destination,'encrypted');return {createdAt:'2026-10-28T00:00:00.000Z',companies:1,size:9};};
 const first=await runScheduledBackup({env,createBackup,now,upload:async()=>{uploads+=1;}});
 assert.equal(first.externalStorage,'not_configured');assert.equal(uploads,0);
 const status=JSON.parse(await readFile(join(dir,'backup-status.json'),'utf8'));
 assert.equal(status.externalStorage,'not_configured');
 const again=await runScheduledBackup({env,createBackup,now,upload:async()=>{uploads+=1;}});
 assert.equal(again.reason,'already_written');assert.equal(uploads,0);
 await rm(join(dir,'klarraum-platform-2026-10-28.klrb'));
 await assert.rejects(()=>runScheduledBackup({env:{...env,...s3},createBackup,now,upload:async()=>{throw new Error('rejected');}}),/rejected/);
 const failed=JSON.parse(await readFile(join(dir,'backup-status.json'),'utf8'));
 assert.equal(failed.externalStorage,'failed');
});

test('s3 authorization names the key and changes when the body changes',()=>{
 const base={method:'PUT',host:'example.r2.cloudflarestorage.com',path:'/backups/file.klrb',region:'auto',accessKeyId:'AKID',secretAccessKey:'secret',amzDate:'20261028T000000Z'};
 const a=s3Authorization({...base,payloadHash:'abc'});
 const b=s3Authorization({...base,payloadHash:'abd'});
 assert.match(a,/Credential=AKID\/20261028\/auto\/s3\/aws4_request/);
 assert.notEqual(a,b);
});

test('platform legal pages name the pilot operator and keep the impressum route',async()=>{
 const privacy=await readFile(new URL('../director-public/platform-privacy.html',import.meta.url),'utf8');
 const terms=await readFile(new URL('../director-public/platform-terms.html',import.meta.url),'utf8');
 const cookies=await readFile(new URL('../director-public/cookies.html',import.meta.url),'utf8');
 const imprint=await readFile(new URL('../director-public/platform-impressum.html',import.meta.url),'utf8');
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 for(const page of [privacy,terms,cookies,imprint]){
  assert.match(page,/early pilot/);
  assert.equal(page.includes('[OPERATOR'),false);
  assert.equal(page.includes('[BRACKET'),false);
 }
 assert.match(imprint,/Culiuc Andrei/);
 assert.match(imprint,/NOT REGISTERED/);
 assert.match(imprint,/NOT ISSUED/);
 assert.match(imprint,/No public phone/);
 assert.equal(privacy.includes('not the final policy'),false);
 assert.match(server,/\/platform-impressum\.html/);
 assert.match(await readFile(new URL('../director-public/platform.html',import.meta.url),'utf8'),/platform-impressum\.html/);
});
