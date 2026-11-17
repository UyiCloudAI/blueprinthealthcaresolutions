# Security, privacy and launch checklist

This document is an engineering checklist, not legal advice or a certification of compliance.

- [ ] Determine each party's role under HIPAA and applicable state privacy laws; obtain qualified compliance/legal advice.
- [ ] Perform a risk analysis and document safeguards, incident response, contingency, access control, audit and retention procedures.
- [ ] Confirm and sign required BAAs before vendors create, receive, maintain or transmit PHI on your behalf.
- [ ] Cloudflare: confirm the selected account tier and exact services are covered by an executed BAA; Cloudflare states BAAs are available only to Enterprise customers.
- [ ] Video: confirm Daily HIPAA configuration and BAA are active before any PHI is used.
- [ ] Identity: MFA for workforce users, secure session handling, short session lifetime where appropriate, recovery protections, rate limiting and role-based authorization.
- [ ] Enforce organization/tenant isolation on every server route and database operation.
- [ ] Encrypt data in transit and at rest; manage and rotate secrets; prohibit secrets in source control.
- [ ] Minimize PHI. Avoid PHI in analytics, URLs, browser logs, error reports, email/SMS subject lines, Stripe metadata, and payment receipts.
- [ ] Use hosted payment checkout; never store card numbers or CVV.
- [ ] Verify Stripe webhook signatures, use idempotency, and make payment confirmation server-side.
- [ ] Audit access and security events without logging sensitive clinical content.
- [ ] Review file uploads, backups, support access, deletion and retention.
- [ ] Test accessibility, penetration/security controls, incident response and recovery.
- [ ] Publish privacy notice, terms, consent, payment/refund and cancellation policies after legal review.
- [ ] Never claim "HIPAA compliant" solely because a vendor or hosting provider offers compliant features.
