import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {randomBytes,createCipheriv,createDecipheriv,createHash,scrypt as derive} from 'node:crypto';
import {promisify} from 'node:util';
import {createReadStream,createWriteStream,constants} from 'node:fs';
import {mkdir,mkdtemp,lstat,readFile,writeFile,chmod,open,copyFile,rm,appendFile,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {randomToken} from './security.mjs';

const scrypt=promisify(derive),magic=Buffer.from('KLRPLAT1'),MAX_TOTAL=2*1024**3,MAX_FILE=512*1024**2,MAX_FILES=100000;
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const idPattern=new RegExp('^'+uuid+'$');
const safeFile=new RegExp('^(?:manifest\\.json|runtime\\.json|director/director\\.sqlite|(?:legacy|director/companies/'+uuid+')/(?:klarraum\\.sqlite|(?:uploads|job-photos)/'+uuid+'\\.webp))$');
function passwordChecked(password){if(typeof password!=='string'||password.length<16||password.length>256)throw new Error('Backup password must contain 16–256 characters.');}
async function regular(path){const item=await lstat(path);if(!item.isFile()||item.isSymbolicLink())throw new Error('Expected a regular file: '+path);return item;}
async function directory(path){const item=await lstat(path);if(!item.isDirectory()||item.isSymbolicLink())throw new Error('Expected a private directory: '+path);}
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function digestFile(path){const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(path)){size+=chunk.length;if(size>MAX_FILE)throw new Error('Backup file size limit exceeded.');hash.update(chunk);}return {size,sha256:hash.digest('hex')};}
function checkDb(db,tables){if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Database integrity check failed.');for(const name of tables)if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name))throw new Error('Missing required database table: '+name);}
function imageFiles(db){const result=[];for(const [table,folder] of [['media','uploads'],['job_photos','job-photos']]){if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;for(const row of db.prepare('SELECT id FROM '+table).all()){if(!idPattern.test(row.id))throw new Error('Invalid stored image identifier.');result.push(folder+'/'+row.id+'.webp');}}return result;}
async function copyDatabase(source,target,tables){await regular(source);await mkdir(dirname(target),{recursive:true,mode:0o700});const db=new DatabaseSync(source,{readOnly:true});try{checkDb(db,tables);await sqliteBackup(db,target);}finally{db.close();}await chmod(target,0o600);}

async function stagePlatform({dataDir,legacyDataDir,runtime},stage){
 await directory(dataDir);const files=[];
 const registry='director/director.sqlite';await copyDatabase(join(dataDir,'director.sqlite'),join(stage,registry),['companies','director_meta','director_events']);files.push(registry);
 const db=new DatabaseSync(join(stage,registry),{readOnly:true});let rows;try{rows=db.prepare('SELECT id,password_hash,initialized_at FROM companies ORDER BY id').all();}finally{db.close();}
 const companyInfo=[];
 async function company(source,prefix){
  await directory(source);await copyDatabase(join(source,'klarraum.sqlite'),join(stage,prefix,'klarraum.sqlite'),['inquiries','settings','metadata']);files.push(prefix+'/klarraum.sqlite');
  const snapshot=new DatabaseSync(join(stage,prefix,'klarraum.sqlite'),{readOnly:true});let images;try{images=imageFiles(snapshot);}finally{snapshot.close();}
  for(const path of images){await directory(join(source,path.split('/')[0]));await regular(join(source,path));const to=join(stage,prefix,path);await mkdir(dirname(to),{recursive:true,mode:0o700});await copyFile(join(source,path),to,constants.COPYFILE_EXCL);await chmod(to,0o600);files.push(prefix+'/'+path);}
 }
 for(const row of rows){
  if(!idPattern.test(row.id))throw new Error('Invalid registry company identifier.');const source=join(dataDir,'companies',row.id);let initialized=false;
  if(await exists(source)){await directory(join(dataDir,'companies'));await directory(source);initialized=await exists(join(source,'klarraum.sqlite'));if(initialized)await company(source,'director/companies/'+row.id);}
  if(row.initialized_at&&!initialized)throw new Error('Previously initialized company database is missing.');
  companyInfo.push({id:row.id,initialized});
 }
 if(legacyDataDir)await company(legacyDataDir,'legacy');
 await writeFile(join(stage,'runtime.json'),JSON.stringify({...runtime,version:1}),{flag:'wx',mode:0o600});files.push('runtime.json');
 const entries=[];let total=0;
 for(const path of files){if(!safeFile.test(path))throw new Error('Invalid backup path.');const info=await digestFile(join(stage,path));total+=info.size;if(total>MAX_TOTAL||entries.length>=MAX_FILES)throw new Error('Backup capacity limit exceeded.');entries.push({path,...info});}
 const manifest={version:1,createdAt:new Date().toISOString(),companies:companyInfo,legacyIncluded:Boolean(legacyDataDir),files:entries};
 await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});files.push('manifest.json');return {manifest,files};
}
async function* records(stage,files){
 for(const path of files){const metadata={path,...await digestFile(join(stage,path))};yield Buffer.from(JSON.stringify(metadata)+'\n');for await(const chunk of createReadStream(join(stage,path)))yield chunk;}
 yield Buffer.from('{"end":true}\n');
}
export async function createPlatformBackup({dataDir,legacyDataDir=null,runtime={},password,destination,quiesced=false}){
 passwordChecked(password);dataDir=resolve(dataDir);destination=resolve(destination);
 if(!quiesced&&await exists(join(dataDir,'.platform-running')))throw new Error('Stop the platform before using the offline backup command.');
 await mkdir(dirname(destination),{recursive:true,mode:0o700});const stage=await mkdtemp(join(tmpdir(),'klarraum-platform-backup-'));let created=false;
 try{
  const {manifest,files}=await stagePlatform({dataDir,legacyDataDir,runtime},stage);
  const salt=randomBytes(16),iv=randomBytes(12),header=Buffer.concat([magic,salt,iv]);const key=await scrypt(password,salt,32);const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);
  const handle=await open(destination,'wx',0o600);created=true;await handle.writeFile(header);await handle.close();
  await pipeline(Readable.from(records(stage,files)),createGzip(),cipher,createWriteStream(destination,{flags:'a',mode:0o600}));await appendFile(destination,cipher.getAuthTag());key.fill(0);
  const size=(await regular(destination)).size;
  return {createdAt:manifest.createdAt,companies:manifest.companies.length,initializedCompanies:manifest.companies.filter(c=>c.initialized).length,files:files.length,size,legacyIncluded:manifest.legacyIncluded};
 }catch(error){if(created)await rm(destination,{force:true});throw error;}finally{await rm(stage,{recursive:true,force:true});}
}
class Reader{
 constructor(stream){this.iterator=stream[Symbol.asyncIterator]();this.buffer=Buffer.alloc(0);}
 async chunk(max){if(!this.buffer.length){const next=await this.iterator.next();if(next.done)return null;this.buffer=next.value;}const value=this.buffer.subarray(0,max);this.buffer=this.buffer.subarray(value.length);return value;}
 async line(){const parts=[];let size=0;for(;;){const chunk=await this.chunk(8193);if(chunk===null)throw new Error('Truncated backup.');const end=chunk.indexOf(10);if(end>=0){parts.push(chunk.subarray(0,end));this.buffer=Buffer.concat([chunk.subarray(end+1),this.buffer]);size+=end;break;}parts.push(chunk);size+=chunk.length;if(size>8192)throw new Error('Invalid record header.');}if(size>8192)throw new Error('Record header too large.');return JSON.parse(Buffer.concat(parts).toString());}
}
async function decode(source,password,stage){
 passwordChecked(password);const info=await regular(source);if(info.size<52||info.size>MAX_TOTAL+16*1024**2)throw new Error('Invalid encrypted backup size.');
 const handle=await open(source,'r'),header=Buffer.alloc(36),tag=Buffer.alloc(16);try{await handle.read(header,0,36,0);await handle.read(tag,0,16,info.size-16);}finally{await handle.close();}
 if(!header.subarray(0,8).equals(magic))throw new Error('Not a Klarraum platform backup.');const key=await scrypt(password,header.subarray(8,24),32),decipher=createDecipheriv('aes-256-gcm',key,header.subarray(24));decipher.setAAD(header);decipher.setAuthTag(tag);
 const compressed=join(stage,'verified.gz');
 try{await pipeline(createReadStream(source,{start:36,end:info.size-17}),decipher,createWriteStream(compressed,{flags:'wx',mode:0o600}));}catch{throw new Error('Backup authentication failed: wrong password or damaged file.');}finally{key.fill(0);}
 const data=join(stage,'data');await mkdir(data,{mode:0o700});const stream=createReadStream(compressed).pipe(createGunzip()),reader=new Reader(stream),seen=new Map();let total=0;
 try{
  for(;;){const record=await reader.line();if(record?.end===true){if(Object.keys(record).length!==1||await reader.chunk(1)!==null)throw new Error('Unexpected trailing backup content.');break;}
   if(!record||typeof record.path!=='string'||!safeFile.test(record.path)||seen.has(record.path)||!Number.isSafeInteger(record.size)||record.size<0||record.size>MAX_FILE||(record.path==='runtime.json'&&record.size>65536)||(record.path==='manifest.json'&&record.size>32*1024**2)||! /^[a-f0-9]{64}$/.test(record.sha256))throw new Error('Invalid backup record.');
   total+=record.size;if(total>MAX_TOTAL||seen.size>=MAX_FILES)throw new Error('Backup capacity limit exceeded.');
   const path=join(data,record.path);await mkdir(dirname(path),{recursive:true,mode:0o700});const output=await open(path,'wx',0o600),hash=createHash('sha256');let left=record.size;
   try{while(left){const chunk=await reader.chunk(Math.min(left,65536));if(chunk===null)throw new Error('Truncated backup file.');await output.writeFile(chunk);hash.update(chunk);left-=chunk.length;}}finally{await output.close();}
   if(hash.digest('hex')!==record.sha256)throw new Error('Backup file checksum mismatch.');seen.set(record.path,record);
  }
 }finally{stream.destroy();}
 const manifest=JSON.parse(await readFile(join(data,'manifest.json'),'utf8'));
 if(manifest.version!==1||!Array.isArray(manifest.files)||!Array.isArray(manifest.companies)||typeof manifest.legacyIncluded!=='boolean'||typeof manifest.createdAt!=='string')throw new Error('Invalid backup manifest.');
 const described=new Set();for(const entry of manifest.files){if(!safeFile.test(entry.path)||entry.path==='manifest.json'||described.has(entry.path))throw new Error('Invalid manifest paths.');described.add(entry.path);const actual=seen.get(entry.path);if(!actual||actual.size!==entry.size||actual.sha256!==entry.sha256)throw new Error('Backup manifest does not match files.');}
 if(described.size+1!==seen.size)throw new Error('Unexpected files in backup.');
 const registry=new DatabaseSync(join(data,'director/director.sqlite'),{readOnly:true});let companies;try{checkDb(registry,['companies','director_meta','director_events']);companies=registry.prepare('SELECT id FROM companies ORDER BY id').all();}finally{registry.close();}
 if(companies.length!==manifest.companies.length)throw new Error('Company manifest mismatch.');
 const allowed=new Set(['runtime.json','director/director.sqlite','manifest.json']);
 async function validateCompany(prefix){const path=prefix+'/klarraum.sqlite';if(!seen.has(path))throw new Error('Company database is missing.');allowed.add(path);const db=new DatabaseSync(join(data,path),{readOnly:true});try{checkDb(db,['inquiries','settings','metadata']);for(const image of imageFiles(db)){if(!seen.has(prefix+'/'+image))throw new Error('Referenced image is missing.');allowed.add(prefix+'/'+image);}}finally{db.close();}}
 for(let i=0;i<companies.length;i++){const row=manifest.companies[i];if(!idPattern.test(companies[i].id)||row.id!==companies[i].id||typeof row.initialized!=='boolean')throw new Error('Invalid company manifest.');if(row.initialized)await validateCompany('director/companies/'+row.id);}
 if(manifest.legacyIncluded)await validateCompany('legacy');for(const path of seen.keys())if(!allowed.has(path))throw new Error('Unreferenced data in backup.');
 const runtime=JSON.parse(await readFile(join(data,'runtime.json'),'utf8'));if(runtime.version!==1)throw new Error('Invalid runtime settings.');
 return {data,manifest,runtime};
}
export async function inspectPlatformBackup({source,password}){
 const stage=await mkdtemp(join(tmpdir(),'klarraum-platform-check-'));try{const {manifest}=await decode(resolve(source),password,stage);return {createdAt:manifest.createdAt,companies:manifest.companies.length,files:manifest.files.length+1,legacyIncluded:manifest.legacyIncluded,verified:true};}finally{await rm(stage,{recursive:true,force:true});}
}
export async function restorePlatformBackup({source,password,target}){
 const destination=resolve(target);if(await exists(destination))throw new Error('Restore target must not exist. Never overwrite a running installation.');await directory(dirname(destination));
 const stage=await mkdtemp(join(dirname(destination),'.klarraum-restore-'));let created=false;
 try{
  const {data,manifest,runtime}=await decode(resolve(source),password,stage);
  // Restoring old sessions and invitation links would resurrect previously revoked access.
  const registry=new DatabaseSync(join(data,'director/director.sqlite'));try{registry.exec('DELETE FROM director_sessions');for(const row of registry.prepare('SELECT id FROM companies').all())registry.prepare('UPDATE companies SET secret=?,invite_hash=NULL,invite_expires=NULL WHERE id=?').run(randomToken(),row.id);registry.exec('PRAGMA wal_checkpoint(TRUNCATE)');}finally{registry.close();}
  const databases=manifest.files.map(x=>x.path).filter(x=>x.endsWith('/klarraum.sqlite'));
  for(const path of databases){const db=new DatabaseSync(join(data,path));try{db.exec('DELETE FROM sessions');if(db.prepare("SELECT name FROM sqlite_master WHERE name='employee_sessions'").get())db.exec('DELETE FROM employee_sessions');if(db.prepare("SELECT name FROM sqlite_master WHERE name='employees'").get())db.exec('UPDATE employees SET invite_hash=NULL,invite_expires=NULL');db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}finally{db.close();}}
  if(runtime.legacy)runtime.legacy.secret=randomToken();runtime.restoredAt=new Date().toISOString();runtime.requiresOperatorReview=true;await writeFile(join(data,'runtime.json'),JSON.stringify(runtime),{mode:0o600});
  await mkdir(destination,{mode:0o700});created=true;
  for(const path of manifest.files.map(x=>x.path)){const to=join(destination,path);await mkdir(dirname(to),{recursive:true,mode:0o700});await copyFile(join(data,path),to,constants.COPYFILE_EXCL);await chmod(to,0o600);}
  await writeFile(join(destination,'RESTORE-INFO.json'),JSON.stringify({createdAt:manifest.createdAt,restoredAt:runtime.restoredAt,companies:manifest.companies.length,sessionsRevoked:true,invitesRevoked:true,requiresOperatorReview:true}),{flag:'wx',mode:0o600});
  return {companies:manifest.companies.length,directorDataDir:join(destination,'director'),legacyDataDir:manifest.legacyIncluded?join(destination,'legacy'):null,sessionsRevoked:true,invitesRevoked:true};
 }catch(error){if(created)await rm(destination,{recursive:true,force:true});throw error;}finally{await rm(stage,{recursive:true,force:true});}
}
