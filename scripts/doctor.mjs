import {DatabaseSync} from 'node:sqlite';
import {access} from 'node:fs/promises';
import {dirname} from 'node:path';
import {constants} from 'node:fs';
import {loadConfig} from '../lib/config.mjs';
try{
 const config=loadConfig();let db;
 try{
  await access(config.dbPath,constants.R_OK|constants.W_OK);await access(dirname(config.dbPath),constants.W_OK);
  db=new DatabaseSync(config.dbPath,{readOnly:true});const integrity=db.prepare('PRAGMA quick_check').get().quick_check==='ok';
  console.log(JSON.stringify({node:process.versions.node,databaseIntegrity:integrity,ownerConfigured:Boolean(config.passwordHash),demoMode:config.demoMode,inquiriesEnabled:config.live,mailConfigured:Boolean(config.mail.key&&config.mail.from&&config.mail.to),employeeEmailEnabled:config.employeeEmail&&!config.demoMode,persistentStorageConfirmed:config.persistentStorageConfirmed&&!config.demoMode,note:'Configuration presence and database check only; real delivery, off-site backup and persistence must be verified separately.'},null,2));
  if(!integrity||!config.passwordHash)process.exitCode=1;
 }finally{db?.close();}
}catch(error){console.error(error.code==='ENOENT'?'No existing database found. Initialize and start the application first.':error.message);process.exitCode=1;}
