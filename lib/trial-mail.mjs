export async function sendTrialVerification(mail,{to,companyName,url},fetcher=fetch){
 if(!mail?.key||!mail?.from)throw new Error('Trial email delivery is not configured.');
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${mail.key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({from:mail.from,to:[to],subject:'Confirm your Klarraum trial',text:`Hello,\n\nConfirm the email address for ${companyName} and start the 15-day Klarraum trial:\n${url}\n\nThis link is private, can be used once, and expires in 48 hours. If you did not request it, you can ignore this email.`})});
 if(!response.ok)throw new Error('Trial verification delivery failed.');
}
