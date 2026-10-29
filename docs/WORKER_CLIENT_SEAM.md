# Client → Worker seam

Booking-mode contract only: when a client booking becomes visible on Worker My jobs. This file does not own Client screens, Client APIs, or Client email copy.

Worker implementation: PR #15, branch `cursor/klarraum-worker-6778`.

## What the worker list shows

For that worker only, after the job is **Assigned**:

- **Assigned** (`assigned`)
- **In progress** (`working`) — worker has started it
- **Done** — worker has submitted the report (`submitted`); owner acceptance later stores `closed`

The worker does not see **New request**, and does not see a job that is not yet **Assigned**. The list has no price.

Demo Linden job on Worker, once assigned: **12 Linden St, 10115 Berlin · 70 m²**. No price. The €154 quote is not on any Worker surface.

Payment stays a separate field (Unpaid · Paid online · Paid on site · Refunded). **Paid on site** is not a job status. Photos are at most 6 per job (before and after combined).

## Instant (charge now)

There is **no partner Accept step**. The confirmed Instant booking goes straight into Ops.

The worker sees the job **only after Assign**. Do not describe this as “Instant after Accept”.

## Request (hold 24h)

The worker job exists only after the partner **Accept + Assign**. A request that is still waiting does not appear on Worker My jobs.

## Decline

**Decline** always refunds. It does **not** create a Worker job.

## Explicit non-goals

- Do not edit Client files for this seam.
- No Stripe and no Stripe Connect.
- Client email copy is owned by Client, not by Worker.
