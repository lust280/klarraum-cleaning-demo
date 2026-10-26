import {restorePlatformBackup} from '../lib/platform-backup.mjs';
const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?'':args[i+1]||'';};
if(!value('--source')||!value('--target'))throw new Error('Usage: --source BACKUP_FILE --target NEW_DIRECTORY. Password must be provided securely via PLATFORM_BACKUP_PASSWORD.');
const result=await restorePlatformBackup({source:value('--source'),target:value('--target'),password:process.env.PLATFORM_BACKUP_PASSWORD});console.log(JSON.stringify(result));
console.log('Original data was not changed. Review private runtime.json, configure paths and credentials in the host, keep mail/live inquiries disabled and verify the recovered installation before reopening.');
