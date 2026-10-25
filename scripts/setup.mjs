import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {hashPassword} from '../lib/security.mjs';

// No password arguments, default credentials, overwrites or network calls.
export async function initialize({directory=process.cwd(),origin,password,demo=true}) {
 const url=new URL(origin);
 if(url.origin!==origin||url.username||url.password||!['http:','https:'].includes(url.protocol))throw new Error('Use an HTTP(S) origin without a path or trailing slash.');
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('A public installation requires HTTPS.');
 const hash=await hashPassword(password);
 await mkdir(directory,{recursive:true,mode:0o700});
 const entries={NODE_ENV:url.protocol==='https:'?'production':'development',APP_ORIGIN:origin,ADMIN_PASSWORD_HASH:hash,APP_SECRET:randomBytes(48).toString('base64url'),DATA_DIR:'./data',DEMO_ONLY:String(demo),ENABLE_INQUIRIES:'false',EMPLOYEE_EMAIL_NOTIFICATIONS:'false',TRUST_PROXY:'0'};
 const content='# Private installation settings. Never share or commit this file.\n'+Object.entries(entries).map(([k,v])=>`${k}=${v}`).join('\n')+'\n';
 const file=join(resolve(directory),'.env.local');await writeFile(file,content,{flag:'wx',mode:0o600});
 return file;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)) {
 let muted=false;
 const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done();}});
 const rl=createInterface({input:process.stdin,output,terminal:Boolean(process.stdin.isTTY)});
 try {
  const origin=(await rl.question('Site origin (for example https://cleaning.example): ')).trim();
  process.stdout.write('Choose owner password (14–256 characters, hidden): ');muted=true;
  const password=await rl.question('');muted=false;process.stdout.write('\nRepeat password (hidden): ');muted=true;
  const repeat=await rl.question('');muted=false;process.stdout.write('\n');if(password!==repeat)throw new Error('Passwords do not match.');
  const demo=(await rl.question('Use fictional demo data only? [Y/n]: ')).trim().toLowerCase()!=='n';
  await initialize({origin,password,demo});
  console.log('Private .env.local created. Run npm run start:local. Real inquiries remain disabled until business, mail and storage are configured.');
 } catch(error) {console.error(error.code==='EEXIST'?'Refusing to overwrite .env.local. Keep the existing credentials.':error.message);process.exitCode=1;}
 finally {rl.close();}
}
