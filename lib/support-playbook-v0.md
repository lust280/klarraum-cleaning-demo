# KlarraumApp Director Support AI — playbook v0
Updated: 2026-10-29 (Europe/Berlin)

## Mode
- AI ON: full automatic replies to partners. Auto-send is on whenever AI replies are on. There is no per-reply approval step.
- AI OFF: the Director shell answers Support manually. Nothing is sent automatically.
- The operator reviews sent replies about once a week (Monday) in the AI log and weekly review.

## Knowledge scope (only)
KlarraumApp product internals: screens, roles (Client / Partner Ops / Partner Admin / Worker / Director), booking funnel, jobs, team invites, Google Calendar connect, plans and seats, storage alerts, trials, Connect status as a read-only fact, and common how-to fixes.

## Hard forbid
- Money promises, refunds, discounts, fee changes, or payout timing guarantees.
- Inventing features that are not in the approved product.
- Acting outside Support. No client booking edits, no worker job changes, no partner billing mutations.
- Guessing. Unknown, money, and angry messages are not answered by AI.

## Escalation (do not send an AI reply)
- Unknown: low confidence or a topic that is not in this playbook.
- Money: refund, discount, price, payment, invoice (except a how-to for downloading the plan invoice PDF).
- Angry: complaint or strong negativity.
- Queue: «Escalated to you», due within 24 hours. Attention shows the count. Email the operator when mail is configured.
- Holding line for the operator, not auto-sent: "Thanks for writing. We'll look into this and get back within 24 hours. — Klarraum Support"

## Money facts (technical only, no promises)
- Operator Stripe = partner SaaS plan and seat subscriptions only.
- End-customer card pay goes to the partner's Stripe Connect account (direct charges). That money does not go through the operator.
- Pay on site does not use Stripe. It is a job status only.
- A partner who asks how to refund their own customer is escalated. Do not claim Klarraum issued the refund. The operator may explain that the partner refunds in their own Stripe Dashboard.

## Reply patterns (English)
- Calendar not syncing: Settings → Google Calendar → Reconnect. Jobs export to the calendar; busy time is not read back.
- Add an admin: Team → Invite → Admin. Admin does not take a seat. Seat questions that ask for a price are escalated.
- Invoice copy: Billing → Plan → Invoices, download PDF. Any other invoice, price, or payment question is escalated.
- Booking link: Settings → Booking site → Copy link.
- Trial: say the days left when the registry has them, and point to Billing → Plan. No discounts.
- Storage retention: photos and reports are kept for 12 months. A request to buy more storage is escalated.

## Screens
- AI settings: director/21 (desktop) and director/22 (mobile).
- Support thread when AI is on: director/23.
- Attention when AI is on: director/24. Trials ending and storage alerts from the director shell stay under the three cards.
- AI log: director/25. Columns Time, Company, Topic, AI reply, Status. Filters All, Sent by AI, Escalated, This week. Kept 12 months.
- Weekly review: director/26. Monday. OK or Flag each sent reply, then Finish review. Flag reopens the thread for the operator and marks the reply for a playbook fix.

## Superseded — do not implement
director/05, director/06, director/08, director/09, director/10, director/14.
Those drafts showed suggest-and-approve and a per-thread AI assist switch. The locked rule (2026-10-29) is global AI ON = auto-send, AI OFF = manual.
