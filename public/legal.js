const $=s=>document.querySelector(s);
if(!location.hostname.endsWith('.github.io')){
 try{
  const response=await fetch(new URL('api/config',location.href),{credentials:'same-origin'});
  if(!response.ok)throw Error();const data=await response.json();
  if(data.legalReady){
   $('#legal-demo').hidden=true;
   $('#business-details').textContent=[data.business.name,data.business.owner,data.business.address,`Email: ${data.business.email}`,data.business.phone?`Phone: ${data.business.phone}`:'',data.business.additionalLegal].filter(Boolean).join('\n');
   const processing=$('#processing-details');
   if(processing)processing.textContent=`Controller: ${data.business.owner}, ${data.business.address}. Contact: ${data.business.email}.\n\n${data.business.privacyDetails}\n\nInquiries are automatically deleted from the active database after ${data.retentionDays} days. The operator must specify any different statutory retention duties and backup retention in the text above.`;
  }
 }catch{/* Preserve explicit demo notice on unavailable backend. */}
}
