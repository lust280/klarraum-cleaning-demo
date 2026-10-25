import sharp from 'sharp';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {HttpError} from './validation.mjs';
import {referencedMedia} from './site-settings.mjs';
sharp.cache(false);
sharp.concurrency(1);
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function createMediaService(config,store,now){
 const directory=join(dirname(config.dbPath),'uploads');let busy=false;
 async function upload(req,kind){
  if(!['logo','hero','gallery'].includes(kind))throw new HttpError(400,'Ungültiger Bildtyp.');
  if(busy)throw new HttpError(429,'Ein Bild wird gerade verarbeitet. Bitte kurz warten.');
  if(store.listMedia().length>=40)throw new HttpError(409,'Bildspeicher voll. Nicht verwendete Bilder zuerst löschen.');
  const type=(req.headers['content-type']||'').split(';')[0];
  if(!['image/jpeg','image/png','image/webp'].includes(type))throw new HttpError(415,'Bitte JPG, PNG oder WebP hochladen. SVG, GIF und HEIC werden nicht unterstützt.');
  busy=true;
  try{
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>5*1024*1024)throw new HttpError(413,'Das Bild darf höchstens 5 MB groß sein.');chunks.push(chunk);}
   const input=Buffer.concat(chunks);
   const signature=input.subarray(0,12);
   const format=signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':
     signature.subarray(0,3).equals(Buffer.from([255,216,255]))?'jpeg':
     signature.subarray(0,4).toString()==='RIFF'&&signature.subarray(8,12).toString()==='WEBP'?'webp':null;
   if(!format)throw new HttpError(400,'Die Datei ist kein unterstütztes Bild.');
   let output;
   try{
    const image=sharp(input,{limitInputPixels:12000000,failOn:'warning'});const metadata=await image.metadata();
    if(metadata.format!==format||(metadata.pages||1)>1)throw new Error('Unsupported image');
    output=await image.rotate().resize({width:kind==='logo'?600:1600,height:kind==='logo'?400:1200,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
   }catch{throw new HttpError(400,'Bild nicht lesbar. Bitte ein JPG, PNG oder WebP mit höchstens 12 Megapixeln verwenden.');}
   if(output.data.length>2*1024*1024)throw new HttpError(413,'Das optimierte Bild ist zu groß. Bitte ein kleineres Bild wählen.');
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
