import sharp from 'sharp';
import {HttpError} from './validation.mjs';
sharp.cache(false);sharp.concurrency(1);
export async function optimizeUpload(req,logo=false){
 const type=(req.headers['content-type']||'').split(';')[0];
 if(!['image/jpeg','image/png','image/webp'].includes(type))throw new HttpError(415,'Bitte JPG, PNG oder WebP hochladen. SVG, GIF und HEIC werden nicht unterstützt.');
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>5*1024*1024)throw new HttpError(413,'Das Bild darf höchstens 5 MB groß sein.');chunks.push(chunk);}
 const input=Buffer.concat(chunks),signature=input.subarray(0,12);
 const format=signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':signature.subarray(0,3).equals(Buffer.from([255,216,255]))?'jpeg':signature.subarray(0,4).toString()==='RIFF'&&signature.subarray(8,12).toString()==='WEBP'?'webp':null;
 if(!format)throw new HttpError(400,'Die Datei ist kein unterstütztes Bild.');
 let output;
 try{
  const image=sharp(input,{limitInputPixels:12000000,failOn:'warning'}),metadata=await image.metadata();if(metadata.format!==format||(metadata.pages||1)>1)throw new Error('Unsupported image');
  output=await image.rotate().resize({width:logo?600:1600,height:logo?400:1200,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
 }catch{throw new HttpError(400,'Bild nicht lesbar. Bitte ein JPG, PNG oder WebP mit höchstens 12 Megapixeln verwenden.');}
 if(output.data.length>2*1024*1024)throw new HttpError(413,'Das optimierte Bild ist zu groß. Bitte ein kleineres Bild wählen.');return output;
}
