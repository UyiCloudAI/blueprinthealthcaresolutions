# Architecture

## Application model
TelehealthTechSolutions is a software platform serving multiple healthcare organizations. It is not the provider of clinical care. Each organization controls its staff, provider availability, appointments, payment configuration, and access to its patients.

## Proposed flow
1. Organization is provisioned and verified by a platform administrator.
2. Provider staff sign in through a healthcare-appropriate identity provider with MFA.
3. Patient registers/signs in and selects an organization and appointment slot.
4. Server checks authorization, organization scope, slot availability, and price.
5. Server creates a hosted Stripe Checkout Session using server-owned price rules; browser-supplied amounts are never trusted.
6. A verified Stripe webhook confirms payment and atomically confirms the booking. Idempotency keys prevent duplicate processing.
7. Server creates a short-lived video room/token with Daily only after the vendor's HIPAA configuration and BAA are confirmed.
8. Authorized patient/provider joins the room; meeting URLs and tokens are never exposed in public pages or logs.
9. Audit events capture security-relevant actions without copying clinical details into logs.

## Recommended integrations
- Identity: choose a vendor that supports MFA, secure recovery, organization-aware roles, and appropriate BAA/contractual terms if it handles PHI.
- Video: Daily is a strong candidate because it offers a telehealth API and a HIPAA configuration/BAA pathway. Confirm current plan, configuration, contract, retention, recording and chat behavior before use.
- Payments: Stripe Checkout can reduce exposure to card data. Keep health details out of Stripe metadata, product descriptions, receipts, URLs, and logs. Have counsel/compliance assess whether any payment flow or associated data involves PHI and what agreements are required.
- Email/SMS: use only after vendor/BAA review if messages could expose patient or appointment details. Default notifications should be generic.
- Scheduling: enforce server-side conflict checks and transactional booking.

## Tenant isolation
Every organization-owned query and mutation must verify membership and role server-side. Do not rely on an organization ID supplied by the browser. Add automated tests proving that users in one organization cannot read or mutate another organization's records.
