export const DEFAULT_PRICING = {
  rates: {home:1.8, office:1.5, deep:3.2},
  discounts: {once:1, weekly:0.9, fortnightly:0.95},
  minimum:60, windows:40,
};
export function validatePricing(value) {
  const finite = (n,min,max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (!value || !['home','office','deep'].every(k => finite(value.rates?.[k],0.1,100)) ||
      value.discounts?.once !== 1 || !['weekly','fortnightly'].every(k => finite(value.discounts?.[k],0.1,1)) ||
      !finite(value.minimum,10,5000) || !finite(value.windows,0,5000)) throw new RangeError('Invalid pricing');
}
export function estimate(service, area, frequency, windows = false, pricing = DEFAULT_PRICING) {
  validatePricing(pricing);
  if (!Object.hasOwn(pricing.rates,service) || !Object.hasOwn(pricing.discounts,frequency) ||
      !Number.isInteger(area) || area < 20 || area > 1000 || typeof windows !== 'boolean') throw new RangeError('Invalid quote input');
  return Math.round((Math.max(pricing.minimum,area*pricing.rates[service]*pricing.discounts[frequency]) + (windows?pricing.windows:0))*100)/100;
}
