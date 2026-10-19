# Project Status — Pizza House

Last updated: 2026-10-19 — signed payment webhooks and late-capture reconciliation

## Git state (verified)
- Repository: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application
- Default branch: `main`.
- Feature PRs #1–#3, status/handoff PRs #4, #6, #8, #9, #11, Socket.IO PR #5, socket session-expiry PR #7, payment-request validation PR #10, late-capture hold PR #12 and signed Razorpay webhook PR #13 are merged.
- Socket.IO live order tracking merge: `fb3baf38ba2926c033ea1a11e93e6f1350c15d77`.
- Socket JWT-expiry hardening merge: `71d18fec59dd4106a43d6efd34327639035a7a25`.
- Latest verified application-code commit is `c48b295026090240de73282c001dda6f31a6a90b`; this includes strict payment-request validation, late-capture safeguards, and signed Razorpay webhooks.
- Repository is public by owner choice; no real `.env` credentials or database exports are committed.

## Implemented
- React/Vite customer UI: featured menu, filters, custom pizza builder, cart, checkout, order history, authentication and password reset.
- Express/Mongoose API: registration and email verification, customer and separately seeded admin sign-in, catalog, order creation, payment verification, inventory updates and admin order transitions.
- Admin dashboard: inventory levels/thresholds, low-stock alerts, order queue and summary metrics.
- Server-owned catalog pricing and order-line validation; client-provided prices and totals are not trusted.
- Ingredient stock is reserved inside MongoDB transactions before checkout. Razorpay test payments are verified server-side using HMAC plus provider capture status, order linkage, amount and INR currency.
- Checkout retry reuses an existing pending order only when cart choices and server pricing still match.
- Expired stock reservations are reconciled against provider payment status; failed attempts remain non-terminal during the 73-hour late-capture safety window.
- Signed `POST /api/payments/webhook` uses the raw-body HMAC and the separate `RAZORPAY_WEBHOOK_SECRET`; webhook event IDs are persisted for idempotency.
- Matching `payment.captured` events can complete an order even when browser checkout verification did not finish. Captured payments that mismatch the expected amount/currency/order or no longer have a safe inventory reservation are held as `payment_review` and listed in the admin review queue; there is no automatic refund.
- HttpOnly JWT session cookie, hashed expiring verification/reset tokens, password-reset session-version invalidation, auth rate limiting and admin route authorization.
- Authenticated Socket.IO live order tracking. The server validates the exact allowed origin and current database user/session, derives user/admin rooms server-side, and publishes minimized order updates after relevant persisted order/payment/status changes.
- Realtime sockets require a valid future JWT `exp`; the server disconnects them at session expiry and clears expiry timers when sockets disconnect. Missing, invalid or expired session timestamps are rejected for realtime authentication.
- The frontend re-fetches REST state on socket connection/reconnection and relevant events, so REST remains the source of truth if a realtime event is missed.
- API order lookup/payment endpoints require correctly formatted ObjectId strings. Payment verification rejects absent/non-object bodies and non-string provider fields with controlled HTTP 400 responses before database/provider lookup.
- Production startup requires `RAZORPAY_WEBHOOK_SECRET`; `.env.example` documents the separate webhook secret.
- GitHub Actions runs the complete configured unit-test suite and production frontend build on pushes to `main`, `feat/**`, `fix/**` and pull requests targeting `main`.

## Latest verification (checked 2026-10-19)
- Socket.IO feature PR run [39227920902](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39227920902): passed; unit tests and production client build succeeded.
- Session-expiry hardening PR run [39232762071](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39232762071): passed; dependency installation, unit tests and production client build succeeded.
- Session-expiry hardening merged-main run [39232862036](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39232862036): passed.
- Payment request validation PR run [39237742117](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39237742117): passed.
- Late-capture safeguard PR run [39252695461](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39252695461): passed.
- Signed webhook PR run [39254248827](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39254248827): passed.
- Current merged `main` run [39254366630](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39254366630): **69 tests passed, 0 failed**; production client build passed.
- CI does not establish configured Razorpay Dashboard delivery, live MongoDB transaction behavior, email delivery, refunds, or the full browser-to-provider end-to-end journey.

## Remaining before calling it fully end-to-end tested
- Run a configured browser journey: register → verify email → sign in → build pizza → create order → Razorpay test payment → verify payment → see live order updates → advance order from the admin session.
- Exercise MongoDB replica-set transactions, concurrent stock contention/out-of-stock, SMTP delivery and outage behavior, Razorpay timeout/failure/duplicate callbacks, and expired-reservation reconciliation.
- Test Socket.IO with two separate customer sessions and an admin session, including expiry, logout/password-reset invalidation, rejected origins and reconnect after a dropped connection.
- Configure the webhook in Razorpay Test Mode with `payment.captured` and `payment.failed` enabled, set the same secret in the Razorpay Dashboard and `server/.env`, and verify duplicate deliveries and out-of-order events.
- Implement and audit the manual refund/reconciliation process for `payment_review` orders before production payments; webhook review flags do not issue refunds automatically.
- Deployment needs HTTPS, exact CORS/socket origins, verified `MAIL_FROM`, secure cookie settings and restricted MongoDB network access. Use Razorpay test credentials only during assessment.

## Local setup
1. Copy `.env.example` to `server/.env`. Copy `client/.env.example` to `client/.env` only if overriding the local API URL.
2. Configure a transaction-capable MongoDB instance, a unique strong JWT secret, SMTP sender credentials, exact frontend/API URLs and Razorpay **test** keys. Never commit `.env`.
3. Run `npm run install:all`.
4. Run `npm run seed:inventory`.
5. Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in `server/.env`, then run `npm run seed:admin`. Public registration cannot create an admin.
6. Run `npm run dev`.
7. Frontend: `http://localhost:5173`; API health: `http://localhost:4000/api/health`.
8. Run `npm test`; run `npm run build` for the production client build.

After each PR, update this file with the merged SHA, exact checks actually completed, unresolved integration risks and the next step.
