# Server deployment

## Current state

The app has been tested locally with SQLite and simulated mail delivery. The GitHub Pages preview is static. A live backend, verified sending domain, provider account and real operator details are external prerequisites, not completed setup.

## Suggested host: Render, Frankfurt

Account: https://dashboard.render.com/register . This is one option; the app also runs on a suitable EU VPS or other Node.js host with persistent storage.

**Persistent Render disks require a paid service.** Review current pricing and terms before creating anything. `render-production.yaml` is an optional paid blueprint; its presence does not create a service or authorize a purchase. Do not use an ephemeral free filesystem for real inquiries. No exact current tariff is asserted here.

1. Connect the GitHub repository and select branch `main` in a Node web service, region Frankfurt. Review the offered paid instance and persistent-disk costs yourself before confirming. Run one instance only.
2. Build: `npm ci --ignore-scripts --omit=dev`. Start: `node server.mjs`. Health check: `/healthz`.
3. Attach a persistent disk at `/var/data`; set `DATA_DIR=/var/data/klarraum`. Do not put SQLite in the disposable checkout filesystem.
4. Set `NODE_ENV=production`, `APP_ORIGIN` to the exact HTTPS service origin (no trailing slash), `ADMIN_PASSWORD_HASH` to your locally generated hash, and `APP_SECRET` to a separate random secret of 32+ characters. Store sensitive values in the hosting secret settings.
5. Keep `ENABLE_INQUIRIES=false`. Deploy and verify the website, health check and owner login. There is no default administrator password.
6. Configure business details, reviewed privacy/legal information and real email settings below. Confirm disk persistence and backup restoration before switching to live.
7. Only after acceptance checks, set `ENABLE_INQUIRIES=true`. Restart and test with an authorized test inquiry. Verify both the dashboard record and actual recipient mailbox, then delete test data.

`TRUST_PROXY=0` is safe by default: forwarded headers are ignored, but all users behind the reverse proxy can share a rate-limit bucket. Set `TRUST_PROXY=1` only after confirming that the host overwrites/appends a trusted rightmost client IP and that the application is reachable only through that proxy. Test the configuration; do not blindly trust caller-supplied headers.

## Email delivery

This implementation uses Resend over verified HTTPS: https://resend.com/signup . Configure a verified sender domain, its required DNS records and a suitable processing agreement. The service has its own terms and limits; review them before choosing a plan.

Required hosting values: `RESEND_API_KEY`, `MAIL_FROM` (verified sender), `MAIL_TO` (owner recipient). Store the key securely, never in Git/chat/public JavaScript. The owner receives an inquiry ID and dashboard link, without the customer's contact/address details. No customer email is sent automatically.

A provider failure leaves the inquiry in the database. The worker retries once per minute, up to five attempts. The owner can retry again from the dashboard. Notification delivery uses an idempotency key, within the email provider's supported idempotency window; delivery is not claimed to be exactly-once forever. Mailbox delivery/spam classification must be tested through the real provider.

If `RESEND_API_KEY`, `MAIL_FROM` or `MAIL_TO` is missing, the inquiry is still stored and the dashboard shows a configuration failure instead of calling the mail provider. When those values are set, the customer also receives a short confirmation that does not include the street address. Set `MAIL_CUSTOMER_RECEIPT=false` to disable customer mail. A job whose contact field contains an email gets the same kind of reminder about 24 hours before the visit, and only when mail is configured.

## Stripe (not live)

`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET` stay unused. Filling them in does not start Checkout. On-site cash and card marks in the employee report are records only.

