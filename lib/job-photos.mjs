import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {optimizeUpload} from './image-upload.mjs';
import {HttpError} from './validation.mjs';
export function createJobPhotos(config,team,now){
 const db=team.db,directory=join(dirname(config.dbPath),'job-photos');let busy=false;
 db.exec('CREATE TABLE IF NOT EXISTS job_photos(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),employee_id TEXT NOT NULL REFERENCES employees(id),width INTEGER NOT NULL,height INTEGER NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL)');
 db.exec('CREATE INDEX IF NOT EXISTS photos_job ON job_photos(job_id,created_at)');
 function list(jobId){return db.prepare('SELECT id,width,height,size,created_at FROM job_photos WHERE job_id=? ORDER BY created_at,id').all(jobId).map(item=>({...item,url:`/private/jobs/${jobId}/photos/${item.id}.webp`}));}
 async function upload(req,jobId,employeeId,authorize){
  if(busy)throw new HttpError(429,'Ein Foto wird gerade verarbeitet. Bitte kurz warten.');
  const job=team.job(jobId);if(!job||job.employee_id!==employeeId)throw new HttpError(404,'Auftrag nicht gefunden.');
  if(!['working','paused'].includes(job.state))throw new HttpError(409,'Fotos sind nur während der Bearbeitung möglich.');
  if(list(jobId).length>=4)throw new HttpError(409,'Maximal vier Arbeitsfotos pro Auftrag.');
  busy=true;
  try{
   const output=await optimizeUpload(req),id=randomUUID();await mkdir(directory,{recursive:true,mode:0o700});const path=join(directory,id+'.webp');await writeFile(path,output.data,{mode:0o600,flag:'wx'});
   try{team.tx(()=>{
    authorize();
    const current=team.job(jobId);if(!current||current.employee_id!==employeeId||!['working','paused'].includes(current.state)||!team.employee(employeeId)?.active)throw new HttpError(409,'Auftrag oder Mitarbeiterzugang wurde geändert.');
    if(list(jobId).length>=4)throw new HttpError(409,'Maximal vier Arbeitsfotos pro Auftrag.');
    db.prepare('INSERT INTO job_photos VALUES(?,?,?,?,?,?,?)').run(id,jobId,employeeId,output.info.width,output.info.height,output.data.length,now());team.event(jobId,employeeId,'photo_added','Arbeitsfoto hinzugefügt',now());
   });}catch(error){await unlink(path);throw error;}
   return {id,url:`/private/jobs/${jobId}/photos/${id}.webp`};
  }finally{busy=false;}
 }
 async function remove(jobId,id,employeeId){
  const job=team.job(jobId);if(!job||job.employee_id!==employeeId)throw new HttpError(404,'Auftrag nicht gefunden.');
  if(!['working','paused'].includes(job.state))throw new HttpError(409,'Abgegebene Arbeitsfotos können nicht mehr vom Mitarbeiter geändert werden.');
  if(!db.prepare('DELETE FROM job_photos WHERE id=? AND job_id=?').run(id,jobId).changes)throw new HttpError(404,'Foto nicht gefunden.');team.event(jobId,employeeId,'photo_removed','Arbeitsfoto vor Abgabe entfernt',now());
  try{await unlink(join(directory,id+'.webp'));}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 async function serve(req,res,jobId,id){
  if(!db.prepare('SELECT id FROM job_photos WHERE id=? AND job_id=?').get(id,jobId))throw new HttpError(404,'Foto nicht gefunden.');
  try{const body=await readFile(join(directory,id+'.webp'));res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'private, no-store'});res.end(req.method==='HEAD'?undefined:body);}catch(error){if(error.code==='ENOENT')throw new HttpError(404,'Foto nicht gefunden.');throw error;}
 }
 return {list,upload,remove,serve};
}
