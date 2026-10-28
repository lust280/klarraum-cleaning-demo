import {validPasswordHash} from './security.mjs';

const emailOk=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** Readiness for a platform company. `inquiries_enabled` null = auto, 0 = off, 1 = on. */
export function companyInquiryReadiness(row={}, mail={}, {passwordHash=''}={}) {
  const email=String(row.contact_email||'').trim();
  const missing=[];
  if(!emailOk(email)) missing.push('contact email');
  if(!String(row.legal_owner||'').trim()) missing.push('legal owner');
  if(!String(row.legal_address||'').trim()) missing.push('legal address');
  if(!String(row.price_note||'').trim()) missing.push('price note');
  if(!String(row.privacy_details||'').trim()) missing.push('privacy details');
  if(Number(row.legal_reviewed)!==1) missing.push('legal review acknowledgement');
  const mailMissing=[];
  if(!mail?.key) mailMissing.push('PLATFORM_RESEND_API_KEY');
  if(!mail?.from) mailMissing.push('PLATFORM_MAIL_FROM');
  const legalReady=missing.length===0;
  const mailReady=mailMissing.length===0&&emailOk(email);
  const passwordReady=validPasswordHash(passwordHash);
  const preference=row.inquiries_enabled==null||row.inquiries_enabled===''?'auto':Number(row.inquiries_enabled)===1?'on':'off';
  const ready=legalReady&&mailReady&&passwordReady;
  return {email,missing,mailMissing,legalReady,mailReady,passwordReady,preference,ready,accepting:preference!=='off'&&ready};
}

export function inquiryBlockers(ready, {demo=false}={}) {
  if(demo) return 'Live inquiries are unavailable while this company runs on temporary demo storage.';
  if(ready.preference==='off') return 'Inquiries are paused by the company owner.';
  const parts=[];
  if(ready.missing.length) parts.push('Add '+ready.missing.join(', ')+'.');
  if(ready.mailMissing.length) parts.push('Platform mail is not configured ('+ready.mailMissing.join(', ')+').');
  if(!ready.passwordReady) parts.push('The company owner must finish activation first.');
  return parts.join(' ');
}

/** Env fragment for loadConfig. Demo storage never requests live inquiries. */
export function companyInquiryEnv(row, mail, options={}) {
  const ready=companyInquiryReadiness(row, mail, options);
  const demo=options.demo===true;
  const env={
    BUSINESS_OWNER:String(row?.legal_owner||'').trim(),
    BUSINESS_ADDRESS:String(row?.legal_address||'').trim(),
    BUSINESS_EMAIL:ready.email,
    BUSINESS_PHONE:String(row?.contact_phone||'').trim(),
    PRICE_NOTE:String(row?.price_note||'').trim(),
    BUSINESS_LEGAL_DETAILS:String(row?.legal_extra||'').trim(),
    PRIVACY_DETAILS:String(row?.privacy_details||'').trim(),
    LEGAL_REVIEWED:Number(row?.legal_reviewed)===1?'true':'false',
    RESEND_API_KEY:mail?.key||'',
    MAIL_FROM:mail?.from||'',
    MAIL_TO:ready.email,
    ENABLE_INQUIRIES:!demo&&ready.accepting?'true':'false',
  };
  const postcodes=String(row?.service_postcodes||'').trim();
  if(postcodes) env.SERVICE_POSTCODES=postcodes;
  return {env,ready:{...ready,accepting:!demo&&ready.accepting}};
}
