export function estimate(service, area, frequency, windows = false) {
 const rates = {home:1.8,office:1.5,deep:3.2};
 const discounts = {once:1,weekly:0.9,fortnightly:0.95};
 if (!Object.hasOwn(rates,service) || !Object.hasOwn(discounts,frequency) || !Number.isInteger(area) || area<20 || area>1000) throw new RangeError('Invalid quote input');
 return Math.round((Math.max(60,area*rates[service]*discounts[frequency])+(windows?40:0))*100)/100;
}
