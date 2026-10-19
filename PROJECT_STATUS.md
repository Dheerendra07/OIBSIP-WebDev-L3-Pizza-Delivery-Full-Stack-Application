# Project Status — Pizza House

Last updated: 2026-10-19

## Repository / Git state
- Repository: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application
- Working branch: `feat/pizza-platform-foundation`.
- Initial feature commit: `7a114303344830292a1d0362ca92d293ce82ebe9` (`feat: add pizza ordering and inventory platform`).
- PR review is the next step. `main` has not been changed by this feature commit; integrate through a reviewed PR.
- Repository is public by owner choice.

## Implemented scope
- React/Vite ordering UI: featured menu and filters, custom pizza builder, cart/checkout, customer order dashboard with polling, admin inventory and order management.
- Express/Mongoose API: registration, email verification, user and separate-admin login, password-reset flow, server-owned catalog/pricing, order/payment endpoints, admin inventory/order updates.
- Ingredient stock reservation uses MongoDB transactions; reservation expiry reconciliation checks provider status and conservatively preserves stock for uncertain/mismatched captured payments.
- Razorpay test-mode guard, HMAC signature verification, provider captured status + order + amount + currency validation.
- HttpOnly session cookie, hashed expiring verification/reset tokens, password reset session-version invalidation and auth/admin route protection.
- Scheduled low-stock notifications; config validation, seed scripts, `.env.example`, team contribution rules, architecture notes and PR template.

## Verification truth
- `npm test`: **30 passed, 0 failed** locally.
- `node --check` on source JavaScript: passed.
- JSX syntax transpilation and CSS parsing: passed (syntax-only).
- Production build: intentionally skipped per owner request.
- Dependency installation previously failed with npm registry DNS/network error `EAI_AGAIN`; no production bundle was built.
- MongoDB replica-set transaction flow, actual SMTP delivery and Razorpay test checkout have **not** run end-to-end. Do not claim production readiness.

## Local setup
1. Copy `.env.example` to `server/.env` and `client/.env.example` to `client/.env`.
2. Configure transaction-capable MongoDB, SMTP, a strong JWT secret and Razorpay test credentials only.
3. Run `npm run install:all`.
4. Run `npm run seed:inventory`.
5. Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in `server/.env`; run `npm run seed:admin`.
6. Run `npm run dev`; execute unit tests with `npm test`.

## Limitations / next checks
- MongoDB transactions require a replica-set-capable deployment (for example MongoDB Atlas).
- Before production traffic, add and verify a signature-checked Razorpay webhook and test provider outage/refund/reconciliation paths.
- Configure HTTPS, exact CORS origins, a verified SMTP sender and database network access restrictions before deployment.
- Full end-to-end checkout, auth/email, inventory contention and real order status polling remain unverified because runtime dependencies/integrations could not be exercised in this environment.
- This handoff file must be updated after every merge with the merged commit SHA, actual tests, unresolved defects and exact next step.