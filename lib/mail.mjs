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
