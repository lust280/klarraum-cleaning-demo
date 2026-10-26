import {createPlatformBackup,inspectPlatformBackup} from '../lib/platform-backup.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?'':args[i+1]||'';};
const password=process.env.PLATFORM_BACKUP_PASSWORD;
if(value('--verify')){const result=await inspectPlatformBackup({source:resolve(value('--verify')),password});console.log(JSON.stringify(result));}
else{
 if(!args.includes('--offline')||!value('--data')||!value('--destination'))throw new Error('Stop the service, then use: --offline --data DIRECTOR_DATA_DIR --destination NEW_FILE. Password must be provided securely via PLATFORM_BACKUP_PASSWORD.');
 const runtime=value('--runtime')?JSON.parse(await readFile(resolve(value('--runtime')),'utf8')):{};
 const result=await createPlatformBackup({dataDir:resolve(value('--data')),legacyDataDir:value('--legacy-data')?resolve(value('--legacy-data')):null,runtime,password,destination:resolve(value('--destination'))});console.log(JSON.stringify(result));
}
