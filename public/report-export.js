const headers={payments:['Datum','Auftrag','Kunde','Art','OriginalBetragCent','WirksamerBetragCent','WirksamerBetragEUR','Waehrung','Zahlungsweg','Belegreferenz','Status','Stornogrund'],work:['Mitarbeiter','Auftrag','BeginnUTC','EndeUTC','MillisekundenImMonat','Status'],employees:['Mitarbeiter','ErfassteMillisekunden','KorrekturMinuten','SaldoMillisekunden'],corrections:['Arbeitstag','Mitarbeiter','Auftrag','Minuten','Begruendung','ErfasstUTC'],jobs:['Auftrag','Mitarbeiter','PlanDatum','PlanUhrzeitDeutschland','Region','Status','Bericht']};
function cell(value){if(value&&typeof value==='object'&&Number.isSafeInteger(value.euroCents)){const n=Math.abs(value.euroCents);return '"'+(value.euroCents<0?'-':'')+Math.floor(n/100)+','+String(n%100).padStart(2,'0')+'"';}if(typeof value==='number')return String(value);let text=String(value??'');if(/^[\s\u200b\ufeff]*[=+\-@]/u.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
export function csvReport(report,type){
 let rows;
 if(type==='payments')rows=report.payments.map(p=>[p.payment_date,p.jobTitle,p.customer,p.kind,p.kind==='refund'?-p.amount_cents:p.amount_cents,p.voided_at?0:(p.kind==='refund'?-p.amount_cents:p.amount_cents),{euroCents:p.voided_at?0:(p.kind==='refund'?-p.amount_cents:p.amount_cents)},'EUR',p.method,p.reference,p.voided_at?'STORNIERT':'AKTIV',p.void_reason||'']);
 else if(type==='work')rows=report.intervals.map(i=>[i.employeeName,i.jobTitle,new Date(i.clippedStart).toISOString(),new Date(i.clippedEnd).toISOString(),i.milliseconds,i.open?'VORLAEUFIG':'BEENDET']);
 else if(type==='employees')rows=report.employees.map(e=>[e.name,e.loggedMilliseconds,e.correctionMinutes,e.correctedMilliseconds]);
 else if(type==='corrections')rows=report.corrections.map(c=>[c.effective_date,c.employeeName,c.jobTitle,c.minutes,c.reason,new Date(c.created_at).toISOString()]);
 else if(type==='jobs')rows=report.jobs.map(j=>[j.title,j.employeeName,j.scheduled_date,j.scheduled_time,j.region,j.state,j.report]);
 else throw new Error('Unknown CSV type');
 return '\ufeff'+[headers[type],...rows].map(row=>row.map(cell).join(';')).join('\r\n')+'\r\n';
}
export function parseEuro(value){
 if(typeof value!=='string'||!/^\d{1,7}([.,]\d{1,2})?$/.test(value.trim()))throw new Error('Betrag als positive Euro-Zahl mit maximal zwei Nachkommastellen eingeben.');
 const [whole,fraction='']=value.trim().replace(',','.').split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents<1||cents>100000000)throw new Error('Betrag muss zwischen 0,01 und 1.000.000,00 € liegen.');return cents;
}
