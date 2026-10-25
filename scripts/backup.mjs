import {mkdir,chmod,stat,unlink,readdir} from 'node:fs/promises';
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
for(const file of await readdir(backupDir)){
 if(!/^klarraum-[\dT.Z-]+\.sqlite$/.test(file))continue;
 const full=join(backupDir,file);if((await stat(full)).mtimeMs<Date.now()-keep*86400000)await unlink(full);
}
console.log('Consistent database backup created. Store a protected copy off the application disk.');
