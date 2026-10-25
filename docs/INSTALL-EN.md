# Klarraum 2.1 — installation and handover

One installation serves one company. This is a Node.js application, not a WordPress theme or a PHP script. The public demo uses fictional data and temporary storage. Buying source code does not provide a hosting subscription or legal compliance.

## Requirements

- Node.js 24.13 or newer, preferably the pinned `.node-version`, npm, a persistent writable data directory, and HTTPS for a public deployment.
- Linux/macOS with `tar` for building the source release; Docker is an alternative runtime, not a free hosted service.
- A verified Resend sender and API key for inquiry notifications. Staff emails are optional; the authenticated employee inbox works without email.
- Sufficient storage for SQLite and both public/private image folders. Each job supports up to four proof images. Size hosting for actual use; no nationwide capacity or automatic failover is promised.

## New installation

1. Extract the release archive into a private application directory.
2. Run `npm ci --ignore-scripts --omit=dev` there.
3. Run `npm run setup`. Enter the public HTTPS origin without a trailing slash, then choose and repeat your own owner password (14–256 characters). Password entry is hidden; a distinct application secret and password hash are saved to `.env.local` with restrictive permissions. An existing file is never overwritten.
4. Choose fictional demo mode for evaluation. Choose private mode only after arranging storage, access, business information and data-handling policies. Public inquiries remain disabled in both cases until configured.
5. Run `npm run start:local`. Despite the command name, it simply loads `.env.local`; for public use configure a reverse proxy, HTTPS and a supervised service. Node listens on `PORT` (default 3000). Do not expose an unprotected raw port as a substitute for HTTPS.
6. Open `/admin.html` and log in using the password you chose. Check `/system.html`, then test a complete fictional workflow before accepting real records.

Local evaluation may use `http://localhost:3000`. Do not use HTTP origins for a public site. Startup configuration is intentionally not managed by an unauthenticated setup web page.

On Render the provided free Blueprint generates credentials in the hosting environment. It is a demo, not durable company hosting. Do not run the local setup wizard to overwrite an existing Render installation; use the host's secure environment settings. No Render API key is required for direct GitHub deployment.

## Docker option

After generating `.env.local`, run `docker compose up -d --build`. Compose binds the HTTP port to loopback only; your HTTPS reverse proxy connects there. The named `company_data` volume is preserved on container recreation. **Do not use `docker compose down -v`** unless intentionally deleting that company's data. Run backups inside the container with `docker compose exec -T web npm run backup`, then transfer complete backup/photo sets to protected off-site storage. An automatically restarted container is not a second standby server or a high-availability guarantee.

## Configuration and real operation

Use `.env.example` as a field reference. Keep keys and passwords out of Git, chat, screenshots and website content. Never commit `.env.local`.

- Set `DATA_DIR` to durable protected storage. Restart and redeploy; verify old records and images still exist. Only then attest `PERSISTENT_STORAGE_CONFIRMED=true`. This flag records the operator's confirmation, not independent evidence.
- Configure the business identity, price/tax explanation, service postcodes, privacy details and legal review fields described in DEPLOYMENT.md.
- Configure `RESEND_API_KEY`, `MAIL_FROM` (verified sender), and `MAIL_TO` (owner). A test accepted by a mock provider does not prove delivery. Send and receive one actual operational test after authorization, checking spam and failure handling.
- For staff email set `EMPLOYEE_EMAIL_NOTIFICATIONS=true` after agreeing recipients and the operational process. Emails contain a job ID and login link, not customer addresses. Notifications are queued and checked approximately once per minute while the server is running, with up to five attempts. The staff inbox does not require this switch.
- `DEMO_ONLY=true` forbids real inquiry collection and real staff emails. For live inquiries, set `DEMO_ONLY=false` and `ENABLE_INQUIRIES=true` only after all required live settings pass validation.
- Confirm staff/customer/financial retention and deletion procedures separately. The inquiry retention timer does not implement a personnel or accounting retention policy.

