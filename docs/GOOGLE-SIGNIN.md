# Google sign-in for a new company owner

This is separate from Google Calendar. Calendar sync still uses the scope `calendar.events` and the callback `/api/google/calendar/callback`. Sign-in uses OpenID (`openid email profile`) and a different callback. The same Google Cloud OAuth client can serve both, because each flow has its own redirect URI and scope. Stripe Checkout stays off.

An owner chooses Solo, Starter, Team, Business, Scale, or Plus on the public pricing page, then chooses Continue with Google. The first successful sign-in creates the company on that plan, starts the 15-day trial, and opens the owner cabinet. A later sign-in with the same Google account returns to that company and does not change the plan.

The owner password is a random hash that is never shown. A Google-only owner signs in again with Google. Director manual create and the email trial remain available for assisted cases. The director company list is unchanged.

While Google keys are missing, the button stays hidden and `/api/google/signup/start` answers 404. It does not answer 500.

## Environment

Set these on the service that runs `director.mjs`. The same client id and secret already used for Calendar are enough. `GOOGLE_SIGNIN_REDIRECT_URI` is optional. When it is empty, the director uses its own origin + `/api/google/signup/callback`.

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_SIGNIN_REDIRECT_URI=https://platform.klarraumapp.com/api/google/signup/callback
```

On the public demo host, if sign-in should work there too, set the same client and:

```text
GOOGLE_SIGNIN_REDIRECT_URI=https://klarraumapp.com/api/google/signup/callback
```

Leave `GOOGLE_CALENDAR_REDIRECT_URI` as it is. Do not point the calendar redirect at the signup callback.

## Redirect URIs

Register both signup URIs on the same Web client, next to the existing calendar URIs. Google matches the full URI.

Sign-in:

- `https://platform.klarraumapp.com/api/google/signup/callback`
- `https://klarraumapp.com/api/google/signup/callback`

Calendar (unchanged):

- `https://platform.klarraumapp.com/api/google/calendar/callback`
- `https://klarraumapp.com/api/google/calendar/callback`

Add the scope `openid`, `email`, and `profile` on the consent screen, in addition to `https://www.googleapis.com/auth/calendar.events`. JavaScript origins are not required. While the Google app is in Testing, add the owner Google account as a Test user. Do not invent a client id in this repository.

## How to try the click path

1. Save the variables and restart the director service.
2. Open `https://klarraumapp.com/pricing.html` or `https://platform.klarraumapp.com/for-companies.html`.
3. Choose a plan. The page lands on Continue with Google for that plan.
4. Google sends the browser to `/api/google/signup/callback`, which redirects to that company's `/admin.html`.
5. The cabinet opens without a director creating the company first.

If the button is missing, `GET /api/google/signup/status` returns `{"enabled":false}` and the keys are not visible to that process.
