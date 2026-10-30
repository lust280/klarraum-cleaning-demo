import { resolve } from 'node:path';
import { validPasswordHash, randomToken, hashHostedPassword } from './security.mjs';
import { integrationStatus } from './integrations.mjs';

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
  const passwordHash = env.ADMIN_PASSWORD_HASH || (env.ADMIN_PASSWORD ? hashHostedPassword(env.ADMIN_PASSWORD,env.APP_SECRET) : '');
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password) throw new Error('APP_ORIGIN must be an origin without a path or trailing slash.');
  if (production && url.protocol !== 'https:') throw new Error('Production requires an HTTPS APP_ORIGIN.');
  if (production && !validPasswordHash(passwordHash)) throw new Error('Production requires ADMIN_PASSWORD_HASH or a securely configured ADMIN_PASSWORD.');
  if (production && (env.APP_SECRET || '').length < 32) throw new Error('Production requires APP_SECRET with at least 32 characters.');
  const retentionDays = Number(env.RETENTION_DAYS || 90);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error('RETENTION_DAYS must be 1–365.');
  const timeZone=env.BUSINESS_TIME_ZONE||'Europe/Berlin',currency=(env.BUSINESS_CURRENCY||'EUR').toUpperCase();
  try{new Intl.DateTimeFormat('en-US',{timeZone});}catch{throw new Error('BUSINESS_TIME_ZONE must be a valid IANA time zone.');}
  if(!/^[A-Z]{3}$/.test(currency))throw new Error('BUSINESS_CURRENCY must be a three-letter currency code.');
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
    customerReceipt: env.MAIL_CUSTOMER_RECEIPT !== 'false',
  };
  const legalReady = Boolean(business.owner && business.address && business.priceNote && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email) && business.privacyDetails && env.LEGAL_REVIEWED === 'true');
  const mailReady = Boolean(mail.key && mail.from && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.to));
  const requestedLive = env.ENABLE_INQUIRIES === 'true';
  if (env.DEMO_ONLY === 'true' && requestedLive) throw new Error('DEMO_ONLY prevents live inquiries on temporary storage.');
  if (requestedLive && (!legalReady || !mailReady || !validPasswordHash(passwordHash))) {
    throw new Error('Live inquiries require business/legal details, LEGAL_REVIEWED=true, configured mail and ADMIN_PASSWORD_HASH.');
  }
  return {
    production, origin, platformOrigin:String(env.PLATFORM_ORIGIN || '').replace(/\/$/, ''), directorDataDir:env.DIRECTOR_DATA_DIR?resolve(env.DIRECTOR_DATA_DIR):undefined, dbPath: resolve(env.DATA_DIR || './data', 'klarraum.sqlite'),
    passwordHash, secret: env.APP_SECRET || randomToken(),
    secureCookie: production || url.protocol === 'https:',
    trustProxy: env.TRUST_PROXY === '1', retentionDays, business, mail,timeZone,currency,
    live: requestedLive, demoMode:env.DEMO_ONLY === 'true', legalReady,
    employeeEmail:env.EMPLOYEE_EMAIL_NOTIFICATIONS==='true',
    persistentStorageConfirmed:env.PERSISTENT_STORAGE_CONFIRMED==='true',
    partnerPlan:['starter','pro','plus'].includes(env.PARTNER_PLAN_KEY) ? env.PARTNER_PLAN_KEY : 'pro',
    integrations: integrationStatus(env),
    google:{clientId:String(env.GOOGLE_CLIENT_ID||'').trim(),clientSecret:String(env.GOOGLE_CLIENT_SECRET||'').trim(),redirectUri:String(env.GOOGLE_CALENDAR_REDIRECT_URI||'').trim()},
  };
}
