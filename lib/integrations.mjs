// Stripe Checkout and Google Calendar stay inactive in this release.
// Keys may be present in the host environment so a later release can turn the
// flows on. This module never starts a charge or an OAuth redirect.

export function integrationStatus(env = {}) {
  return {
    stripe: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY),
    googleCalendar: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  };
}

export function stripeCheckout() {
  const error = new Error('Stripe Checkout is not enabled. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY for a later release; this version does not create charges.');
  error.code = 'stripe_inactive';
  throw error;
}

export function googleCalendarSync() {
  const error = new Error('Google Calendar sync is not enabled. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for a later release; this version does not start OAuth.');
  error.code = 'google_inactive';
  throw error;
}
