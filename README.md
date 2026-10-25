# Klarraum — cleaning website demo

German-language responsive demonstration for a fictional Nürnberg cleaning business. No real business, bookings, payments, reviews, or customer data collection.

## Run
Requires Node.js 22 or newer. No third-party dependencies or installation needed.

```sh
npm start
```

Default port: 3000; override with `PORT`. Validate with `npm test`. Static assets are in `public/` and can also be deployed to a static host.

## Features
Service cards, responsive layout, local price estimator with recurring discounts, inquiry-text preparation, FAQ and demo legal notice. Fonts and artwork are local/system based; no tracking, external requests or cookies.

## Before real customer use
Replace fictional branding and example prices with approved customer content. Connect and test an actual inquiry-delivery service with validation and abuse protection. Add provider identity, legal notices and privacy information specific to the business and hosting. Clarify service area, pricing and terms. Test mobile devices, keyboard navigation and actual delivery before accepting inquiries. No domain is required for local development.

## Development environment
Use the existing checkout in the isolated cloud task; do not create a worktree unless requested. Run `npm test`, then `npm start`; verify the homepage and assets with local HTTP requests. Live processes must be restarted in new tasks.

## GitHub Pages hosting

The `gh-pages` branch contains the static files. In repository Settings → Pages select **Deploy from a branch**, branch **gh-pages**, folder **/ (root)**, then Save. The expected URL after successful deployment is `https://lust280.github.io/klarraum-cleaning-demo/`.

For updates, commit and push changes to main, then run `npm run deploy`. This runs tests and updates gh-pages without force-pushing. The authenticated Git identity needs repository write access. Enabling Pages requires separate Pages administration permission.
