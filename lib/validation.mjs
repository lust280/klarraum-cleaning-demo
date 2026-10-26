import { estimate, validatePricing } from '../public/pricing.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = message => { throw new HttpError(400, message); };
function text(value, max, label, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') fail(`${label}: ungültige Angabe.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result)) fail(`${label}: bitte Eingabe prüfen.`);
  return result;
}
export function validateInquiry(body, pricing, business, now, timeZone='Europe/Berlin') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Ungültige Anfrage.');
  const name = text(body.name, 100, 'Name', true);
  const email = text(body.email, 254, 'E-Mail');
  const phone = text(body.phone, 40, 'Telefon');
  if (!email && !phone) fail('Bitte E-Mail oder Telefonnummer angeben.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Bitte eine gültige E-Mail-Adresse eingeben.');
  if (phone && (!/^[+\d\s()/.\-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7)) fail('Bitte eine gültige Telefonnummer eingeben.');
  const postcode = text(body.postcode, 5, 'Postleitzahl', true);
  if (!/^\d{5}$/.test(postcode)) fail('Bitte eine fünfstellige Postleitzahl eingeben.');
  if (business.postcodes.length && !business.postcodes.some(prefix => postcode.startsWith(prefix))) fail('Diese Postleitzahl liegt außerhalb unseres Einsatzgebiets.');
  const address = text(body.address, 200, 'Adresse');
  const message = text(body.message, 2000, 'Nachricht');
  const date = text(body.date, 10, 'Wunschtermin');
  if (date) {
    const parsed = new Date(`${date}T12:00:00Z`);
    const today = new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(now));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date || date < today || parsed.getTime() > now + 366 * 86400000) fail('Bitte einen gültigen zukünftigen Wunschtermin innerhalb eines Jahres wählen.');
  }
  if (body.privacy !== true) fail('Bitte die Datenschutzhinweise bestätigen.');
  if (typeof body.windows !== 'boolean') fail('Bitte Zusatzleistung prüfen.');
  let price;
  try { price = estimate(body.service, body.area, body.frequency, body.windows, pricing); }
  catch { fail('Bitte Leistung, Fläche und Rhythmus prüfen.'); }
  return {name, email, phone, postcode, address, message, date, service:body.service, area:body.area, frequency:body.frequency, windows:body.windows, price, privacyVersion:'2026-10-25'};
}

export function checkedPricing(body) {
  try {
    validatePricing(body);
    return {
      rates:Object.fromEntries(['home','office','deep'].map(key=>[key,body.rates[key]])),
      discounts:Object.fromEntries(['once','weekly','fortnightly'].map(key=>[key,body.discounts[key]])),
      minimum:body.minimum, windows:body.windows,
    };
  }
  catch { fail('Ungültige Preise. Bitte alle Beträge und Rabatte prüfen.'); }
}
