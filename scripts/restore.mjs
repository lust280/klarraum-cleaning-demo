import {DatabaseSync} from 'node:sqlite';
import {mkdir,readdir,copyFile,chmod,rm,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const args=process.argv.slice(2);const value=key=>{const i=args.indexOf(key);return i<0?'':args[i+1]||'';};
const source=value('--source'),target=value('--target');
if(!source||!target)throw new Error('Usage: node scripts/restore.mjs --source /backup/name.sqlite --target /NEW/EMPTY/data');
const destination=resolve(target);await mkdir(destination,{recursive:true,mode:0o700});
if((await readdir(destination)).length)throw new Error('Target must be empty. Never restore over a running installation.');
let db;
try {
 db=new DatabaseSync(resolve(source),{readOnly:true});
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup database integrity check failed.');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup has broken database references.');
 for(const table of ['inquiries','settings','metadata'])if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error('Not a Klarraum database.');
 for(const [table,sourceSuffix,folder] of [['media','.media','uploads'],['job_photos','.jobs','job-photos']]){
  await mkdir(join(destination,folder),{mode:0o700});
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
  for(const item of db.prepare('SELECT id FROM '+table).all()){
   if(!/^[a-f0-9-]{36}$/i.test(item.id))throw new Error('Invalid image identifier.');
   const from=join(resolve(source)+sourceSuffix,item.id+'.webp');if(!(await stat(from)).isFile())throw new Error('A matching image is missing.');
   const to=join(destination,folder,item.id+'.webp');await copyFile(from,to);await chmod(to,0o600);
  }
 }
 await copyFile(resolve(source),join(destination,'klarraum.sqlite'));await chmod(join(destination,'klarraum.sqlite'),0o600);
 console.log('Restored to a separate data directory. Stop the service, switch DATA_DIR, rotate APP_SECRET, then verify before reopening. Original data was not changed.');
}catch(error){for(const item of ['klarraum.sqlite','uploads','job-photos'])await rm(join(destination,item),{recursive:true,force:true});throw error;}
finally{db?.close();}
