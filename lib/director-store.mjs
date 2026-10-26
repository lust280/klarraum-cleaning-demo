import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {randomToken,digest} from './security.mjs';

export class DirectorStore {
  constructor(path) {
    mkdirSync(dirname(path), {recursive:true,mode:0o700});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',payment TEXT NOT NULL DEFAULT 'trial',base_cents INTEGER NOT NULL,included INTEGER NOT NULL,seat_cents INTEGER NOT NULL,secret TEXT NOT NULL,password_hash TEXT,invite_hash TEXT UNIQUE,invite_expires INTEGER,created_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS director_sessions(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS director_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS director_events(id INTEGER PRIMARY KEY,company_id TEXT,action TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  }
  bindAuth(hash) {
    const old=this.db.prepare("SELECT value FROM director_meta WHERE key='auth'").get();
    if(old?.value!==hash) {
      this.db.exec('DELETE FROM director_sessions');
      this.db.prepare("INSERT INTO director_meta VALUES('auth',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(hash);
    }
  }
  event(id,action,details={}) {this.db.prepare('INSERT INTO director_events(company_id,action,details,created_at) VALUES(?,?,?,?)').run(id,action,JSON.stringify(details),Date.now());}
  company(id) {return this.db.prepare('SELECT * FROM companies WHERE id=?').get(id);}
  list() {return this.db.prepare('SELECT * FROM companies ORDER BY created_at DESC,id').all();}
  create(input) {
    const id=randomUUID(),token=randomToken(),now=Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO companies(id,name,base_cents,included,seat_cents,secret,invite_hash,invite_expires,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,input.name,input.baseCents,input.included,input.seatCents,randomToken(),digest(token),now+48*3600000,now);
      this.event(id,'created',{name:input.name});this.db.exec('COMMIT');
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
    return {row:this.company(id),token};
  }
  update(id,input) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result=this.db.prepare('UPDATE companies SET name=?,status=?,payment=?,base_cents=?,included=?,seat_cents=?,version=version+1 WHERE id=? AND version=?').run(input.name,input.status,input.payment,input.baseCents,input.included,input.seatCents,id,input.version);
      if(!result.changes) {const e=new Error('Company changed. Refresh before saving.');e.status=409;throw e;}
      this.event(id,'updated',input);this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  invite(id) {
    const token=randomToken();
    this.db.prepare('UPDATE companies SET invite_hash=?,invite_expires=?,version=version+1 WHERE id=?').run(digest(token),Date.now()+48*3600000,id);
    this.event(id,'owner_invitation_replaced');return token;
  }
  activate(id,token,passwordHash) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result=this.db.prepare("UPDATE companies SET password_hash=?,invite_hash=NULL,invite_expires=NULL,version=version+1 WHERE id=? AND status='active' AND invite_hash=? AND invite_expires>?").run(passwordHash,id,digest(token),Date.now());
      if(!result.changes){const e=new Error('Invitation expired or already used.');e.status=400;throw e;}
      this.event(id,'owner_activated');this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  close(){this.db.close();}
}
