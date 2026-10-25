import {HttpError} from './validation.mjs';
import {validDate} from './reporting.mjs';
const format=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function berlinInstant(date,time){
 if(!validDate(date)||typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new HttpError(400,'Datum und Uhrzeit prüfen.');
 const wall=Date.parse(date+'T'+time+':00Z');const matches=[];
 for(const offset of [60,120]){const candidate=wall-offset*60000;if(format.format(candidate)===date+' '+time)matches.push(candidate);}
 if(matches.length!==1)throw new HttpError(400,'Diese Uhrzeit ist wegen der Zeitumstellung ungültig oder doppeldeutig. Bitte eine andere Uhrzeit wählen.');
 return matches[0];
}
export function shiftDate(date,days){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function recurrenceDates(start,end,frequency){
 if(!validDate(start)||!validDate(end)||end<start||Date.parse(end)-Date.parse(start)>366*86400000||!['weekly','fortnightly','monthly'].includes(frequency))throw new HttpError(400,'Serie: Zeitraum bis zu einem Jahr und Rhythmus wählen.');
 const dates=[];const [y,m,day]=start.split('-').map(Number);
 for(let i=0;i<121;i++){
  let date;
  if(frequency==='monthly'){const month=new Date(Date.UTC(y,m-1+i,1,12));const last=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();date=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),Math.min(day,last),12)).toISOString().slice(0,10);}
  else date=shiftDate(start,i*(frequency==='weekly'?7:14));
  if(date>end)break;dates.push(date);
 }
 if(dates.length>120)throw new HttpError(400,'Maximal 120 Termine pro Serie.');return dates;
}
