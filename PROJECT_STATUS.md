# Project Status — Pizza House

Last updated: 2026-10-19 — assessment-readiness pass

## Git state
- Repository: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application
- Baseline main HEAD before this change: `038cb936768eeb53f73098951f0ba5101aff15ec`.
- Working branch for this review: `fix/assessment-readiness`.
- Do not claim this branch is merged until its PR state and main HEAD are re-fetched and verified.

## Implemented scope
- React/Vite ordering UI, custom pizza builder, cart/checkout, customer order polling, separate admin page, inventory editor and order management.
- Express/Mongoose auth/email flows, server-owned catalog pricing, order/payment APIs, transactional ingredient holds and scheduled low-stock mail.
- Razorpay test-mode guard, HMAC/provider payment checks, safe reservation reconciliation, HttpOnly sessions and password-reset session invalidation.
- This assessment pass extracts order-line pricing and fulfillment status transitions into pure tested rules; malformed order bodies should return controlled 400 errors rather than runtime 500s.
- Production CORS config now requires exact HTTPS origins; production app base URLs must be HTTPS origins, with trailing slashes normalized for link generation.

## Verification
- Local automated tests after this pass: `npm test` — **38 passed, 0 failed**.
- JavaScript `node --check`, JSX syntax transpilation and CSS parsing passed.
- Production build intentionally skipped per owner instruction; it has not been claimed as passing.
- Full MongoDB transaction, SMTP delivery and Razorpay test-mode end-to-end flows have not been exercised with external services.
- GitHub Actions has no configured workflow/checks for the repository; local tests are not a GitHub Actions result.

## Local setup
1. Copy `.env.example` to `server/.env`; copy `client/.env.example` to `client/.env` only if changing the API URL.
2. Configure replica-set MongoDB, unique JWT secret, verified SMTP sender and Razorpay test keys only.
3. `npm run install:all`; `npm run seed:inventory`.
4. Set `ADMIN_EMAIL` / strong `ADMIN_PASSWORD` in `server/.env`; run `npm run seed:admin`.
5. `npm run dev`; tests: `npm test`.

## Required before claiming fully tested
- Run the app against a transaction-capable MongoDB instance and test sign-up → verify email → login → custom pizza → checkout → server payment verification → admin status change → user polling.
- Exercise SMTP failure, expired reset/verification tokens, low-stock alert delivery, out-of-stock race, payment API failure, duplicate payment callbacks and reservation reconciliation.
- Add and test a signed Razorpay webhook before production payment traffic.
- Verify the deployment uses HTTPS, exact CORS origins, verified sender, test keys for assessment and restricted database access.
- Keep this file current after each PR with actual commit SHA, tests that ran, known gaps and exact next action.