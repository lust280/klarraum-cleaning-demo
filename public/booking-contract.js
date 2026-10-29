// Client reader for Partner Admin's public booking contract.
// Prefer GET /api/config partnerBooking (top-level bookingMode is the effective mode).
// Else GET /api/partner/booking-mode, the same publicBooking() / projectPublic payload.
// If neither is present yet, stay in request mode. Do not invent a second booking setting.

const MODES = new Set(['paused', 'request', 'instant']);

export function isBookingContract(value) {
  return Boolean(value && typeof value === 'object' && MODES.has(value.bookingMode) && value.prices && typeof value.prices === 'object');
}

export function normalizeBooking(value) {
  const bookingMode = MODES.has(value.bookingMode) ? value.bookingMode : 'request';
  const storedBookingMode = MODES.has(value.storedBookingMode) ? value.storedBookingMode : bookingMode;
  const prices = value.prices || {};
  const minimum = prices.minimum == null || prices.minimum === '' ? null : Number(prices.minimum);
  const maxArea = prices.maxAreaM2 == null || prices.maxAreaM2 === '' ? null : Number(prices.maxAreaM2);
  const speed = Number(prices.speedM2PerHour);
  return {
    bookingMode,
    storedBookingMode,
    trialPaused: value.trialPaused === true || storedBookingMode !== bookingMode,
    currency: typeof value.currency === 'string' && value.currency ? value.currency : 'EUR',
    areaUnit: value.areaUnit === 'sqft' ? 'sqft' : 'm2',
    cardPayments: bookingMode === 'instant' && value.cardPayments === true,
    connectOn: value.connectOn === true,
    company: {
      name: value.company?.name || '',
      phone: value.company?.phone || '',
      email: value.company?.email || '',
    },
    prices: {
      home: Number(prices.home),
      office: Number(prices.office),
      deep: Number(prices.deep),
      minimum: Number.isFinite(minimum) ? minimum : null,
      maxAreaM2: Number.isFinite(maxArea) ? maxArea : null,
      speedM2PerHour: Number.isFinite(speed) && speed > 0 ? speed : 30,
    },
    demoJob: value.demoJob || null,
  };
}

export function fallbackBooking({currency = 'EUR', company = {}, pricing = {}} = {}) {
  const rates = pricing.rates || {};
  return normalizeBooking({
    bookingMode: 'request',
    storedBookingMode: 'request',
    trialPaused: false,
    currency,
    areaUnit: 'm2',
    cardPayments: false,
    connectOn: false,
    company,
    prices: {
      home: rates.home ?? 2.2,
      office: rates.office ?? 1.8,
      deep: rates.deep ?? 3.5,
      minimum: pricing.minimum ?? null,
      maxAreaM2: null,
      speedM2PerHour: 30,
    },
    demoJob: {
      address: '12 Linden St, 10115 Berlin',
      areaM2: 70,
      ratePerM2: 2.2,
      quote: 154,
      currency: 'EUR',
      payment: 'Unpaid',
    },
  });
}

export function resolveBooking({config = null, partner = null, company = null, pricing = null} = {}) {
  if (isBookingContract(config?.partnerBooking)) {
    const booking = normalizeBooking({...config.partnerBooking, bookingMode: MODES.has(config.bookingMode) ? config.bookingMode : config.partnerBooking.bookingMode});
    booking.cardPayments = booking.bookingMode === 'instant' && config.partnerBooking.cardPayments === true;
    return {booking, source: 'config'};
  }
  if (isBookingContract(partner)) return {booking: normalizeBooking(partner), source: 'partner-booking-mode'};
  return {
    booking: fallbackBooking({
      currency: config?.currency,
      company: company || config?.site?.company || {},
      pricing: pricing || config?.pricing || {},
    }),
    source: 'stub',
    stub: true,
    note: 'No partnerBooking on GET /api/config and no GET /api/partner/booking-mode yet. The funnel stays in request mode until Partner Admin is merged.',
  };
}

export function allowsCard(booking) {
  return booking?.bookingMode === 'instant' && booking?.cardPayments === true;
}
