# Partner Admin → Client seam

Booking-mode, trial, and price contract for the Client funnel. This file is the seam only. Client must not edit the `klarraum/partner-admin` branch.

Read the **effective** mode from `bookingMode`. Do not drive the client UX from `storedBookingMode`.

## Where to read

`GET /api/partner/booking-mode`, or the `partnerBooking` object on `GET /api/config`.

Use these fields:

- `bookingMode` — what the client should do (`paused` | `request` | `instant`).
- `storedBookingMode` — what the company saved. Keep it for display or debugging only. Do not use it to choose the client screen.
- `trialPaused` — true when a finished trial forced the public mode to paused.
- `currency`, `areaUnit` (`m2` or `sqft`).
- `cardPayments` — card pay is available only when Connect is on and booking is not paused.
- `prices.home`, `prices.office`, `prices.deep` (rate per m²), optional `prices.minimum`, optional `prices.maxAreaM2`.
- `demoJob` — `12 Linden St, 10115 Berlin`, 70 m², €2.20/m², quote €154.00.

Quote formula: `quote = max(rate × area, minimum)`. An empty minimum means no floor. Helpers live in `lib/partner-admin.mjs` (`quoteEuros`). There is no live Stripe call on this branch.

## bookingMode → client screen

| `bookingMode` | Client result |
|---|---|
| `paused` | Booking paused (07 / D19). No request is created. |
| `request` (default) | New request, Unpaid. No card is taken at booking (A2). Final screen 04 / D14. |
| `instant`, Pay on site (or Connect off) | Accepted, Unpaid. Final screen 15 / D21. |
| `instant`, card, and `cardPayments` is on | Accepted, Paid online. Final screen 08 / D15. |

Card is offered only when `bookingMode` is `instant` and `cardPayments` is true. In `request`, the client does not enter a card.

## Finished trial

When the partner trial has ended, `bookingMode` is `paused` even if `storedBookingMode` is `request` or `instant`. Show Booking paused (07 / D19). Do not create a request. Do not write the stored mode back.

## Out of scope

Jobs, Today, Assign, and Inbox are Partner Ops. Do not change Partner Admin code from the Client branch. Consume this contract only.
