# GitHub + Cloudflare deployment plan

## A. Create the GitHub repository
1. Sign in to GitHub and create a **private** repository named `telehealthtechsolutions`.
2. Upload or push the contents of this folder to the repository root.
3. Do not commit `.dev.vars`, `.env` files, API keys, real patient data, or production exports.
4. Enable MFA for GitHub and restrict repository/admin access.

## B. Create the Cloudflare Worker
1. Sign in to Cloudflare.
2. Go to **Workers & Pages** and create a Worker project.
3. For Git-based deployment, choose the GitHub connection if offered for the selected workflow; authorize only the repository needed.
4. If the dashboard's current flow only offers static Pages import, use Workers' Git integration or deploy using Wrangler from a trusted CI workflow. This repository uses a Worker with static assets.
5. Set the production branch to `main`. Use a separate staging branch/environment for testing.
6. Review the build/deploy settings and deploy a non-production preview first.

## C. Configure bindings and secrets
1. Create D1 only after the security/compliance review and schema review.
2. Replace the commented D1 placeholder in `wrangler.toml` with the real database name and ID.
3. Add secrets with Cloudflare's secret-management interface or Wrangler secrets, never as plaintext in Git:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `DAILY_API_KEY`
4. Configure an approved identity provider and add its server-side secrets only after choosing the vendor.
5. Keep staging and production credentials separate. Use Stripe test mode for staging.

## D. Configure domain
1. In Cloudflare, open the Worker and configure a custom domain for `telehealthtechsolutions.com` (and optionally `www.telehealthtechsolutions.com`).
2. Follow Cloudflare's DNS instructions; verify TLS/HTTPS and redirect policy.
3. Set `APP_BASE_URL` to the production HTTPS origin in the Worker secrets/variables.
4. Add security headers, rate limits, bot protections, alerting and error monitoring after reviewing the data each service receives.

## E. Payments and video
1. Create a Stripe account and use test mode first. Configure a webhook endpoint for the backend and verify signatures using the official Stripe SDK or a reviewed implementation.
2. Make booking confirmation depend on a verified webhook, not the browser's success redirect.
3. Contact Daily to enable the HIPAA configuration and execute the BAA before sending any PHI or using the video integration for clinical visits.
4. Configure randomly generated room names, short-lived access tokens, restricted room access, and safe recording defaults. Disable recording unless a reviewed need and compliant storage process exist.
5. Do not store card details, video recordings, transcripts, or clinical notes in this starter.

## F. Launch gates
- Automated auth, tenant-isolation, payment-webhook, booking concurrency and authorization tests pass.
- Security assessment and threat model completed.
- Required BAAs and vendor review completed.
- Privacy notice, terms, consent and cancellation/refund policy reviewed by counsel.
- Backups, incident response, retention/deletion and access review processes tested.
- Accessibility and mobile-browser testing completed.
- No real patient data until all launch gates are satisfied.
