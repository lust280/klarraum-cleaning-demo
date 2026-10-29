// Stripe Checkout stays inactive. Google Calendar OAuth starts only when both
// Google keys are set; the calendar module performs that redirect.

import { googleConfigured } from './google-calendar.mjs';

export function integrationStatus(env = {}) {
  return {
    stripe: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY),
    googleCalendar: googleConfigured(env),
  };
}

export function stripeCheckout() {
  const error = new Error('Stripe Checkout is not enabled. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY for a later release; this version does not create charges.');
  error.code = 'stripe_inactive';
  throw error;
}

// Partner Connect (screens 41–44) stays inside this app. Customer card payments
// will be direct charges on the company's Express account later — never a charge
// through the operator — and this build does not call Stripe at all.
export function connectOnboardingStub(origin) {
  const base = String(origin || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base) || /stripe\.com/i.test(base)) {
    const error = new Error('Connect onboarding stays inside KlarraumApp. Stripe is not called.');
    error.code = 'stripe_inactive';
    throw error;
  }
  return {url:`${base}/partner.html#connect/mock`, live:false};
}

export function googleCalendarSync(env = process.env) {
  if (!googleConfigured(env)) {
    const error = new Error('Google Calendar is not configured.');
    error.code = 'google_inactive';
    error.status = 404;
    throw error;
  }
  return {ready:true};
}
