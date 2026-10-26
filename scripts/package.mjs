import {mkdir,readFile,writeFile,cp,rm,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const destination=resolve(process.env.RELEASE_DIR||join(root,'dist'));await mkdir(destination,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'klarraum-release-'));
const name='klarraum-'+pkg.version,folder=join(temporary,name);await mkdir(folder);
// Explicit allowlist: never traverse data, .git, node_modules, .env*, screenshots or logs.
const allowed=['director.mjs','director-public','lib','public','scripts','docs','test','e2e','server.mjs','pricing.test.mjs','playwright.config.mjs','package.json','package-lock.json','.node-version','.env.example','.env.director.example','Dockerfile','compose.yaml','.dockerignore','render.yaml','render-production.yaml','README.md','CHANGELOG.md','LICENSE.txt','THIRD-PARTY-NOTICES.md'];
try {
 for(const item of allowed)await cp(join(root,item),join(folder,item),{recursive:true,dereference:false,verbatimSymlinks:true});
 const files=execFileSync('find',[folder,'-type','l'],{encoding:'utf8'}).trim();if(files)throw new Error('Release contains symbolic links; inspect source files.');
 const archive=join(destination,name+'.tar.gz');execFileSync('tar',['-czf',archive,'-C',temporary,name]);
 const digest=createHash('sha256').update(await readFile(archive)).digest('hex');await writeFile(archive+'.sha256',digest+'  '+name+'.tar.gz\n');
 console.log('Release created: '+archive+' (SHA-256 sidecar included).');
} finally {await rm(temporary,{recursive:true,force:true});}
