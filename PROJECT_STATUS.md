# Project Status — Pizza House

Last updated: 2026-10-20

## Current Git state

- Repository: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application
- Default branch: `main`.
- Latest merged application hardening commit: `7f915ad55d96fcf1b7ef9dff3c63d185e1dcf176` — checkout, captured-payment and reservation recovery hardening (PR #17).
- Delivery details collection and persistence merged in PR #16.
- Payment-safety PRs merged: #12 late-capture inventory hold, #13 signed Razorpay webhook reconciliation, #15 guarded admin full-refund recovery, #16 delivery destination fields, and #17 checkout/recovery hardening.
- PR #14 was a stale status-document snapshot and is closed as superseded.
- Historical Socket.IO live order tracking merge: `fb3baf38ba2926c033ea1a11e93e6f1350c15d77`.
- Historical Socket.IO session-expiry hardening merge: `71d18fec59dd4106a43d6efd34327639035a7a25`.
- Real environment credentials and database exports must not be committed.

## Implemented

- React/Vite customer UI with featured menu, custom pizza builder, cart, checkout, authentication, order history and a responsive delivery details form.
- Express/Mongoose API with registration/email verification, secure cookie sessions, password reset, server-priced orders and admin-only operations.
- Validated delivery recipient, Indian mobile number, street address, city, state and PIN code; details are saved with the order and visible in customer/admin order views.
- Pending destination can be updated only while the order is unpaid and awaiting payment.
- Transactional ingredient stock reservation before checkout and cautious expired-reservation reconciliation.
- Razorpay Test Mode checkout signature validation and independent provider-state verification.
- Signed `POST /api/payments/webhook` validates the exact raw request body with the separate `RAZORPAY_WEBHOOK_SECRET`.
- Event-ID receipts make duplicate webhook deliveries idempotent; payment.failed is not treated as a final payment outcome while late capture remains possible.
- Captured payments that cannot safely fulfill because of amount, currency, order linkage, inventory reservation, multiple captures or invalid/missing destination are placed in `payment_review` and made visible to the admin.
- Client verification retry is preserved in session storage for the current tab/session so a reload does not automatically restart checkout.
- Expired unpaid orders become cancelled after safe reservation reconciliation. The provider-order reference is retained so a late capture can still be linked and reviewed.
- Admin payment-review queue and guarded full-refund recovery for eligible review holds. Refund requests use deterministic provider idempotency; extra captures, failed refunds and uncertain states remain on manual review.
- Inventory is released only after a confirmed full refund or a safely reconciled expired unpaid checkout; ambiguous provider state preserves the hold.
- Authenticated Socket.IO updates with role-derived rooms, session-expiry checks and REST refresh on reconnect.
- Admin inventory controls, low-stock notification job and fulfillment status transition validation.
- CI installs root/server/client dependencies, runs the configured server/client test suite and builds the production client. A passing CI run is not the same as live end-to-end verification.

## Latest verified automated checks

- PR #17 code head: `6b710511e22ab6c0a86e7dfd557b36adeec341d0`.
- Pull-request check: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39319136556 — passed.
- Push check: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39319133025 — passed.
- Both checks completed dependency installation, configured tests/smoke checks and the production client build successfully.
- They do not verify external MongoDB, Razorpay, SMTP or deployed-browser behaviour.

## Final setup and end-to-end verification — still pending

1. Configure a transaction-capable MongoDB replica set/Atlas environment and seed inventory; test concurrent stock contention, sold-out items and expired reservations.
2. Configure Razorpay Test Mode keys and the separate webhook secret; test checkout capture, invalid signature, duplicate and out-of-order webhook delivery, ambiguous verification, multiple captured payments, refunds and retry/reconciliation.
3. Run the browser journey: register → email verification → login → choose/build pizza → enter address → create order → payment → customer order history → admin fulfillment.
4. Confirm pending payment recovery after reload; test cancelled expired orders and captured payments routed to manual review without asking the customer to pay twice.
5. Verify SMTP email verification/reset/low-stock notification and provider outage behaviour.
6. Test customer/admin Socket.IO updates, reconnect, logout/session expiry, and make sure private order events stay scoped to the right sessions.
7. Validate production HTTPS, exact CORS origins, secure cookie policy, environment variables, health endpoint and server logs.

## Local assessment runbook

1. Copy root `.env.example` to `server/.env`; never commit secrets.
2. Configure transaction-capable MongoDB, unique JWT secret, exact application/frontend URLs, SMTP and Razorpay Test Mode keys plus a separate webhook secret.
3. Run `npm run install:all`.
4. Run `npm run seed:inventory`.
5. Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in `server/.env`, then run `npm run seed:admin`.
6. Run `npm run dev`.
7. Verify frontend at `http://localhost:5173` and API health at `http://localhost:4000/api/health`.
8. Run `npm test` and `npm run build`.

Do not describe this as fully end-to-end verified until the configuration-backed browser flow and real provider/database/email checks above pass. Use Razorpay Test Mode during assessment; do not enable live payment traffic yet.
