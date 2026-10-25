import {hashPassword} from '../lib/security.mjs';
if (!process.stdin.isTTY) {
  let password='';for await (const chunk of process.stdin) password+=chunk;
  console.log(await hashPassword(password.replace(/\r?\n$/,'')));
} else {
  process.stderr.write('New administrator password (14–256 characters; hidden): ');
  process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.resume();
  let password='';
  process.stdin.on('data',async chunk=>{
    for(const char of chunk){
      if(char==='\u0003'){process.stdin.setRawMode(false);process.exit(130);}
      if(char==='\r'||char==='\n'){
        process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');
        try{console.log(await hashPassword(password));}catch(error){console.error(error.message);process.exitCode=1;}return;
      }
      if(char==='\u007f'||char==='\b')password=password.slice(0,-1);
      else if(password.length<256)password+=char;
    }
  });
}
