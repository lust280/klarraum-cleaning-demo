import { randomBytes, scrypt as derive, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(derive);
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 256) {
    throw new Error('Use a password with 14–256 characters.');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export function validPasswordHash(hash) {
  return /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash || '');
}

export async function verifyPassword(password, hash) {
  if (!validPasswordHash(hash) || typeof password !== 'string' || password.length > 256) return false;
  const [, salt, expected] = hash.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function formToken(secret, now) {
  const value = `${now}.${randomToken()}`;
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}

export function validFormToken(token, secret, now) {
  if (typeof token !== 'string' || token.length > 200) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return false;
  const value = parts.slice(0, 2).join('.');
  const expected = createHmac('sha256', secret).update(value).digest('base64url');
  const actual = parts[2];
  const age = now - Number(parts[0]);
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected)) && age >= 2000 && age <= 3600000;
}

export class RateLimiter {
  constructor() { this.entries = new Map(); }
  allow(key, limit, interval, now) {
    if (this.entries.size >= 10000) {
      for (const [id, item] of this.entries) if (item.until <= now) this.entries.delete(id);
      if (this.entries.size >= 10000 && !this.entries.has(key)) return false;
    }
    let item = this.entries.get(key);
    if (!item || item.until <= now) {
      item = { count: 0, until: now + interval };
      this.entries.set(key, item);
    }
    item.count++;
    return item.count <= limit;
  }
}
