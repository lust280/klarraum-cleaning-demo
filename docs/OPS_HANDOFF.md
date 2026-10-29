# Ops handoff

Contract for Client, Worker, and Director. Ops owns job status. This file describes the current API in `lib/partner-ops.mjs` and the routes in `lib/team.mjs`. It does not add Director endpoints.

Page: `/ops.html`. All `/api/admin/ops/*` calls need an owner session. Writes also need `X-CSRF-Token` and an `Idempotency-Key` (UUID).

## Status strings

Main chain, in order:

| Step | API `status` |
| --- | --- |
| New | `new` |
| Accepted | `accepted` |
| Assigned | `assigned` |
| In progress | `in_progress` |
| Done | `done` |

Side paths:

| Path | API `status` | When |
| --- | --- | --- |
| Decline | `declined` | From `new` or `accepted` only. Not after a worker is assigned. |
| Cancel | `cancelled` | Before `done`. Hidden from the worker job list. |

`chain` on each job is `["new","accepted","assigned","in_progress","done"]`. `step` is the index of `status` in that list (`-1` for `declined` and `cancelled`).

Allowed moves:

- `new` → `accepted` (`POST .../accept`) or `declined` (`POST .../decline`)
- `accepted` → `assigned` (`POST .../assign` with exactly one `employeeId`) or `declined`
- `assigned` → `in_progress` (`POST .../start`) or another single worker (`POST .../assign` replaces the previous one)
- `in_progress` → `done` (`POST .../done`)
- `new`, `accepted`, `assigned`, or `in_progress` → `cancelled` (`POST .../cancel`)

Assign from `new` is rejected. `employeeIds` or an array of workers is rejected. A second assign replaces the only worker.

## Job object

List and detail items share these fields:

`id`, `ref`, `status`, `service` (`home` | `office` | `deep`), `serviceTitle`, `areaM2`, `priceCents`, `rateCents`, `currency`, `address`, `customer`, `phone`, `email`, `notes`, `date` (`YYYY-MM-DD`), `time` (`HH:MM`, 24-hour), `dateLabel` (for example `2 Nov`), `plannedMinutes`, `worker` (`{id, name}` or `null`; detail also adds `availability`), `version`, `jobId` (worker job id after assign, else `null`), `photoLimit` (`6`), `photos`, `report` (only when `done`), `declineReason`, `declineMessage`, `chain`, `step`.

Detail also returns `workers`: `{id, name, availability}` where `availability` is only `free` or `busy`. No distance, travel time, or GPS fields.

`report` when `done`: `note`, `signature`, `signedBy`, `signedAt`, `onsiteMethod` (`cash` or `card` when the worker recorded pay on site), `tipCents`, `startedAt`, `endedAt`, `durationLabel`, `photoCount`.

Decline `reason` values: `fully_booked`, `outside_area`, `other`, or `""`.

## Endpoints

| Method | Path | Purpose | Key request / response |
| --- | --- | --- | --- |
| GET | `/api/admin/ops/today` | Today board | Response: `date`, `label`, `currency`, `photoLimit`, `counts.newRequests`, `counts.jobsToday`, `counts.workersOut`, `attention` (status `new`), `jobs` (scheduled today, not cancelled), `workersOut` (`name`, `summary`) |
| GET | `/api/admin/ops/jobs` | Jobs feed | Query: `status` (one status string or empty), `range` (`today`, `week`, `month`, or empty). `today` also includes every `new` request. Response: `items`, `total`, `currency`, `photoLimit`, `statuses` |
| POST | `/api/admin/ops/jobs` | New job | Body: `service`, `areaM2` (integer 20–1000), `date`, `time`, `address`, `customer`, `phone`, `notes`, `employeeId` (`null` or one worker id). Unassigned jobs start as `accepted`. With one worker they are `assigned`. Price is `areaM2 * rateCents` |
| GET | `/api/admin/ops/jobs/:id` | Job card and assign list | Response: job object plus `workers` |
| PUT | `/api/admin/ops/jobs/:id` | Edit job | Same body as create, plus `version`. Rejected for `declined`, `cancelled`, `done`, and `in_progress` |
| POST | `/api/admin/ops/jobs/:id/accept` | New → Accepted | Body: `version`. Response includes `emailQueued` when a customer email exists |
| POST | `/api/admin/ops/jobs/:id/decline` | Decline incoming request | Body: `version`, `reason`, `message`. Sets `declined` |
| POST | `/api/admin/ops/jobs/:id/assign` | One worker | Body: `version`, `employeeId`. Response adds `scheduleWarnings` when that worker is busy. Busy does not block assign |
| POST | `/api/admin/ops/jobs/:id/start` | Assigned → In progress | Body: `version`. Opens the worker timer |
| POST | `/api/admin/ops/jobs/:id/done` | In progress → Done | Body: `version`. Closes the checklist and stores the report note |
| POST | `/api/admin/ops/jobs/:id/cancel` | Cancel | Body: `version`, `notifyCustomer` (default true) |
| POST | `/api/admin/ops/jobs/:id/report/send` | Queue the report email | Body: `{}`. No card charge |
| GET | `/api/admin/ops/jobs/:id/report.pdf` | Plain-text PDF download | `application/pdf` |
| GET | `/api/admin/ops/availability` | Free/Busy for a slot | Query: `date`, `time`, `minutes` (default 120), `exclude` (worker job id). Response: `workers` with `availability` `free` or `busy` |

## Worker seam

After Assign, `jobId` is the id on the existing worker API. `GET /api/employee/jobs` for that worker includes the job. Reassign removes it from the previous worker. `cancelled` jobs are omitted from that list. The worker payload does not include Ops price fields. Photos are uploaded on `POST /api/employee/jobs/:jobId/photos` and stop at 6.

## Client seam

`POST /api/inquiries` (and the same retry by idempotency key) copies the saved inquiry into Ops as `status: "new"`. `areaM2` is the inquiry area. `priceCents` is the quoted total in cents (`Math.round(price * 100)`). Company currency is returned as `currency` (demo market EUR). The visit date and 24-hour time come from the inquiry, or today at `09:00` when the customer left them blank.

## Director seam

Director does not own these transitions. Ops does. A later Director screen may show company-level Attention or Support on its own. This contract does not define Director APIs. The manual AI OFF shell review list is [DIRECTOR_SHELL_CHECKLIST.md](DIRECTOR_SHELL_CHECKLIST.md) (review aid only; Pass/Fail stays empty until the Director shell team fills it). Connect and SaaS payment panels are Partner Admin and Director read-only views, not Ops. Ops does not start Stripe Checkout and does not take a card payment.

## Locks

- Exactly one worker per job.
- Availability is Free/Busy only.
- At most 6 photos per job.
- No live Stripe.
