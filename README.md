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

The production dependency `sharp` validates and optimizes uploaded images. Development dependencies are the Playwright test tools. Without configuration the server runs in preview mode, contact fields produce a local-only preview, and server submission is rejected. Default port: 3000. Use the existing cloud checkout; do not create a worktree unless requested.

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

Commit and push changes to `main`, then run `npm run deploy`. It runs the API/unit tests and updates the `gh-pages` branch, without force-pushing. GitHub Pages must use `gh-pages` → `/ (root)`. The public demo supports local-only contact previews and explains that a server is needed for administration. The Pages preview never contains databases or credentials.

## Deploy a free server demo directly

[Deploy free demo to Render](https://render.com/deploy?repo=https://github.com/lust280/klarraum-cleaning-demo). The default `render.yaml` is free, with real inquiries disabled and temporary storage. Its demo form saves cleaning parameters with server-generated fictional contacts in the owner dashboard; personal fields are never transmitted. Account quotas may apply. No Codex publication or Render API key is needed for this route. Read the direct-deployment section of docs/DEPLOYMENT.md. Paid persistent hosting is in the separate `render-production.yaml`.

## Owner editing

The dashboard now includes **Website & Leistungen bearbeiten**: brand name, public contact details, displayed service region/hours, hero copy, three service titles/descriptions and availability, optional windows, and three color themes. Settings are stored in SQLite with optimistic version checks. Unavailable services are rejected server-side and historical inquiry titles/prices remain intact. Public legal identity and mail delivery destinations remain separately configured deployment details. No arbitrary HTML or third-party image embeds are accepted. Authenticated image uploads are validated, optimized and stored locally; see below.

Status counters summarize the inbox. Private inquiry notes are owner-only and deleted with the inquiry. Settings and notes are included in database snapshots. Free Render's temporary filesystem still makes this a demonstration, not durable customer hosting.

## Logos, photos and customer statements

The website editor now accepts a logo, a hero photo and up to eight gallery images with captions and ordering. Up to 40 files can be held in the media library; remove unused files there to free space. Removing an image from the selection does not erase its file until explicitly deleted. Published images are protected against deletion until the owner removes the reference and saves.

Uploads require owner authentication, CSRF and origin checks. Input is limited to 5 MB and 12 megapixels, signature-checked as JPEG/PNG/WebP, resized and re-encoded into WebP without original metadata. The original filename is never used as a path. SVG, GIF, HEIC and animated images are unsupported. Public image URLs are intended for website publication; upload only content you may publish.

Three optional customer statements can be entered manually. There are no default fake testimonials, star ratings or invented review counts. The owner is responsible for authenticity, licenses and appropriate permission to publish identifiable people or customer statements. Empty gallery/review sections are hidden.

Images live in `DATA_DIR/uploads`, alongside the database. `npm run backup` copies both the consistent database and its image set. Keep the `.sqlite` and matching `.sqlite.media` directory together. Free Render can lose both; durable customer deployment still needs persistent storage and off-site backup scheduling.

Before customer handover, use the [Russian company checklist](docs/CLIENT-CHECKLIST-RU.md) to separate delivered features from deployment, legal and operational prerequisites.
