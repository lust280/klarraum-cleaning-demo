import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const items=[];
async function scan(root){for(const entry of await readdir(root,{withFileTypes:true})){if(entry.name.startsWith('.'))continue;const folder=join(root,entry.name);if(entry.name.startsWith('@')){await scan(folder);continue;}try{const p=JSON.parse(await readFile(join(folder,'package.json'),'utf8'));items.push({name:p.name,version:p.version,license:p.license||'CHECK LICENSE FILE',path:folder});}catch(error){if(error.code!=='ENOENT')throw error;}}}
await scan('node_modules');console.log(JSON.stringify(items.sort((a,b)=>a.name.localeCompare(b.name)),null,2));
