# Klarraum — cleaning-company website and inquiry management

German-language website with a price estimator, inquiry API, SQLite storage and a protected owner dashboard. Public design preview: https://lust280.github.io/klarraum-cleaning-demo/

**The public GitHub Pages preview does not accept real inquiries.** GitHub Pages cannot run the backend. This repository now includes a server for a separate deployment. No real hosting account, company identity or email delivery has been configured or verified yet.

## Local development

Node.js **24.13+**, preferably the version in `.node-version`.

```sh
npm ci --cache /tmp/klarraum-npm-cache
npm test
npm start
```

No production npm dependencies. Development dependencies are only the Playwright test tools. Without configuration the server runs in preview mode, contact fields are disabled, and submission is rejected. Default port: 3000. Use the existing cloud checkout; do not create a worktree unless requested.

To configure a private local installation, copy `.env.example` to `.env.local`, fill it securely and run `node --env-file=.env.local server.mjs`. Never commit secrets or personal data. Generate a password hash with `npm run admin:hash` (password is hidden), and a separate application secret with `npm run secret:generate`. Do not use command-line arguments containing passwords.

## Included

- Responsive customer form: name, email or phone, postal code, optional address/date/comment, cleaning requirements and privacy acknowledgement.
- Server validation, price calculation, 16 KB request limit, signed form tokens with timing checks, honeypot, creation rate limits and idempotency keys.
- SQLite storage with a persistent mail-delivery queue; email failures do not lose saved inquiries. Notifications contain only the inquiry number and dashboard link.
- Password hashing with scrypt, random server-side sessions stored as hashes, HttpOnly/SameSite cookies, secure cookies in production, origin and CSRF checks, login limits and security headers.
- Owner dashboard at `/admin.html`: filter, paginate, change status, delete, retry notification and update prices/discounts.
- Eight-hour session expiry, session invalidation when credentials or application secret change, configurable automatic active-data retention (90 days by default).
- Consistent backup command and restoration verification in tests. Off-disk backups and their schedule still need configuring on the selected host.
- Clearly marked legal templates. They are not a complete legal review or a substitute for real company information.

## Tests

```sh
npm test
# Install Chromium once for Playwright, retaining its normal download verification:
npx playwright install chromium
npm run test:browser
# Or use an installed Chromium:
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

API/storage tests use temporary databases and a mock email provider. Browser tests exercise the actual local form-to-dashboard flow on desktop and mobile, XSS-safe rendering, price changes and deletion. These do not prove delivery through a real Resend account.

## Deployment and handover

See [deployment](docs/DEPLOYMENT.md), [operations](docs/OPERATIONS.md), and the [proposed €660 package](docs/PRODUCT-RU.md).

### Static design preview

Commit and push changes to `main`, then run `npm run deploy`. It runs the API/unit tests and updates the `gh-pages` branch, without force-pushing. GitHub Pages must use `gh-pages` → `/ (root)`. The public demo disables contact entry and explains that a server is needed for administration. The Pages preview never contains databases or credentials.
