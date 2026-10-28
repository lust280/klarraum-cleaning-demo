# Google Calendar

Company owners can connect one Google Calendar and copy upcoming jobs into it. This is not Google sign-in. Owner sign-in after choosing a plan is documented in docs/GOOGLE-SIGNIN.md and uses `/api/google/signup/callback`. Workers do not connect their own Google account. A synced event contains the job title, start and end, the worker's name, and the service address. It does not contain the customer's phone or email.

The control is hidden until both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. A missing key does not show "Connect Google Calendar" and the connect route answers 404. Stripe Checkout stays off.

## Where the variables live

Set them on the platform service that runs `director.mjs`. The director copies them into every company process. Company sites do not have a separate Render service.

A single-company `server.mjs` install reads the same three names from its own environment.

`GOOGLE_CALENDAR_REDIRECT_URI` is optional. When it is empty, the director uses `DIRECTOR_ORIGIN` + `/api/google/calendar/callback`.

## Google Cloud Console

1. Open Google Cloud Console → APIs & Services → Library, and enable **Google Calendar API**.
2. APIs & Services → OAuth consent screen. User type External. App name KlarraumApp. Add the scope `https://www.googleapis.com/auth/calendar.events` only.
3. While the app is in Testing, add the Google account that will connect as a Test user. Publishing the app is a separate Google review. Do not invent a client id in this repository.
4. APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
5. Authorized redirect URIs. Google matches the full URI and does not accept a wildcard subdomain. Register both of these on the same client:

   - `https://platform.klarraumapp.com/api/google/calendar/callback`
   - `https://klarraumapp.com/api/google/calendar/callback`

   Company subdomains such as `https://<company-id>.<COMPANY_BASE_DOMAIN>/...` are not redirect URIs. The platform callback receives Google's response, stores the refresh token in that company's database, and sends the owner back to that company's `/admin.html`. Path preview (`/companies/<id>/`) uses the `klarraumapp.com` callback because that host forwards `/api/google/calendar/callback` to the director.

6. JavaScript origins are not required for this server-side redirect.
7. Copy the client id and client secret into Render. Do not commit them.

## Render

On the platform web service:

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=https://platform.klarraumapp.com/api/google/calendar/callback
```

On the public demo host, if calendar connect should work there too, set the same client and:

```text
GOOGLE_CALENDAR_REDIRECT_URI=https://klarraumapp.com/api/google/calendar/callback
```

Restart the service after saving. The owner opens Company administration, chooses Connect Google Calendar, then Sync jobs. Disconnect leaves events already written in Google.
