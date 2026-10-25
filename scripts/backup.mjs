import {mkdir,chmod,stat,unlink,readdir,copyFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Store} from '../lib/store.mjs';
const dataDir=resolve(process.env.DATA_DIR||'./data');
const backupDir=resolve(process.env.BACKUP_DIR||join(dataDir,'backups'));
const keep=Number(process.env.BACKUP_RETENTION_DAYS||7);
if(!Number.isInteger(keep)||keep<1||keep>90)throw new Error('BACKUP_RETENTION_DAYS must be 1–90.');
await stat(join(dataDir,'klarraum.sqlite')); // Refuse silently backing up a new empty database.
await mkdir(backupDir,{recursive:true,mode:0o700});
const name=`klarraum-${new Date().toISOString().replaceAll(':','-')}.sqlite`;
const path=join(backupDir,name);const store=new Store(join(dataDir,'klarraum.sqlite'));
try{await store.backup(path);await chmod(path,0o600);}finally{store.close();}
const mediaPath=path+'.media',jobsPath=path+'.jobs';
const snapshot=new Store(path);
try{
 await mkdir(mediaPath,{mode:0o700});
 for(const item of snapshot.listMedia()){
  if(!/^[a-f0-9-]{36}$/i.test(item.id))throw new Error('Invalid media metadata.');
  const destination=join(mediaPath,item.id+'.webp');await copyFile(join(dataDir,'uploads',item.id+'.webp'),destination);await chmod(destination,0o600);
 }
 await mkdir(jobsPath,{mode:0o700});
 if(snapshot.db.prepare("SELECT name FROM sqlite_master WHERE name='job_photos'").get()){
  for(const item of snapshot.db.prepare('SELECT id FROM job_photos').all()){
   if(!/^[a-f0-9-]{36}$/i.test(item.id))throw new Error('Invalid work-photo metadata.');
   const destination=join(jobsPath,item.id+'.webp');await copyFile(join(dataDir,'job-photos',item.id+'.webp'),destination);await chmod(destination,0o600);
  }
 }
}catch(error){await rm(mediaPath,{recursive:true,force:true});await rm(jobsPath,{recursive:true,force:true});await unlink(path);throw error;}
finally{snapshot.close();}
for(const file of await readdir(backupDir)){
 if(!/^klarraum-[\dT.Z-]+\.sqlite$/.test(file))continue;
 const full=join(backupDir,file);if((await stat(full)).mtimeMs<Date.now()-keep*86400000){await unlink(full);await rm(full+'.media',{recursive:true,force:true});await rm(full+'.jobs',{recursive:true,force:true});}
}
console.log('Database and images backed up. Keep .sqlite, .sqlite.media and .sqlite.jobs together in protected off-site storage.');
