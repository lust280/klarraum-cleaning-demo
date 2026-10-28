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

export function googleCalendarSync(env = process.env) {
  if (!googleConfigured(env)) {
    const error = new Error('Google Calendar is not configured.');
    error.code = 'google_inactive';
    error.status = 404;
    throw error;
  }
  return {ready:true};
}