## Google Calendar

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` turn on calendar connection for company owners. Leave both empty and the control stays hidden. `GOOGLE_CALENDAR_REDIRECT_URI` is the exact callback registered in Google Cloud. On the platform service, set the three values on the director; each company process receives them. See docs/GOOGLE-CALENDAR.md.

## Platform companies

`director.mjs` starts each company with that company's saved contact email, legal owner, address, price note, privacy text and postcodes. `ENABLE_INQUIRIES` is no longer fixed to false.

Inquiries turn on when all of these are true:

- the company is not on temporary demo storage (`PLATFORM_DEMO_MODE` / path preview stays fictional);
- the owner saved a contact email, legal owner, address, price note, privacy text and the legal-review acknowledgement;
- the director process has `PLATFORM_RESEND_API_KEY` (or `RESEND_API_KEY`) and `PLATFORM_MAIL_FROM` (or `MAIL_FROM`);
- the owner left inquiries on automatic, or explicitly on. Automatic is the default once the items above exist. Off pauses public requests.

The platform uses one verified sender. The recipient is the company contact email, stored in the director registry, not a per-company API key. Missing platform mail does not stop the company: public submission stays closed and the owner screen names `PLATFORM_RESEND_API_KEY` and `PLATFORM_MAIL_FROM`.

Before calling this production for real customers: attach the persistent disk from `render-platform-production.yaml`, confirm `DIRECTOR_DATA_DIR` survives a restart, and copy encrypted platform backups off the server on a schedule. The director download is manual. It is not an off-site cron.

## Business/legal configuration

See `.env.example`. Required before enabling inquiry collection:

- `BUSINESS_NAME`, `BUSINESS_OWNER`, `BUSINESS_ADDRESS`, `BUSINESS_EMAIL`; add phone and any applicable registration, VAT and other provider details in `BUSINESS_LEGAL_DETAILS`.
- `PRICE_NOTE`: approved wording for final prices and actual VAT treatment. Set rates in the dashboard. Do not advertise sample demo prices as approved commercial prices.
- `PRIVACY_DETAILS`: reviewed text for the actual controller, purposes/legal basis, hosting and email processors, transfers where applicable, data subject rights, authority, technical logs and retention including backups.
- `LEGAL_REVIEWED=true` is an operator acknowledgement, not an automated legal certification.
- `SERVICE_POSTCODES`: comma-separated postcode prefixes or exact codes; defaults are `90,91`. Adjust to the actual service territory.
- `RETENTION_DAYS`: 1–365; defaults to 90 for the active database. Agree an appropriate period and handle records required for other legal purposes separately.

Entering nonempty configuration only passes technical checks; it does not establish legal adequacy. The business must approve content and enter appropriate agreements with providers.

## Acceptance checks before paid handover

- Real HTTPS domain and mobile view; valid certificate without bypasses.
- Allowed and out-of-area postcodes, contact validation, all published rates.
- Submit authorized test data: inquiry appears in dashboard and real owner email notification arrives.
- Simulate an email failure; record remains visible and retry works.
- Restart/redeploy: records persist on disk. Run backup and restore into an isolated test instance.
- Check login/logout, unauthorized access, errors and host health monitoring.
- Business identity, photos/licenses, pricing, privacy and terms approved by client.
- Record host/mail/domain owners, renewal costs, support scope and recovery procedure.

The app does not accept payment or confirm appointments. It is not a multi-tenant platform. Each customer needs an isolated installation, database and credentials. No 24/7 support commitment is included.

## Direct free demo deployment (no Codex environment publication needed)

Open https://render.com/deploy?repo=https://github.com/lust280/klarraum-cleaning-demo while signed in to Render. The default `render.yaml` now requests a **free** Node service with no disk and no real inquiry collection. Inspect the preview before confirming; if Render offers only paid plans or requests an upgrade, stop. Account eligibility and quotas are controlled by Render.

The template generates a private `ADMIN_PASSWORD` and independent `APP_SECRET` in Render. It gets its exact HTTPS origin from Render's `RENDER_EXTERNAL_URL`. No Render API key or password needs to be copied into Codex. To view the empty owner dashboard, retrieve `ADMIN_PASSWORD` privately from the service Environment settings and enter it at `/admin.html`; do not send it in chat. The server hashes this password at startup, and uses the same secure session flow as installations using `ADMIN_PASSWORD_HASH`.

This demonstration can sleep, have a slow first load, and lose its temporary database on restart/redeploy. `DEMO_ONLY=true` prevents enabling live inquiry collection accidentally. Do not enter real customer data or describe this free profile as a durable production installation. The paid persistent-disk template is now in `render-production.yaml` and is a separate decision.

In preview mode, users may type fictional contact details and inspect a local-only inquiry preview. No inquiry POST occurs and no record appears in the dashboard. Real inquiry collection remains gated by the live configuration.

### Server demo inquiries

When `DEMO_ONLY=true`, the form can send a request to `/api/demo/inquiries`. It transmits only cleaning type, area, frequency, window option, privacy acknowledgement and anti-spam fields. The server rejects extra personal/contact fields and generates fixed fictional contact details. These marked test records appear in the owner dashboard and never send mail. The browser explains the substitution before submission. Static previews without this server capability still use a local-only preview. Real inquiries remain blocked, and free-instance test records may disappear on restart. Updating the connected GitHub branch triggers the hosting deployment; verify it before claiming the new flow is live.

### Uploaded images

Keep `DATA_DIR/uploads` on the same persistent volume as the database. The application serves only UUID-named optimized WebP files registered in SQLite. Configure off-site backups of the database and matching image directory. Free demos have no persistent image storage. Do not upload irreplaceable originals; keep the originals separately. The application does not fetch external image URLs. The editor library holds up to 40 optimized files, including unused uploads. Original images are not retained.

### Team module before live use

Test `/operations.html` and `/employee.html` with separate browser sessions, an invitation, assignment, work/break/finish, private photo, owner acceptance, account disablement and time correction. In `DEMO_ONLY=true`, use only fictional staff and `.invalid` emails. Free-instance staff/jobs/images are disposable. Paid infrastructure or a custom domain alone does not switch to live or establish readiness: review legal/operational settings, retention for staff/jobs, secure recovery and actual notification delivery. See docs/TEAM-RU.md for implemented features and remaining production prerequisites.
