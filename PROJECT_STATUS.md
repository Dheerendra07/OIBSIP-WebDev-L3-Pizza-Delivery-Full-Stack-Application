# Project Status — Pizza House

Last updated: 2026-10-20

## Current Git state

- Repository: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application
- Default branch: main.
- Latest merged application commit: 19255d728af2eb30941846241487c8d56af83ae1 — admin payment-review full-refund recovery.
- Payment-safety PRs merged: #12 late-capture inventory hold, #13 signed Razorpay webhook reconciliation, and #15 guarded admin full-refund recovery.
- PR #14 was a stale status-document snapshot and has been closed as superseded.
- Historical Socket.IO live order tracking merge: fb3baf38ba2926c033ea1a11e93e6f1350c15d77.
- Historical Socket.IO session-expiry hardening merge: 71d18fec59dd4106a43d6efd34327639035a7a25.
- Real environment credentials and database exports must not be committed.

## Implemented and merged

- React/Vite customer UI with menu, custom pizza builder, cart, checkout, authentication and order history.
- Express/Mongoose API with registration/email verification, secure sessions, password reset, server-priced orders and admin-only operations.
- Transactional ingredient stock reservation before checkout and cautious expired-reservation reconciliation.
- Server-side Razorpay checkout signature and provider-state verification.
- Signed POST /api/payments/webhook validating the exact raw request body using a separate RAZORPAY_WEBHOOK_SECRET.
- Event-ID receipts for duplicate webhook deliveries; payment.failed is non-terminal, and captured payments that cannot safely fulfill an order are placed in payment_review.
- Admin payment-review queue and guarded full-refund action for eligible review holds.
- Refund requests use a deterministic idempotency key; signed refund events reconcile pending/processed/failed state. Uncertain outcomes and multiple captured payments remain on manual review instead of being automatically treated as resolved.
- Inventory is released as part of the confirmed full-refund transaction only; customer/admin order views surface review/refunded states.
- Authenticated Socket.IO updates with role-derived rooms, session-expiry checks and REST refresh on reconnect.
- Admin inventory controls, scheduled low-stock email notifications and fulfillment-status transition validation.
- CI installs root/server/client dependencies, runs the complete configured Node test suite and builds the production client.

## Latest verified automated checks

- Main application commit: 19255d728af2eb30941846241487c8d56af83ae1.
- Main CI run 39298719596: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39298719596
- Result: 77 tests passed, 0 failed; production client build passed.
- PR #15 CI run 39298561324 also passed.
- CI confirms automated tests and the frontend production build only; it is not proof of live external-service integration.

## Remaining before full end-to-end verification

1. Configure Razorpay Test Mode webhook delivery with the separate webhook secret and the payment/refund events. Verify valid/invalid signatures, duplicate delivery and out-of-order events on the deployed API.
2. Run a browser journey end to end: customer registration/email verification → login → build cart → create order → Razorpay test payment → confirmation → customer order history → admin fulfillment.
3. Exercise refund processing and failure/retry using provider Test Mode, including uncertain request responses and multiple-capture manual reconciliation.
4. Verify MongoDB replica-set transactions, concurrent stock contention/out-of-stock and expired-reservation reconciliation using the configured database.
5. Verify actual SMTP email delivery and outages, plus Socket.IO with separate customer/admin sessions, logout/session expiry and reconnect.
6. Confirm deployed HTTPS, exact CORS/cookie configuration, required environment variables, health endpoint and logs.

## Local assessment runbook

1. Copy root .env.example to server/.env; do not commit secrets.
2. Configure transaction-capable MongoDB, strong JWT secret, app/frontend URLs, SMTP and Razorpay Test Mode keys plus separate webhook secret.
3. Run npm run install:all.
4. Run npm run seed:inventory.
5. Set ADMIN_EMAIL and ADMIN_PASSWORD and run npm run seed:admin.
6. Run npm run dev.
7. Verify frontend at http://localhost:5173 and API health at http://localhost:4000/api/health.
8. Run npm test and npm run build.

Do not call the app fully end-to-end verified until the configuration-backed journey and external provider/database/email checks above pass. Use Test Mode during internship assessment; do not enable live payment traffic yet.
