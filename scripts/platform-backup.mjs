import {createPlatformBackup,inspectPlatformBackup} from '../lib/platform-backup.mjs';
import {runScheduledBackup} from '../lib/backup-schedule.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?'':args[i+1]||'';};
const password=process.env.PLATFORM_BACKUP_PASSWORD;
if(args.includes('--scheduled')){
 const result=await runScheduledBackup({env:{...process.env,DIRECTOR_DATA_DIR:process.env.DIRECTOR_DATA_DIR||value('--data'),PLATFORM_BACKUP_DIR:process.env.PLATFORM_BACKUP_DIR||value('--dir')},createBackup:({password:backupPassword,destination})=>createPlatformBackup({dataDir:resolve(process.env.DIRECTOR_DATA_DIR||value('--data')),legacyDataDir:process.env.LEGACY_DATA_DIR?resolve(process.env.LEGACY_DATA_DIR):null,password:backupPassword,destination})});
 console.log(JSON.stringify(result));
 if(!result.ran&&result.reason==='not_scheduled')throw new Error('Daily backup is not configured. Set PLATFORM_BACKUP_SCHEDULE=daily, PLATFORM_BACKUP_PASSWORD (16+ characters) and PLATFORM_BACKUP_DIR. External storage stays off until every PLATFORM_BACKUP_S3_* variable is set. Stop the platform before this offline command; the running service writes its own daily file when those variables are set on it.');
}else if(value('--verify')){const result=await inspectPlatformBackup({source:resolve(value('--verify')),password});console.log(JSON.stringify(result));}
else{
 if(!args.includes('--offline')||!value('--data')||!value('--destination'))throw new Error('Stop the service, then use: --offline --data DIRECTOR_DATA_DIR --destination NEW_FILE. Password must be provided securely via PLATFORM_BACKUP_PASSWORD.');
 const runtime=value('--runtime')?JSON.parse(await readFile(resolve(value('--runtime')),'utf8')):{};
 const result=await createPlatformBackup({dataDir:resolve(value('--data')),legacyDataDir:value('--legacy-data')?resolve(value('--legacy-data')):null,runtime,password,destination:resolve(value('--destination'))});console.log(JSON.stringify(result));
}