## Interface language

Use the English/Deutsch header button to switch controls; the preference stays in your browser. Unsaved form input is confirmed before reload. The switch does not translate company copy, customer names, addresses, work instructions or legal documents, and does not change stored records. EUR/German number formatting, Europe/Berlin scheduling and export conventions remain as documented. Unmapped validation messages retain their original German wording.

## Daily workflow

1. Owner: edit brand, photos, contacts and prices in the website editor.
2. Planning: create a customer and one or more properties. Do not put passwords, alarm codes or key codes in notes.
3. Team: create employees, privately share the single-use invitation link (48 hours), and assign a property and task. Employees choose their own passwords.
4. Choose a single visit or a finite weekly, fortnightly or monthly series with an explicit last date (up to one year / 120 visits). Monthly dates clamp to the month's last day and retain the original anchor for later months.
5. Review schedule-overlap warnings. Travel time is not added. Daylight-saving gaps/ambiguous times are rejected instead of silently moved. All scheduled wall times refer to Germany.
6. Edit/reassign an individual occurrence only before work starts. Cancel a single visit with a reason; future-series cancellation affects only untouched assigned visits. For a different future rhythm cancel those visits and create a replacement series. Work already recorded is retained.
7. Employees start, pause, resume, submit a checklist/report and optionally private photos. The owner approves or returns the work. This is task time, not complete statutory working-time or payroll recording.
8. Record actual receipts/refunds separately. Generate a monthly snapshot and export CSV/JSON or print to PDF. A finished task does not automatically count as payment. These reports are not invoices or a certified accounting archive.

## Backup and recovery

Run `npm run backup` with the correct `DATA_DIR`. The default backup directory is `DATA_DIR/backups`; `BACKUP_DIR` may point elsewhere. Schedule it using the operator's service/cron and transfer protected copies off the server. A local copy on the same disk is insufficient.

Keep each `.sqlite`, `.sqlite.media` and `.sqlite.jobs` set together. Never back up only the database and forget images.

To restore into a NEW, EMPTY directory:

```sh
node scripts/restore.mjs --source /protected-backups/klarraum-TIMESTAMP.sqlite --target /srv/klarraum-recovered-data
```

The tool validates database integrity and copies the referenced public/private image files. It refuses nonempty destinations and leaves the original installation unchanged. Stop the service, switch `DATA_DIR` to the recovered directory, rotate `APP_SECRET` to revoke sessions, restart and verify before reopening. Do not run two instances against the same SQLite data folder.

## Updating

1. Read CHANGELOG.md and the supported runtime version. Test the release against a restored copy first.
2. Stop the application. Make a complete backup; preserve `.env.local` outside the release directory.
3. Extract the new source into a separate application directory, install its lockfile, and point it to the same private configuration and persistent `DATA_DIR`.
4. Start once and verify the old inquiries, staff, jobs, series, monthly snapshots and photos. New planning tables/columns are added without recreating existing data.
5. If rollback is needed, stop the new process and restore the matched database/photo backup into a new directory with the matching old code. Do not assume older code can reverse a newer migration.

For a lost owner password, a trusted operator uses `npm run admin:hash`, replaces `ADMIN_PASSWORD_HASH` in private settings, removes any obsolete plaintext `ADMIN_PASSWORD`, rotates `APP_SECRET` and restarts. There is no public reset endpoint. Staff access can be reset from the owner dashboard; that invalidates previous access.

## Support and honest scope

Source-license, installation and ongoing service are separate products. Agree the seller identity, price/tax treatment, allowed installations, response times, update term, backup operator and account ownership before ordering. Draft terms in LICENSE.txt require review; they are not a signed contract.

No online payment processing, native mobile app, offline synchronization, GPS proof, customer signature, payroll, tax calculation, automatic booking-capacity guarantee or shared multi-company SaaS is included. Public marketing content and legal text need company-specific editing. Do not advertise a feature as live just because its configuration field exists.
