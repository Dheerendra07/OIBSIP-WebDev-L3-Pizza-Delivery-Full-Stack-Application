# Project Status — Pizza House

Last updated: 2026-10-19

## Repository / branch
- Repository: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application
- Working branch: `feat/pizza-platform-foundation` (default `main` must remain untouched until review).
- Scope: React/Vite UI + Express/Mongoose API for pizza menu/builder, user/admin access, inventory, Razorpay test checkout, low-stock email, and order polling.

## In this implementation
- Responsive menu, custom builder, cart, customer dashboard and admin inventory/order management.
- Server-side catalog/pricing validation and MongoDB transaction-based ingredient reservations.
- Email verification/reset with hashed expiring tokens; HttpOnly JWT cookie and session-version invalidation after password reset.
- Razorpay test-mode guard, HMAC signature validation, provider captured status/order/amount/currency checks and conservative expired-reservation reconciliation.
- Scheduled low-stock notification, team contribution guide, architecture doc, `.env.example` files, tests and PR template.

## Verification truth
- Previously run locally: 30/30 unit tests passed; JS syntax, JSX syntax transpilation and CSS PostCSS parse passed.
- Build command intentionally skipped per owner request.
- Dependency install was blocked by npm registry DNS/network error (`EAI_AGAIN`); no production bundle has been built.
- Real MongoDB replica-set transaction flow, SMTP delivery and Razorpay test checkout have NOT been run end-to-end. Do not claim production readiness.
- Re-fetch the remote branch tree and compare the changed files after pushing; GitHub remote state is authoritative.

## Local setup
1. Copy `.env.example` to `server/.env` and `client/.env.example` to `client/.env`.
2. Configure MongoDB that supports transactions, SMTP, strong JWT secret and Razorpay test keys only.
3. Run `npm run install:all`, `npm run seed:inventory`, then configure `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `server/.env` and run `npm run seed:admin`.
4. Run `npm run dev`; tests use `npm test`. Build intentionally not run.

## Limitations / next checks
- MongoDB inventory transaction requires a replica set (Atlas supports this).
- Before production traffic, add a signature-verified Razorpay webhook and test provider outage/refund/reconciliation paths.
- Configure HTTPS, exact CORS origins, proper SMTP sender and database network rules before deployment.
- After dependency/network access is available, run end-to-end tests against MongoDB replica set + Razorpay test credentials + SMTP; update this file with only the tests that actually ran.
