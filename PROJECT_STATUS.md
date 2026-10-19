# Project Status — Pizza House

Last updated: 2026-10-19 — post-assessment hardening

## Git state (verified)
- Repository: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application
- Default branch: `main`.
- Feature PR #1 merged: `21d7d4764507f063d2c721296d7bcca3b9bcd7bf`.
- Handoff PR #2 merged: `038cb936768eeb53f73098951f0ba5101aff15ec`.
- Assessment hardening PR #3 merged: `f030d0baf054208bfb8f700d4c44cbd2387f811d`.
- The current main HEAD was re-fetched after PR #3 and matched the merge commit.
- Repository is public by owner choice; no real `.env` credentials or database exports are committed.

## Implemented
- React/Vite ordering UI: featured menu, filters, custom pizza builder, cart, checkout, customer order history with polling, admin inventory/order management.
- Express/Mongoose API: account registration, email verification, customer and separately seeded admin login, password reset, catalog, orders, payment verification, inventory updates and admin status transitions.
- Server-owned catalog pricing and order-line rules; user-supplied price/total/inventory fields are ignored.
- Ingredient stock is reserved inside MongoDB transactions before opening checkout. Razorpay test payments are verified server-side using HMAC plus provider capture status, order linkage, amount and INR currency.
- Checkout retry reuses the existing pending order only when the cart's quantities, ingredients and server price still match.
- Expired stock reservations are reconciled against provider payment status before release; uncertain/mismatched captured payments preserve the hold for manual review.
- HttpOnly JWT cookie, hashed expiring verification/reset tokens, password-reset session-version invalidation, auth rate limiting, and admin route authorization.
- Scheduled low-stock emails, separately seeded admin/inventory scripts, production config guards, API/architecture/contribution docs, and assessment-oriented README.

## Latest assessment hardening
- Order input/pricing calculation and admin fulfillment transitions are extracted into deterministic unit-tested rules.
- Invalid/missing order collections and invalid line counts return a controlled 400 error rather than a runtime 500.
- Production `CLIENT_ORIGIN` requires comma-separated exact HTTPS origins (no wildcard/path); frontend/API base URLs must be HTTPS origins. Trailing slashes are normalized while building email links.

## Verification (do not overstate)
- Local `npm test`: **38 passed, 0 failed** after the latest hardening changes.
- JavaScript `node --check`: passed.
- JSX syntax transpilation and CSS parsing: passed (syntax-only checks).
- Production build: intentionally skipped per owner request; it has not been claimed as passing.
- GitHub Actions checks/workflows: none configured for this repository; the above are local results, not GitHub Actions results.
- End-to-end MongoDB replica-set transactions, real SMTP delivery, Razorpay test checkout and full customer→admin UI journey have not been run with external services. These remain the main validation gap.

## Local setup
1. Copy `.env.example` to `server/.env`; copy `client/.env.example` to `client/.env` only if overriding the local API URL.
2. Configure MongoDB with transaction support, a unique strong JWT secret, SMTP sender credentials and Razorpay **test** keys only.
3. Run `npm run install:all`.
4. Run `npm run seed:inventory`.
5. Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in `server/.env`; run `npm run seed:admin`.
6. Run `npm run dev`; frontend is `http://localhost:5173`, health endpoint `http://localhost:4000/api/health`.
7. Run tests with `npm test`.

## Remaining before calling it fully tested
- Exercise registration → verification → login → build pizza → create order → Razorpay test payment → server verification → order tracking → admin progression using configured test services.
- Exercise stock contention/out-of-stock, SMTP outage, low-stock alert cooldown, provider timeout, failed payment, duplicate callback and expired reservation cases.
- Add/test a signed Razorpay webhook and refunds/reconciliation before production payment traffic.
- Deployment still needs HTTPS, exact CORS origins, verified `MAIL_FROM`, secure cookies, and restricted MongoDB network access.
- After each PR, update this file with the merged SHA, exact tests actually run, unresolved defects and next step.