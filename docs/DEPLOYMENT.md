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
