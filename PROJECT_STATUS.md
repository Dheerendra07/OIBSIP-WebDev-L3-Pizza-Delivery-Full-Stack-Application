# Project Status — Pizza House

Last updated: 2026-10-19 (post-merge handoff)

## Repository / Git state
- Repository: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application
- Default branch: `main`.
- Merged PR: [#1 — feat: add pizza ordering and inventory platform](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/1).
- Verified main merge commit: `21d7d4764507f063d2c721296d7bcca3b9bcd7bf`.
- Implementation branch: `feat/pizza-platform-foundation` (source integrated through PR #1).
- This repository is public by owner choice.

## Implemented scope
- React/Vite ordering UI: featured menu and filters, custom pizza builder, cart/checkout, customer order dashboard with polling, admin inventory and order management.
- Express/Mongoose API: registration, email verification, user and separate-admin login, password-reset flow, server-owned catalog/pricing, order/payment endpoints, admin inventory/order updates.
- Ingredient stock reservation uses MongoDB transactions; reservation expiry reconciliation checks provider status and conservatively preserves stock for uncertain/mismatched captured payments.
- Razorpay test-mode guard, HMAC signature verification, provider captured status + order + amount + currency validation.
- HttpOnly session cookie, hashed expiring verification/reset tokens, password reset session-version invalidation and auth/admin route protection.
- Scheduled low-stock notifications; config validation, seed scripts, `.env.example`, team contribution rules, architecture notes and PR template.

## Verification truth
- Local `npm test`: **30 passed, 0 failed**.
- `node --check` on source JavaScript: passed.
- JSX syntax transpilation and CSS parsing: passed (syntax-only).
- Production build: intentionally skipped as instructed. No claim that Vite production build passed.
- Dependency installation previously failed with npm registry DNS/network error `EAI_AGAIN`; no production bundle was built.
- MongoDB replica-set transaction flow, real SMTP delivery and Razorpay test checkout have **not** run end-to-end. Do not describe production readiness as verified.
- GitHub Actions: no workflow runs/checks exist for this repo yet; the PR was merged without automated GitHub checks. Unit tests/syntax checks mentioned above were run locally.

## Local setup
1. Copy `.env.example` to `server/.env` and `client/.env.example` to `client/.env`.
2. Configure transaction-capable MongoDB, SMTP, a strong JWT secret and Razorpay test credentials only.
3. Run `npm run install:all`.
4. Run `npm run seed:inventory`.
5. Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in `server/.env`; run `npm run seed:admin`.
6. Run `npm run dev`; execute unit tests with `npm test`.

## Remaining integration risks / next actions
- MongoDB transactions require a replica-set-capable deployment (for example MongoDB Atlas).
- Before production traffic, add and verify a signature-checked Razorpay webhook and test provider outage/refund/reconciliation paths.
- Configure HTTPS, exact CORS origins, a verified SMTP sender and database network access restrictions before deployment.
- Run end-to-end checkout, auth/email, inventory contention and order-status polling tests when dependencies and test services are configured.
- Keep README and this file aligned as work evolves; after each feature/bug PR, record its merge SHA, tests that actually ran, open defects and exact next task.