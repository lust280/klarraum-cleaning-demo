import {optimizeUpload} from './image-upload.mjs';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {HttpError} from './validation.mjs';
import {referencedMedia} from './site-settings.mjs';
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function createMediaService(config,store,now){
 const directory=join(dirname(config.dbPath),'uploads');let busy=false;
 async function upload(req,kind){
  if(!['logo','hero','gallery'].includes(kind))throw new HttpError(400,'Ungültiger Bildtyp.');
  if(busy)throw new HttpError(429,'Ein Bild wird gerade verarbeitet. Bitte kurz warten.');
  if(store.listMedia().length>=40)throw new HttpError(409,'Bildspeicher voll. Nicht verwendete Bilder zuerst löschen.');
  busy=true;
  try{
   const output=await optimizeUpload(req,kind==='logo');
   const id=randomUUID();const item={id,kind,width:output.info.width,height:output.info.height,size:output.data.length,createdAt:now()};
   await mkdir(directory,{recursive:true,mode:0o700});const path=join(directory,id+'.webp');await writeFile(path,output.data,{mode:0o600,flag:'wx'});
   try{if(!store.addMedia(item))throw new HttpError(409,'Bildspeicher voll.');}catch(error){await unlink(path);throw error;}
   return item;
  }finally{busy=false;}
 }
 function list(){const used=new Set(referencedMedia(store.site().content));return store.listMedia().map(item=>({...item,used:used.has(item.id)}));}
 async function remove(id){
  if(!idPattern.test(id)||!store.media(id))throw new HttpError(404,'Bild nicht gefunden.');
  if(referencedMedia(store.site().content).includes(id))throw new HttpError(409,'Dieses Bild wird auf der Website verwendet. Erst aus der Website entfernen und speichern.');
  // The synchronous row removal prevents a concurrent save from referencing it.
  store.removeMedia(id);
  try{await unlink(join(directory,id+'.webp'));}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 async function serve(req,res,url){
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end();}
  const match=url.pathname.match(/^\/media\/([a-f0-9-]{36})\.webp$/i);
  if(!match||!idPattern.test(match[1])||!store.media(match[1])){res.writeHead(404);return res.end('Not found');}
  try{const data=await readFile(join(directory,match[1]+'.webp'));res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'public, max-age=86400, immutable'});res.end(req.method==='HEAD'?undefined:data);}
  catch(error){if(error.code!=='ENOENT')throw error;res.writeHead(404);res.end('Not found');}
 }
 return {upload,list,remove,serve};
}
