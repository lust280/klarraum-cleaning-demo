function mailConfigError() {
  const error=new Error('Inquiry mail is not configured. Set PLATFORM_RESEND_API_KEY (or RESEND_API_KEY), PLATFORM_MAIL_FROM (or MAIL_FROM), and the company contact email.');
  error.code='mail_not_configured';
  return error;
}
export function assertMailConfig(mail) {
  if(!mail?.key||!mail?.from||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.to||'')) throw mailConfigError();
  if(mail.transport==='disabled') throw mailConfigError();
}

export async function sendNotification(mail, inquiry, origin, fetcher = fetch) {
  assertMailConfig(mail);
  // Contact data stays in the authenticated dashboard, not in email notifications.
  const response = await fetcher('https://api.resend.com/emails', {
    method:'POST',
    headers:{Authorization:`Bearer ${mail.key}`, 'Content-Type':'application/json', 'Idempotency-Key':`inquiry-${inquiry.id}`},
    signal:AbortSignal.timeout(10000),
    body:JSON.stringify({from:mail.from,to:[mail.to],subject:`Neue Reinigungsanfrage · ${inquiry.id.slice(0,8)}`,
      text:`Eine neue Anfrage wurde sicher gespeichert.\n\nAnfragenummer: ${inquiry.id}\nBitte melden Sie sich im geschützten Kundenbereich an:\n${origin}/admin.html\n\nDiese Nachricht ist eine Benachrichtigung, keine Buchungsbestätigung.`}),
  });
  if (!response.ok) throw new Error('Notification delivery failed.');
}

export async function sendInquiryReceipt(mail, inquiry, companyName, origin, fetcher=fetch) {
  assertMailConfig(mail);
  if(!inquiry?.email) return;
  const name=typeof inquiry.name==='string'&&inquiry.name.trim()?inquiry.name.trim():'there';
  const company=companyName||'The cleaning company';
  const response=await fetcher('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:`Bearer ${mail.key}`,'Content-Type':'application/json','Idempotency-Key':`inquiry-receipt-${inquiry.id}`},
    signal:AbortSignal.timeout(10000),
    body:JSON.stringify({from:mail.from,to:[inquiry.email],subject:`We received your cleaning request · ${inquiry.id.slice(0,8)}`,text:`Hello ${name},\n\n${company} received your cleaning request.\n\nReference: ${inquiry.id}\nThis is not a confirmed appointment. The company will contact you about the date and price.\n\nRequest page: ${origin}/`}),
  });
  if(!response.ok) throw new Error('Inquiry receipt delivery failed.');
}

export async function sendAppointmentReminder(mail, message, companyName, origin, fetcher=fetch) {
  assertMailConfig(mail);
  if(!message?.email) return;
  const company=companyName||'Your cleaning company';
  const when=message.whenLabel||'the scheduled time';
  const response=await fetcher('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:`Bearer ${mail.key}`,'Content-Type':'application/json','Idempotency-Key':`customer-reminder-${message.id}`},
    signal:AbortSignal.timeout(10000),
    body:JSON.stringify({from:mail.from,to:[message.email],subject:`Reminder: upcoming cleaning · ${String(message.jobId||message.id).slice(0,8)}`,text:`Hello,\n\n${company} has a cleaning appointment scheduled for ${when}.\n\nReference: ${message.jobId||message.id}\nThis reminder is not a new booking. The street address stays in the company workspace.\n\n${origin}/`}),
  });
  if(!response.ok) throw new Error('Appointment reminder delivery failed.');
}

export async function sendOpsCustomerMessage(mail,message,fetcher=fetch){
 assertMailConfig(mail);
 if(!message?.email||!message.text)return;
 if(/checkout\.stripe\.com|sk_live|pk_live/i.test(message.text+message.subject))throw new Error('Ops mail cannot start a card payment.');
 const response=await fetcher('https://api.resend.com/emails',{
  method:'POST',headers:{Authorization:`Bearer ${mail.key}`,'Content-Type':'application/json','Idempotency-Key':`ops-${message.id}`},
  signal:AbortSignal.timeout(10000),
  body:JSON.stringify({from:mail.from,to:[message.email],subject:message.subject||'KlarraumApp update',text:message.text}),
 });
 if(!response.ok)throw new Error('Customer message delivery failed.');
}

export async function sendEmployeeNotification(mail,to,notification,origin,fetcher=fetch){
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw new Error('Invalid notification recipient.');
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${mail.key}`,'Content-Type':'application/json','Idempotency-Key':'employee-'+notification.id},body:JSON.stringify({from:mail.from,to:[to],subject:notification.kind==='reminder'?'Erinnerung an Ihren Einsatz':'Neue Nachricht zu Ihrem Einsatz',text:`Bitte prüfen Sie Ihre Einsätze im geschützten Mitarbeiterbereich:\n${origin}/employee.html\n\nAuftragsnummer: ${notification.job_id}\nAdressen und Kundendaten stehen ausschließlich im angemeldeten Bereich.`})});
 if(!response.ok)throw new Error('Employee notification delivery failed.');
}
