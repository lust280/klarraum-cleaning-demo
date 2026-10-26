import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,symlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,randomBytes,createCipheriv,scryptSync,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createJobPhotos} from '../lib/job-photos.mjs';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {DirectorStore} from '../lib/director-store.mjs';
import {Store} from '../lib/store.mjs';
import {TeamStore} from '../lib/team-store.mjs';
import {Planning} from '../lib/planning.mjs';
import {PlatformFinance} from '../lib/platform-finance.mjs';
import {createPlatformBackup,inspectPlatformBackup,restorePlatformBackup} from '../lib/platform-backup.mjs';
const password='test-only-archive-password-not-real';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'platform-backup-test-')),data=join(root,'data');await mkdir(data);
 const registry=new DirectorStore(join(data,'director.sqlite')),finance=new PlatformFinance(registry),a=registry.create({name:'Company Alpha',baseCents:7900,included:3,seatCents:500}).row,b=registry.create({name:'Company Beta',baseCents:9900,included:5,seatCents:300}).row;
 const legacy=join(root,'legacy');await mkdir(legacy);const main=new Store(join(legacy,'klarraum.sqlite'));main.close();
 for(const row of [a,b]){const dir=join(data,'companies',row.id);await mkdir(dir,{recursive:true});const store=new Store(join(dir,'klarraum.sqlite'));new TeamStore(store);store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('old-session','old-csrf',Date.now()+86400000);store.close();registry.db.prepare('UPDATE companies SET initialized_at=? WHERE id=?').run(Date.now(),row.id);}
 const privateId=randomUUID(),employeeId=randomUUID(),proofDir=join(data,'companies',a.id),proofStore=new Store(join(proofDir,'klarraum.sqlite')),team=new TeamStore(proofStore);
 new Planning({},proofStore,team,Date.now);
 createJobPhotos({dbPath:join(proofDir,'klarraum.sqlite')},team,Date.now);
 proofStore.db.prepare('INSERT INTO employees(id,name,email,region,invite_hash,invite_expires,created_at) VALUES(?,?,?,?,?,?,?)').run(employeeId,'Fictional worker','worker@example.invalid','Test','old-employee-invite',Date.now()+86400000,Date.now());
 proofStore.db.prepare('INSERT INTO employee_sessions VALUES(?,?,?,?)').run('old-employee-session',employeeId,'old-csrf',Date.now()+86400000);
 const job=team.createJob({employeeId,title:'Restored fictional cleaning',address:'Example 1',customer:'Fictional customer',contact:'',region:'Test',date:'2026-10-26',time:'09:00',plannedMinutes:60,instructions:'Test',checklist:['Floor']},Date.now());
 proofStore.db.prepare('INSERT INTO job_photos VALUES(?,?,?,?,?,?,?)').run(privateId,job.id,employeeId,1,1,13,Date.now());proofStore.close();await mkdir(join(proofDir,'job-photos'));await writeFile(join(proofDir,'job-photos',privateId+'.webp'),'private-proof');
 const dbPath=join(data,'companies',a.id,'klarraum.sqlite'),db=new DatabaseSync(dbPath),mediaId=randomUUID();db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?)').run(mediaId,'logo',1,1,8,Date.now());db.close();await mkdir(join(data,'companies',a.id,'uploads'));await writeFile(join(data,'companies',a.id,'uploads',mediaId+'.webp'),'test-webp-bytes');
 finance.add({type:'expense',category:'hosting',amountCents:2900,date:'2026-10-26',companyId:null,note:'Test cost'},randomUUID());const snapshot=finance.snapshot('2026-10');registry.db.prepare('INSERT INTO director_sessions VALUES(?,?,?)').run('old-director','old-csrf',Date.now()+86400000);registry.close();
 t.after(()=>rm(root,{recursive:true,force:true}));return {root,data,legacy,a,b,mediaId,privateId,employeeId,snapshot,path:join(root,'backup.klrb')};
}
test('full encrypted backup restores companies, images, settings and immutable finance report; revokes old access',async t=>{
 const f=await fixture(t);const originalRegistry=await readFile(join(f.data,'director.sqlite'));
 const result=await createPlatformBackup({dataDir:f.data,legacyDataDir:f.legacy,password,destination:f.path,runtime:{mode:'mounted-demo',legacy:{secret:'test-original-secret'}}});assert.equal(result.companies,2);assert.equal(result.legacyIncluded,true);assert.equal((await stat(f.path)).mode&0o777,0o600);
 const bytes=await readFile(f.path);assert.equal(bytes.includes(Buffer.from('Company Alpha')),false);assert.equal(bytes.includes(Buffer.from('old-director')),false);
 assert.equal((await inspectPlatformBackup({source:f.path,password})).verified,true);
 const target=join(f.root,'restored');const restored=await restorePlatformBackup({source:f.path,password,target});assert.equal(restored.companies,2);
 const registry=new DatabaseSync(join(restored.directorDataDir,'director.sqlite'));assert.equal(registry.prepare('SELECT count(*) AS n FROM companies').get().n,2);assert.equal(registry.prepare('SELECT count(*) AS n FROM director_sessions').get().n,0);assert.equal(registry.prepare('SELECT invite_hash FROM companies WHERE id=?').get(f.a.id).invite_hash,null);assert.notEqual(registry.prepare('SELECT secret FROM companies WHERE id=?').get(f.a.id).secret,f.a.secret);assert.equal(JSON.parse(registry.prepare('SELECT payload FROM platform_snapshots WHERE id=?').get(f.snapshot.id).payload).expenseCents,2900);registry.close();
 const company=new DatabaseSync(join(restored.directorDataDir,'companies',f.a.id,'klarraum.sqlite'));assert.equal(company.prepare('SELECT count(*) AS n FROM sessions').get().n,0);assert.equal(company.prepare('SELECT id FROM media').get().id,f.mediaId);assert.equal(company.prepare('SELECT count(*) AS n FROM employee_sessions').get().n,0);assert.equal(company.prepare('SELECT invite_hash FROM employees WHERE id=?').get(f.employeeId).invite_hash,null);assert.equal(company.prepare('SELECT title FROM jobs').get().title,'Restored fictional cleaning');company.close();
 assert.equal(await readFile(join(restored.directorDataDir,'companies',f.a.id,'job-photos',f.privateId+'.webp'),'utf8'),'private-proof');
 assert.equal(await readFile(join(restored.directorDataDir,'companies',f.a.id,'uploads',f.mediaId+'.webp'),'utf8'),'test-webp-bytes');assert.notEqual(JSON.parse(await readFile(join(target,'runtime.json'),'utf8')).legacy.secret,'test-original-secret');
 assert.deepEqual(await readFile(join(f.data,'director.sqlite')),originalRegistry);
 await assert.rejects(restorePlatformBackup({source:f.path,password,target}),/must not exist/);
 await assert.rejects(createPlatformBackup({dataDir:f.data,password,destination:f.path}),/EEXIST/);
});
test('wrong password and tampering cannot create a restored installation',async t=>{
 const f=await fixture(t);await createPlatformBackup({dataDir:f.data,password,destination:f.path});const target=join(f.root,'wrong');
 await assert.rejects(restorePlatformBackup({source:f.path,password:'another-test-password-123',target}),/authentication failed/);
 assert.ok(!(await readdir(f.root)).includes('wrong'));
 const bad=Buffer.from(await readFile(f.path));bad[bad.length-25]^=1;const altered=join(f.root,'altered.klrb');await writeFile(altered,bad);
 await assert.rejects(inspectPlatformBackup({source:altered,password}),/authentication failed/);
 assert.ok(!(await readdir(f.root)).some(name=>name.startsWith('.klarraum-restore-')));
});
test('missing databases, missing photos, symlink media and active service marker refuse a successful backup',async t=>{
 const f=await fixture(t),photo=join(f.data,'companies',f.a.id,'uploads',f.mediaId+'.webp');
 await writeFile(join(f.data,'.platform-running'),'running');await assert.rejects(createPlatformBackup({dataDir:f.data,password,destination:f.path}),/Stop the platform/);await rm(join(f.data,'.platform-running'));
 await rm(photo);await assert.rejects(createPlatformBackup({dataDir:f.data,password,destination:f.path}),/ENOENT/);
 assert.ok(!(await readdir(f.root)).includes('backup.klrb'));
 await symlink(join(f.root,'legacy','klarraum.sqlite'),photo);await assert.rejects(createPlatformBackup({dataDir:f.data,password,destination:f.path}),/regular file/);await rm(photo);await writeFile(photo,'test-webp-bytes');
 await rm(join(f.data,'companies',f.b.id,'klarraum.sqlite'));await assert.rejects(createPlatformBackup({dataDir:f.data,password,destination:f.path}),/database is missing/);
});
test('authenticated malicious archive cannot traverse directories or restore unlisted content',async t=>{
 const f=await fixture(t),salt=randomBytes(16),iv=randomBytes(12),header=Buffer.concat([Buffer.from('KLRPLAT1'),salt,iv]);
 const key=scryptSync(password,salt,32),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);
 const plain=Buffer.from(JSON.stringify({path:'../../escape',size:0,sha256:createHash('sha256').digest('hex')})+'\n{"end":true}\n');
 const bytes=Buffer.concat([header,cipher.update(gzipSync(plain)),cipher.final(),cipher.getAuthTag()]);const source=join(f.root,'malicious.klrb');await writeFile(source,bytes);
 await assert.rejects(restorePlatformBackup({source,password,target:join(f.root,'target')}),/Invalid backup record/);
 assert.ok(!(await readdir(f.root)).includes('target'));assert.ok(!(await readdir(f.root)).includes('escape'));
});
test('documented offline CLI creates, verifies and restores a backup without password command arguments',async t=>{
 const f=await fixture(t),env={...process.env,PLATFORM_BACKUP_PASSWORD:password},source=join(f.root,'cli.klrb');
 const run=(script,args)=>execFileSync(process.execPath,[script,...args],{cwd:new URL('..',import.meta.url),env,encoding:'utf8'});
 const created=JSON.parse(run('scripts/platform-backup.mjs',['--offline','--data',f.data,'--legacy-data',f.legacy,'--destination',source]));assert.equal(created.companies,2);
 assert.equal(JSON.parse(run('scripts/platform-backup.mjs',['--verify',source])).verified,true);
 const output=run('scripts/platform-restore.mjs',['--source',source,'--target',join(f.root,'cli-restored')]);assert.ok(!output.includes(password));assert.ok(output.includes('Original data was not changed.'));
});
