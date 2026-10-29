# SPECIALIST_READY

Updated 29 Oct 2026. Locks below are the handoff rules for tests. A zone is READY only when its row says yes.

## Locks

1. Status chain: New → Accepted → Assigned → In progress → Done. Incoming requests can be Declined. Jobs can be Cancelled where the screen offers it.
2. Exactly one worker per job.
3. Assign shows Free or Busy. No distance in km, no travel time, no GPS collection.
4. At most 6 photos per job.
5. Demo market for Ops: EUR, m², Berlin-style addresses and phones, English UI, 24-hour time, dates like "28 May".
6. No live Stripe. No Stripe Checkout and no live secret keys in this zone.

## Zones

| Zone | READY | Notes |
| --- | --- | --- |
| Partner Ops | yes | Today, Jobs, job card, live status map, Accept/Decline, Assign, Start, Done, New/Edit, cancel, report view, photos, empty states. API: `/api/admin/ops/*`. Page: `/ops.html`. |
| Partner Admin | no | Team, Settings, Billing, Plan, Stripe Connect stay out of this branch. |
| Client | no | A saved inquiry is copied into Jobs as New. Booking UI is unchanged here. |
| Worker | no | An assigned job is returned by the existing worker job list. Worker screens are unchanged here. |
| Director / Director AI | no | Not this branch. |

## Ops handoff checks

- Client `POST /api/inquiries` creates a Jobs row with status `new`, the quoted EUR cents, and m².
- Accept, then assign exactly one active worker. A second assign replaces that worker.
- `employeeIds` or a list of workers is rejected.
- Availability values are only `free` or `busy`.
- Worker `GET /api/employee/jobs` contains the assigned job and hides a cancelled one.
- The seventh photo upload is rejected.
