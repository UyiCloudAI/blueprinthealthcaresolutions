# Telehealth Tech Solutions

Marketing site plus a demo telehealth portal: patient/provider accounts, appointment booking, and video visits.

- **Front end:** static files in `public/` (`index.html` marketing page, `app.html` portal)
- **API:** Cloudflare Worker in `src/worker.js` (routes under `/api/*`)
- **Database:** Cloudflare D1 (`migrations/0001_init.sql`)
- **Video:** Daily.co (private rooms, per-user meeting tokens)

> **Demo only.** Do not store real patient information until the HIPAA checklist at the bottom is done.

## Deploy

1. **Install and create the database**
   ```bash
   npm install
   npx wrangler login
   npx wrangler d1 create telehealth
   ```
   Paste the printed `database_id` into `wrangler.jsonc`.

2. **Create the tables**
   ```bash
   npx wrangler d1 migrations apply telehealth --remote
   ```

3. **Set secrets**
   ```bash
   npx wrangler secret put DAILY_API_KEY          # from dashboard.daily.co > Developers
   npx wrangler secret put DAILY_DOMAIN           # your Daily subdomain, e.g. "telehealthtech"
   npx wrangler secret put PROVIDER_INVITE_CODE   # any long random string; clinicians need it to register
   ```

4. **Deploy**
   ```bash
   npx wrangler deploy
   ```
   Or connect the GitHub repo in Cloudflare (Workers & Pages > Create > Import a repository) with deploy command `npx wrangler deploy`. Run step 2 once from your machine first.

5. **Custom domain:** in the Worker's Settings > Domains & Routes, add `telehealthtechsolutions.com` and `www.telehealthtechsolutions.com`.

## Try it

1. Open `/app`, choose **Create account**, tick "I am a clinician", enter your invite code, and register a provider.
2. Open a private window and register a patient.
3. As the patient, book a time. As either user, click **Join video**.

Local development: put `PROVIDER_INVITE_CODE=...` (and the Daily values) in a `.dev.vars` file, then `npm run db:migrate:local && npm run dev`.

## How it works

- Passwords: PBKDF2-SHA256 with a random per-user salt. Sessions: random token in an HttpOnly, SameSite=Lax cookie; only a SHA-256 of the token is stored.
- Login lockout after 5 failed attempts per email+IP for 15 minutes; registration limited per IP.
- Clinic hours are generated in `CLINIC_TZ` (Mon-Fri 9:00-17:00, 30-minute slots, DST-aware). A unique database index prevents double-booking.
- `DEMO_MODE=true` (in `wrangler.jsonc`) lets anyone join a visit at any time. With `false`, the room opens 15 minutes before the start and closes 30 minutes after the end, and bookings need one hour of lead time.
- Every sign-in, booking, cancellation, and video join is recorded in `audit_log`.

## Before real patients (HIPAA checklist)

This code gives you the product flow, not HIPAA compliance. Compliance depends on contracts and operations as much as code.

- [ ] Signed **BAAs** with every vendor that touches PHI: hosting/database (Cloudflare's BAA is an Enterprise-plan arrangement and D1 coverage must be confirmed with them), video (Daily offers a BAA on paid plans), email/SMS, and logging.
- [ ] If your hosting or database vendor will not sign a BAA covering these services, move the API and data to one that will (for example a HIPAA-eligible AWS/GCP/Azure setup).
- [ ] Set `DEMO_MODE` to `"false"`; encrypt data at rest; define backup, retention, and deletion rules.
- [ ] Email verification, password reset, and multi-factor authentication for providers (not built yet).
- [ ] A reviewed privacy policy, notice of privacy practices, telehealth consent, and terms of use.
- [ ] A risk assessment and written security policies; workforce training; breach-response plan.
- [ ] Audit-log review process and access controls for who can query the production database.
- [ ] Penetration test or independent security review.
