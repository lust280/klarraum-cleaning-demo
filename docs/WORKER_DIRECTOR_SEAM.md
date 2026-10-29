# Worker → Director seam

Cross-zone contract for the Director zone (Support / Companies). This file describes only what a Worker action makes observable. It is not an Admin billing, plan, or Connect contract.

Implemented by Worker PR #15 on branch `cursor/klarraum-worker-6778`.

Product status names below are the ones Support and Companies should use. The stored `jobs.state` value is in parentheses when it differs from the label.

## Lifecycle (Worker events Director/Support/Companies may observe)

Payment is never a job status. It is a separate field: Unpaid · Paid online · Paid on site · Refunded (`jobs.payment_status`: `unpaid` · `paid_online` · `paid_on_site` · `refunded`).

### Assigned → worker sees job

- Stored state: `assigned`.
- The assigned worker’s My jobs list includes the job (time, address, area, customer, notes). No price is included.
- Another worker does not see it.

### Start → In progress

- Worker Start moves `assigned` → `working`.
- Product label: **In progress**.
- Ops “Workers out” is the count of jobs in `working`. `GET /api/admin/inbox` returns that count as `workersOut`. It increments when a job starts and drops when the job leaves `working`.

### Finish / report → Done

- Worker Submit report moves `working` (or `paused`) → `submitted`.
- Product label for this handoff: **Done**. Owner acceptance later stores `closed`; that approval is not a Worker action.
- Partner Inbox event: kind `job_completed` (note text includes “report submitted”). Read it from `GET /api/admin/inbox` (`items[].kind`).
- Report may include:
  - photos, at most **6** for the job (before and after combined)
  - customer signature (`jobs.signature`, PNG data URL when present)
  - payment field **Paid on site** when the worker marks it (`payment_status` `paid_on_site`, `onsite_method` `cash` or `card`, `onsite_amount_cents`). This does not change the job status.

### Can't make it → Assigned → Accepted

- Allowed only while the job is still `assigned` (before Start).
- Stored transition: `assigned` → `accepted`.
- Product labels: **Assigned → Accepted**.
- The worker is removed from the job: it disappears from that worker’s list, and a later worker GET is 404. The job stays in the company database and is free to reassign (owner plan/edit accepts `accepted` and sets it back to `assigned` on the new worker).
- Partner Inbox event: kind `worker_unavailable` (skipped only if the worker turns off “Notify company”).
- `accepted` does not block the previous worker’s schedule.

### Cancel / reassign / edit (worker list)

- **Cancel** (`cancelled`): the job leaves the worker list. Worker GET is 404.
- **Reassign** to another employee: the previous worker loses the job (404); the new worker sees it.
- **Edit** while `assigned` or `accepted` (title, address, time, notes, checklist, and so on): the current assignee sees the update on refresh. A started job cannot be replanned this way.

## What Support / Companies views should show for the demo Linden job

Canonical demo job:

- **Address:** 12 Linden St, 10115 Berlin
- **Area:** 70 m²
- The Worker UI never shows the €154 quote. Worker job payloads have no price field and must not be scraped for a worker-facing price.
- Director Support / Companies must not invent worker-facing prices from Worker surfaces. Quote ownership is elsewhere. **The Worker seam exposes no price.**
- If the worker recorded an on-site collection, show it only as the payment field **Paid on site**, not as a job status and not as the quote.
- **Photos:** at most 6 per job, before and after combined.

## Explicit non-goals

- No Stripe.
- No Stripe Connect.
- No plan cards.
- No Admin billing, plan, or Connect contract. Admin owns that seam; this document does not restate it.

## Pointer

Worker PR #15, branch `cursor/klarraum-worker-6778`, implements the Worker app. This document is the cross-zone contract for Director.
