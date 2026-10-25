export async function sendNotification(mail, inquiry, origin, fetcher = fetch) {
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

export async function sendEmployeeNotification(mail,to,notification,origin,fetcher=fetch){
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw new Error('Invalid notification recipient.');
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${mail.key}`,'Content-Type':'application/json','Idempotency-Key':'employee-'+notification.id},body:JSON.stringify({from:mail.from,to:[to],subject:notification.kind==='reminder'?'Erinnerung an Ihren Einsatz':'Neue Nachricht zu Ihrem Einsatz',text:`Bitte prüfen Sie Ihre Einsätze im geschützten Mitarbeiterbereich:\n${origin}/employee.html\n\nAuftragsnummer: ${notification.job_id}\nAdressen und Kundendaten stehen ausschließlich im angemeldeten Bereich.`})});
 if(!response.ok)throw new Error('Employee notification delivery failed.');
}
