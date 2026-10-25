import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PRICING } from '../public/pricing.js';

export const STATUSES = ['new', 'contacted', 'confirmed', 'completed'];

export class Store {
  constructor(path) {
    mkdirSync(dirname(path), {recursive:true, mode:0o700});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS inquiries (
        id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL,
        payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at INTEGER NOT NULL,
        mail_status TEXT NOT NULL DEFAULT 'pending', mail_attempts INTEGER NOT NULL DEFAULT 0,
        mail_last_attempt INTEGER, mail_error TEXT
      );
      CREATE INDEX IF NOT EXISTS inquiry_created ON inquiries(created_at DESC);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.db.prepare('INSERT OR IGNORE INTO settings(id,payload) VALUES(1,?)').run(JSON.stringify(DEFAULT_PRICING));
  }
  pricing() { return JSON.parse(this.db.prepare('SELECT payload FROM settings WHERE id=1').get().payload); }
  bindAuth(version) {
    const previous = this.db.prepare("SELECT value FROM metadata WHERE key='auth_version'").get();
    if (previous?.value !== version) {
      this.db.exec('DELETE FROM sessions');
      this.db.prepare("INSERT INTO metadata(key,value) VALUES('auth_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(version);
    }
  }
  setPricing(value) { this.db.prepare('UPDATE settings SET payload=? WHERE id=1').run(JSON.stringify(value)); }
  byKey(key) { return this.db.prepare('SELECT * FROM inquiries WHERE request_key=?').get(key); }
  get(id) { return this.db.prepare('SELECT * FROM inquiries WHERE id=?').get(id); }
  add(key, fingerprint, payload, now) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO inquiries(id,request_key,fingerprint,payload,created_at,mail_status) VALUES(?,?,?,?,?,?)').run(id,key,fingerprint,JSON.stringify(payload),now,payload.demo?'demo':'pending');
    return this.get(id);
  }
  list(status, offset) {
    const rows = status
      ? this.db.prepare('SELECT * FROM inquiries WHERE status=? ORDER BY created_at DESC,id LIMIT 50 OFFSET ?').all(status,offset)
      : this.db.prepare('SELECT * FROM inquiries ORDER BY created_at DESC,id LIMIT 50 OFFSET ?').all(offset);
    const total = status
      ? this.db.prepare('SELECT COUNT(*) AS total FROM inquiries WHERE status=?').get(status).total
      : this.db.prepare('SELECT COUNT(*) AS total FROM inquiries').get().total;
    return {items:rows.map(row => this.publicRow(row)), total};
  }
  publicRow(row) {
    return {id:row.id, ...JSON.parse(row.payload), status:row.status, createdAt:row.created_at,
      notification:row.mail_status, notificationAttempts:row.mail_attempts};
  }
  setStatus(id, status) { return this.db.prepare('UPDATE inquiries SET status=? WHERE id=?').run(status,id).changes; }
  remove(id) { return this.db.prepare('DELETE FROM inquiries WHERE id=?').run(id).changes; }
  session(hash) { return this.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash); }
  createSession(hash, csrf, expiry) { this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash,csrf,expiry); }
  endSession(hash) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); }
  cleanup(now, days) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    return this.db.prepare('DELETE FROM inquiries WHERE created_at<?').run(now-days*86400000).changes;
  }
  pendingMail(now) {
    return this.db.prepare("SELECT id FROM inquiries WHERE mail_status IN ('pending','failed') AND mail_attempts<5 AND (mail_last_attempt IS NULL OR mail_last_attempt<?) LIMIT 10").all(now-60000);
  }
  mailAttempt(id, now) { this.db.prepare('UPDATE inquiries SET mail_attempts=mail_attempts+1,mail_last_attempt=? WHERE id=?').run(now,id); }
  mailResult(id, success) { this.db.prepare('UPDATE inquiries SET mail_status=?,mail_error=? WHERE id=?').run(success?'sent':'failed',success?null:'delivery_failed',id); }
  resetMail(id) { this.db.prepare("UPDATE inquiries SET mail_status='pending',mail_attempts=0,mail_last_attempt=NULL WHERE id=? AND mail_status!='sent'").run(id); }
  async backup(path) {
    // VACUUM INTO creates a consistent, standalone snapshot, including WAL data.
    this.db.prepare('VACUUM INTO ?').run(path);
  }
  close() { this.db.close(); }
}
