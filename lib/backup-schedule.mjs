import {createHash,createHmac} from 'node:crypto';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';

export const s3Keys=['PLATFORM_BACKUP_S3_ENDPOINT','PLATFORM_BACKUP_S3_BUCKET','PLATFORM_BACKUP_S3_REGION','PLATFORM_BACKUP_S3_ACCESS_KEY_ID','PLATFORM_BACKUP_S3_SECRET_ACCESS_KEY'];

export function backupSchedule(env=process.env){
 const present=s3Keys.filter(key=>String(env[key]||'').trim());
 const external=present.length===0?'not_configured':present.length===s3Keys.length?'configured':'incomplete';
 const scheduled=env.PLATFORM_BACKUP_SCHEDULE==='daily'&&String(env.PLATFORM_BACKUP_PASSWORD||'').length>=16&&Boolean(String(env.PLATFORM_BACKUP_DIR||'').trim());
 return {scheduled:Boolean(scheduled),external};
}

function hmac(key,data){return createHmac('sha256',key).update(data).digest();}
function sha256(data){return createHash('sha256').update(data).digest('hex');}

export function s3Authorization({method,host,path,region,accessKeyId,secretAccessKey,payloadHash,amzDate}){
 const date=amzDate.slice(0,8);
 const canonical=`${method}\n${path}\n\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n\nhost;x-amz-content-sha256;x-amz-date\n${payloadHash}`;
 const scope=`${date}/${region}/s3/aws4_request`;
 const stringToSign=`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
 const signing=hmac(hmac(hmac(hmac('AWS4'+secretAccessKey,date),region),'s3'),'aws4_request');
 const signature=createHmac('sha256',signing).update(stringToSign).digest('hex');
 return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`;
}

export async function putS3Object({env,filePath,key,fetchImpl=fetch,now=new Date()}){
 const schedule=backupSchedule(env);
 if(schedule.external!=='configured')throw new Error('External storage is not configured.');
 const endpoint=String(env.PLATFORM_BACKUP_S3_ENDPOINT).replace(/\/$/,'');
 const url=new URL(`${endpoint}/${encodeURIComponent(env.PLATFORM_BACKUP_S3_BUCKET)}/${key.split('/').map(encodeURIComponent).join('/')}`);
 const body=await readFile(filePath);
 const amzDate=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
 const payloadHash=sha256(body);
 const authorization=s3Authorization({method:'PUT',host:url.host,path:url.pathname,region:env.PLATFORM_BACKUP_S3_REGION,accessKeyId:env.PLATFORM_BACKUP_S3_ACCESS_KEY_ID,secretAccessKey:env.PLATFORM_BACKUP_S3_SECRET_ACCESS_KEY,payloadHash,amzDate});
 const response=await fetchImpl(url, {method:'PUT',body,headers:{host:url.host,'x-amz-date':amzDate,'x-amz-content-sha256':payloadHash,authorization,'content-type':'application/octet-stream'}});
 if(!response.ok)throw new Error(`External storage rejected the backup (${response.status}). The encrypted file remains on this server only.`);
}

export async function runScheduledBackup({env,createBackup,upload=putS3Object,now=new Date()}){
 const schedule=backupSchedule(env);
 if(!schedule.scheduled)return {ran:false,reason:'not_scheduled',externalStorage:schedule.external};
 const dir=resolve(env.PLATFORM_BACKUP_DIR);
 await mkdir(dir,{recursive:true,mode:0o700});
 const day=now.toISOString().slice(0,10);
 const destination=join(dir,`klarraum-platform-${day}.klrb`);
 const statusPath=join(dir,'backup-status.json');
 if(await existsFile(destination))return {ran:false,reason:'already_written',externalStorage:schedule.external};
 const result=await createBackup({password:env.PLATFORM_BACKUP_PASSWORD,destination});
 let externalStorage=schedule.external,uploadError='';
 if(schedule.external==='configured'){
  try{await upload({env,filePath:destination,key:basename(destination),now});externalStorage='uploaded';}
  catch(error){externalStorage='failed';uploadError=error.message||'Upload failed.';}
 }
 const status={createdAt:result.createdAt||now.toISOString(),companies:result.companies??null,size:result.size??null,externalStorage,uploadError};
 await writeFile(statusPath,JSON.stringify(status),{mode:0o600});
 if(externalStorage==='failed'||externalStorage==='incomplete'){const error=new Error(uploadError||'External storage settings are incomplete. The encrypted file is only on this server.');error.statusInfo=status;throw error;}
 return {ran:true,...status};
}

async function existsFile(path){try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
