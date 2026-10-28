# Changelog

## Unreleased

Continue with Google uses the host that received the request, so `klarraumapp.com` and `platform.klarraumapp.com` each keep their own signup callback. The public demo service still needs the same Google client id and secret before its status turns on. Pricing and the company page both offer the button. The director console no longer shows Create company. Companies are grouped under Solo, Starter, Team, Business, Scale, and Plus, with a count on each group.

Plus is a self-serve plan at $259 with 25 included workers, $8 extra seats, and about 250 GB. Teams above Scale stay on Plus with seat overage. Custom remains a negotiated plan. Pricing says photos and other media are kept on a 12-month rolling basis. A reminder email and an automatic purge are not built yet.

A company owner can choose a public plan and continue with Google. The first sign-in creates the company, starts the trial, and opens the owner cabinet. The same Google client is used with a separate signup callback. Calendar sync is unchanged. The button stays hidden when the client keys are missing. Stripe Checkout stays off.

Platform companies can accept inquiries after the owner saves contact and legal details and the director has platform mail settings. The customer calculator uses SVG service icons and a larger live price. Inquiry mail fails with a configuration error when Resend settings are missing.

Director company cards no longer block save on empty payment dates, keep the selected plan, show the owner invite until activation, and can delete one named test company. Owner home leads with today's attention and the plan card. Employees can decline an assigned job and record a signature, tip, and on-site cash or card mark. Customer confirmation and appointment reminders send when mail is configured. Stripe stays inactive. Google Calendar connects when the client id and secret are set.

Pricing compares Solo, Starter, Team, Business and Scale from the plan catalogue. Custom domain is a one-time $99 note. Monthly CSV and PDF use the company currency. Account cancellation and deletion stay separate from any charge.

The public company page and `/pricing.html` are the same short plan grid on the demo host and the platform host. Trial and assisted-setup forms stay on the company page.

Platform Privacy, Terms, Cookies, and Impressum use operator placeholders instead of a pre-launch refusal. Extra seats cost $15, $15, $12, $10, and $10 so the next plan is cheaper at its included headcount. A daily encrypted backup can write to the server disk when configured, and it does not claim an off-site copy unless external storage credentials are set and an upload succeeds. Owner Today and the employee home use the light cabinet layout.

## 2.1.0

Commercial release preparation: isolated installation setup, allowlisted source archive, restore into a new directory, operational status, DE/EN interface controls, customer/property records, finite recurring schedules, calendar and employee notifications. This is a release candidate until the release checks in docs/RELEASE-PLAN-RU.md pass. Real hosting, email delivery and seller accounts remain deployment prerequisites.

## 2.0.0

Website editor/media, inquiries, employees/jobs, private proof photos and monthly work/payment reports. Public Render deployment remains a fictional demonstration.
