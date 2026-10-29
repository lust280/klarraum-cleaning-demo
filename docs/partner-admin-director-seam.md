# Partner Admin → Director seam

Contract for the Director wave. Source of truth for partner plan, trial, seats, and Connect labels is this branch (`klarraum/partner-admin`), not the older catalogue in `lib/plans.mjs`. That file still feeds the current director console and must not be treated as the partner self-serve tariff.

Partner Admin does not own Jobs, Today, Assign, or Inbox. Those are Partner Ops. This document does not assign them to Admin.

## 1. Contract Admin → Director

Director reads these values. Do not hardcode a conflicting price, seat count, or trial length.

### Plans

EUR, DE pilot. Prices are monthly. Seats are Cleaner + Helper only.

| Plan | Price | Seats |
|---|---|---|
| Starter | €49/mo | 2 |
| Pro | €89/mo | 5 |
| Plus | €149/mo | 10 |

Demo company on this branch: Linden Cleaning, Pro, Europe/Berlin, EUR, m².

### Trial

- Trial is **5 days on Pro**. No card at the start.
- When the trial has ended, the partner app is read-only except Billing, Help, and Export.
- Public booking then reports `bookingMode = paused`. The company’s saved mode is left as-is (`storedBookingMode` stays `paused`, `request`, or `instant`). `trialPaused` is true when those two differ.

### Admin role and seats

- An Admin does **not** consume a seat. Seats = active Cleaner + Helper only (pending invites of those roles count; expired, declined, and revoked do not).
- Admins are not capped by the plan.
- The owner is the first Admin (the person who registered the company). Only the owner changes the plan or Connect. Other Admins can open Plan and Connect and see them read-only.
- Cleaner and Helper have the same rights; the role is a label.

### Connect and subscription labels

Partner customer-payment screens are stubs. Nothing calls Stripe. Money for customer card payments is a future direct charge on the company’s own Express account, not a charge through the operator.

Labels Director should show (Admin side is still stubs; nothing calls Stripe):

| Label | Meaning |
|---|---|
| **Not connected** | Partner Connect state `disconnected`. |
| **Connected** | Partner Connect state `connected`. |
| **Error/unfinished** | Partner Connect state `incomplete` (setup stopped or failed). |
| **Past due** | KlarraumApp SaaS subscription is past due. Not a partner Connect screen. Director companies list may show it. |
| **Disconnect confirm** | Confirmation only. Cancelling it leaves the account Connected. |

Customer card money is a future direct charge on the company’s own Express account, not a charge through the operator.

### Public APIs already on this branch

Other zones call these. They do not perform a live Stripe charge.

`GET /api/partner/booking-mode` and the `partnerBooking` object on `GET /api/config` return:

- `bookingMode` — what the client should experience (forced to `paused` while the trial is over).
- `storedBookingMode` — what the company saved (`paused` | `request` | `instant`).
- `trialPaused` — true when the public mode was forced to paused.
- `currency`, `areaUnit` (`m2` or `sqft`).
- `cardPayments` — card payments are offered only when Connect is on and booking is not paused.
- `connectOn` — true only when Connect status is `connected`.
- `company` — public name, phone, email.
- `prices` — `home`, `office`, `deep` (EUR per m²), optional `minimum`, optional `maxAreaM2`, `speedM2PerHour`.
- `demoJob` — `12 Linden St, 10115 Berlin`, 70 m², €2.20/m², quote €154.00.

Pure helpers in `lib/partner-admin.mjs` (no network, no Stripe):

- `quoteEuros({rate, area, minimum})` — `max(rate × area, minimum)`. Empty minimum means no floor. Demo: 70 × 2.20 = 154.
- `jobDurationMinutes(areaM2, speedM2PerHour)` — duration rounded **up** to 30 minutes. Default speed 30 m²/h. Demo 70 m² → 150 minutes. The slot engine itself stays Partner Ops.
- `seatsUsed(team)` — Cleaner + Helper only.
- `classifyRefund({payment, actor, hoursUntilVisit, choice, hoursSinceAsk, started})` — Paid online and more than 24 h before the visit, or a partner cancel/decline, becomes `Refunded`. At or under 24 h the partner chooses Refund or Keep; no answer for 48 h means Keep. Unpaid and Paid on site are not refunded. This function does not call Stripe.

## 2. Checklist for Director: HIDE vs READ

### Hide

Do not show these as partner-facing Admin UI:

- AI log, weekly review, and AI-assist toggles inside Partner Settings.
- Any new “AI” tab on the partner shell.

Partner Help is only the company-side thread with the operator. An AI reply in that thread belongs to the Director AI wave, not to this Admin surface. Do not invent AI tabs inside Partner Admin.

### Read

Read from the partner APIs and this contract. Do not hardcode a conflicting tariff (no Team $89, no Plus $259, no 14-day or 15-day trial, no extra seat fees):

- Plan name, monthly EUR price, and included seats.
- Trial length: 5 days on Pro, no card at the start.
- Seat usage excluding Admins.
- Connect / subscription labels: Not connected, Connected, Error/unfinished, Past due, Disconnect confirm.
- `bookingMode` / `storedBookingMode` when a company detail screen shows how clients book.

## 3. Out of scope for Partner Admin

Jobs, Today, Assign, and Inbox are Partner Ops. Do not treat them as Admin ownership, and do not route Director company tools at those screens through this seam.
