import { resolve } from 'node:path';
import { validPasswordHash, randomToken } from './security.mjs';

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN || 'http://localhost:3000';
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password) throw new Error('APP_ORIGIN must be an origin without a path or trailing slash.');
  if (production && url.protocol !== 'https:') throw new Error('Production requires an HTTPS APP_ORIGIN.');
  if (production && !validPasswordHash(env.ADMIN_PASSWORD_HASH)) throw new Error('Production requires ADMIN_PASSWORD_HASH.');
  if (production && (env.APP_SECRET || '').length < 32) throw new Error('Production requires APP_SECRET with at least 32 characters.');
  const retentionDays = Number(env.RETENTION_DAYS || 90);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error('RETENTION_DAYS must be 1–365.');
  const business = {
    name: env.BUSINESS_NAME || 'Klarraum',
    owner: env.BUSINESS_OWNER || '',
    address: env.BUSINESS_ADDRESS || '',
    email: env.BUSINESS_EMAIL || '',
    phone: env.BUSINESS_PHONE || '',
    priceNote: env.PRICE_NOTE || '',
    additionalLegal: env.BUSINESS_LEGAL_DETAILS || '',
    privacyDetails: env.PRIVACY_DETAILS || '',
    postcodes: (env.SERVICE_POSTCODES || '90,91').split(',').map(x => x.trim()).filter(Boolean),
  };
  const mail = {
    key: env.RESEND_API_KEY || '', from: env.MAIL_FROM || '', to: env.MAIL_TO || '',
  };
  const legalReady = Boolean(business.owner && business.address && business.priceNote && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email) && business.privacyDetails && env.LEGAL_REVIEWED === 'true');
  const mailReady = Boolean(mail.key && mail.from && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.to));
  const requestedLive = env.ENABLE_INQUIRIES === 'true';
  if (requestedLive && (!legalReady || !mailReady || !validPasswordHash(env.ADMIN_PASSWORD_HASH))) {
    throw new Error('Live inquiries require business/legal details, LEGAL_REVIEWED=true, configured mail and ADMIN_PASSWORD_HASH.');
  }
  return {
    production, origin, dbPath: resolve(env.DATA_DIR || './data', 'klarraum.sqlite'),
    passwordHash: env.ADMIN_PASSWORD_HASH || '', secret: env.APP_SECRET || randomToken(),
    secureCookie: production || url.protocol === 'https:',
    trustProxy: env.TRUST_PROXY === '1', retentionDays, business, mail,
    live: requestedLive, legalReady,
  };
}
