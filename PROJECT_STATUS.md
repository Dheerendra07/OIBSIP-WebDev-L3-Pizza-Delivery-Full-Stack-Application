# Project Status — Pizza House

Last updated: 2026-10-19 — authenticated live order tracking merged

## Git state (verified)
- Repository: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application
- Default branch: `main`.
- Feature PR #1, handoff PR #2, assessment hardening PR #3, and status PR #4 are merged.
- Socket.IO live order tracking PR #5 is merged as commit `fb3baf38ba2926c033ea1a11e93e6f1350c15d77`.
- The verified `main` HEAD is `fb3baf38ba2926c033ea1a11e93e6f1350c15d77`.
- Repository is public by owner choice; no real `.env` credentials or database exports are committed.

## Implemented
- React/Vite customer UI: featured menu, filters, custom pizza builder, cart, checkout, order history, authentication and password reset.
- Express/Mongoose API: registration and email verification, customer and separately seeded admin sign-in, catalog, order creation, payment verification, inventory updates and admin order transitions.
- Admin dashboard: inventory levels/thresholds, low-stock alerts, order queue and summary metrics.
- Server-owned catalog pricing and order-line validation; client-provided prices and totals are not trusted.
- Ingredient stock is reserved inside MongoDB transactions before checkout. Razorpay test payments are verified server-side using HMAC plus provider capture status, order linkage, amount and INR currency.
- Checkout retry reuses an existing pending order only when cart choices and server pricing still match.
- Expired stock reservations are reconciled against provider payment status; uncertain or mismatched captured payments preserve the hold for later review.
- HttpOnly JWT session cookie, hashed expiring verification/reset tokens, password-reset session-version invalidation, auth rate limiting and admin route authorization.
- Authenticated Socket.IO live order tracking. The server validates the exact allowed origin and current database user/session, derives user/admin rooms server-side, and publishes minimized order updates after relevant persisted order/payment/status changes.
- The frontend re-fetches REST state on socket connection/reconnection and relevant events, so REST remains the source of truth if a realtime event is missed.
- GitHub Actions workflow runs the test suite and production frontend build on pushes to `main`, `feat/**`, `fix/**` and pull requests targeting `main`.

## Latest verification (checked 2026-10-19)
- Socket.IO feature-branch GitHub Actions run [39227920902](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39227920902): passed. The unit-test step and production frontend build step both completed successfully.
- Merged `main` GitHub Actions run [39232381239](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39232381239): passed. Dependency installation, unit tests and production frontend build completed successfully.
- Earlier assessment hardening local verification: 38 tests passed, 0 failed before Socket.IO was added. Do not report this older count as the current suite's test count.
- These CI checks do not establish full external-service or browser end-to-end correctness.

## Remaining before calling it fully end-to-end tested
- Run a configured browser journey: register → verify email → sign in → build pizza → create order → Razorpay test payment → verify payment → see live order updates → advance order from the admin session.
- Exercise MongoDB replica-set transactions, concurrent stock contention/out-of-stock, SMTP delivery and outage behavior, Razorpay timeout/failure/duplicate callbacks, and expired-reservation reconciliation.
- Test Socket.IO behavior with two separate customer sessions and an admin session, including logout/password-reset session invalidation, rejected origins and reconnect after a dropped connection.
- Add and test a signature-verified Razorpay webhook plus audited refund/reconciliation procedures before any production payment traffic.
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
