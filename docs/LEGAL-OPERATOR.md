# Operator fields to paste

The platform pages ship with brackets, not a fictional company. Replace each bracket in the files below with the real value, then redeploy. Leave a bracket only if that item truly does not exist, and write the reason inside it, for example `[NOT REGISTERED]`.

Pages:

- `director-public/platform-impressum.html` (also served as `/platform-impressum.html`)
- `director-public/platform-privacy.html`
- `director-public/platform-terms.html`
- `director-public/cookies.html`

The partner footer on `/for-companies.html` and `/pricing.html` links to Privacy, Terms, Cookies, and Impressum. Those pages are the same files on `klarraumapp.com` and the platform host.

## Same fields for DE and EN

| Placeholder | What to paste |
| --- | --- |
| `[OPERATOR LEGAL NAME]` | Registered company name or the sole trader's name as it should appear on an invoice. |
| `[OPERATOR STREET AND NUMBER]` | Street and building number of the business address. No PO box if the German imprint requires a street address. |
| `[OPERATOR POSTAL CODE AND CITY]` | Postal code and city. |
| `[OPERATOR COUNTRY]` | Country name. |
| `[OPERATOR EMAIL]` | A mailbox the operator actually reads. Used for privacy requests and terms contact. |
| `[OPERATOR PHONE]` | Phone number, or `[NO PUBLIC PHONE]` if none will be published. |
| `[MANAGING DIRECTOR OR OWNER NAME]` | Name of the person who represents the operator. |
| `[REGISTER COURT AND NUMBER, OR "NOT REGISTERED"]` | For a German company, the register court and HRB/HRA number. Otherwise `NOT REGISTERED`. |
| `[VAT ID, OR "NOT ISSUED"]` | EU VAT ID if one exists, otherwise `NOT ISSUED`. |
| `[STEUERNUMMER, IF REQUIRED FOR THE DE NOTICE]` | German tax number when the notice needs it, otherwise `NOT PUBLISHED`. |
| `[CONTENT RESPONSIBLE NAME AND ADDRESS]` | Person responsible for editorial content, with an address. Often the same as the operator. |
| `[RETENTION PERIOD, FOR EXAMPLE 30 DAYS AFTER ACCOUNT CLOSURE]` | How long platform account data is kept after closure. |
| `[BACKUP RETENTION]` | How long encrypted backup files are kept. |
| `[EMAIL PROVIDER, FOR EXAMPLE THE CONFIGURED RESEND SENDER]` | The mail provider and the From address already set on Render. |
| `[HOSTING PROVIDER AND REGION]` | Host and region, for example the Render region in use. |
| `[GOVERNING LAW, FOR EXAMPLE THE LAW OF GERMANY]` | The law that should govern the terms. |
| `[COURT CITY]` | City of the venue, where a venue clause is allowed. |

German visitors use the Impressum as the provider identification. English visitors use the same name, address, and email at the top of the Terms and Privacy Policy. Do not invent a second company for the English market.

## Company workspaces (already in the product)

Each cleaning company fills its own notice in Company administration → Customer inquiries:

- Contact email
- Phone
- Legal owner
- Legal address
- Privacy details
- Extra legal text
- The checkbox that the company reviewed that text

When those fields are saved and the company is allowed to accept inquiries, the company site's legal notice and privacy page show that text and hide the demonstration warning. That is the company's identity, not the platform operator's.
