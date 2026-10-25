import {access,readdir,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join} from 'node:path';
export async function operationalStatus(config,store,now){
 const directory=dirname(config.dbPath);let writable=false,lastBackup=null;
 try{await access(directory,constants.W_OK);writable=true;}catch{/* Report without exposing paths. */}
 try{for(const name of await readdir(join(directory,'backups'))){if(!/^klarraum-[\dT.Z-]+\.sqlite$/.test(name))continue;const file=await stat(join(directory,'backups',name));if(!lastBackup||file.mtimeMs>lastBackup)lastBackup=file.mtimeMs;}}catch{/* External backup locations are checked by their operator. */}
 return {version:'2.1.0',demoMode:Boolean(config.demoMode),inquiriesEnabled:config.live,databaseWritable:writable,persistentStorageConfirmed:Boolean(config.persistentStorageConfirmed)&&!config.demoMode,mailConfigured:Boolean(config.mail.key&&config.mail.from&&config.mail.to),employeeEmailEnabled:Boolean(config.employeeEmail)&&!config.demoMode,lastLocalBackup:lastBackup,backupOlderThanDay:!lastBackup||now-lastBackup>86400000,offsiteBackupVerified:false,delivery:{inquiries:store.db.prepare('SELECT mail_status AS status,COUNT(*) AS count FROM inquiries GROUP BY mail_status').all(),employees:store.db.prepare('SELECT mail_status AS status,COUNT(*) AS count FROM employee_notifications GROUP BY mail_status').all()}};
}
