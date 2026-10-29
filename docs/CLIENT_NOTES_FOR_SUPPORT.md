# Client booking notes for Director Support

These notes are about the **public client funnel** (quote → contacts → pay or request → finale). They are not Partner Ops job notes. Assign, start, and finish stay on the Ops job board. A partner writing to Support about a customer booking is describing this funnel.

Effective `bookingMode` decides the screen (`paused`, `request`, or `instant`). The stored setting is not what the customer sees when a trial has ended.

## Refund timing

Client cancel is available until the visit is In progress.

- **More than 24 hours** before the appointment, and the customer paid online: the client path is auto-eligible. This demo marks payment `Refunded`. No live Stripe refund is sent.
- **24 hours or less** before the appointment, and the customer paid online: the company decides. Support (or the partner) chooses. The customer sees “Refund is decided by the company.” That decision is not an Ops job-board action.
- Unpaid, or pay on site: cancel only. There is nothing to refund.

## Request mode, Unpaid

Request mode does not take a card at booking. The customer ends on **Request sent**, status **New request**, payment **Unpaid**. The company still has to accept.

A partner asking about an unpaid Request is asking about that client status. It is not a request to assign a worker.

## Instant and the card stub

Instant booking offers **Pay on site**. The card button appears only when `cardPayments` is true (Connect card payments on, and the effective mode is not paused).

Card pay is still a stub. There is no live Stripe Checkout and no charge. A decline stays on **Payment failed**; the customer can try again or choose Pay on site.

If a partner says the card failed or the card path is stuck, check Connect and `cardPayments`. **Pay blocked** (“Online card pay unavailable”) is only for a customer who was already on the card path when card pay turned off. With card pay off from the start, the card button is simply absent.

## Paused

Effective `bookingMode` **paused**, including a trial that has ended, shows **Booking paused**. No new request is created. Support should not invent a booking while the site is paused. The customer is told to contact the company.
