const $=s=>document.querySelector(s);
if(!location.hostname.endsWith('.github.io')){
 try{
  const response=await fetch(new URL('api/config',location.href),{credentials:'same-origin'});
  if(!response.ok)throw Error();const data=await response.json();
  if(data.legalReady){
   $('#legal-demo').hidden=true;
   $('#business-details').textContent=[data.business.name,data.business.owner,data.business.address,`E-Mail: ${data.business.email}`,data.business.phone?`Telefon: ${data.business.phone}`:'',data.business.additionalLegal].filter(Boolean).join('\n');
   const processing=$('#processing-details');
   if(processing)processing.textContent=`Verantwortlich: ${data.business.owner}, ${data.business.address}. Kontakt: ${data.business.email}.\n\n${data.business.privacyDetails}\n\nAnfragen werden in der aktiven Datenbank nach ${data.retentionDays} Tagen automatisch gelöscht. Abweichende gesetzliche Aufbewahrungspflichten und die Aufbewahrung von Sicherungen sind vom Betreiber im obigen Text zu konkretisieren.`;
  }
 }catch{/* Preserve explicit demo notice on unavailable backend. */}
}
