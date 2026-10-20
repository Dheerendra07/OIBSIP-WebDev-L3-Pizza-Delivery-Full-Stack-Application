# Project Status — Pizza House

Last updated: 2026-10-20

## Current Git state

- Product-discovery plan: [docs/PRODUCT_DISCOVERY.md](docs/PRODUCT_DISCOVERY.md). Shared card states/catalog gating landed in PR #20; server-quote confirmation landed in PR #21. PR #22 completes the source-level readability/touch-target pass; rendered-browser accessibility QA remains pending.

- Repository: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application
- Default branch: `main`.
- Latest merged code commit: `30e526c10e867c73a22e6eaa2ffcbb1e05b69ff2` — order issue reporting and admin case queue (PR #27). Reproducible npm lockfiles and `npm ci` are in PR #26; safe repeat-order and Nodemailer security fix are in PRs #23 and #24.
- Delivery details collection and persistence merged in PR #16.
- Trust/safety PRs merged: #12 late-capture inventory hold, #13 signed Razorpay webhook reconciliation, #15 guarded admin full-refund recovery, #16 delivery destination fields, #17 checkout/recovery hardening, #18 custom-pizza validation/provider capture-history checks, #20 shared card loading/error states and live catalog gating, and #21 explicit server-quote confirmation before payment, #23 live-catalog-based repeat order, and #24 Nodemailer security-range upgrade, plus #27 authenticated order-issue reporting and admin case management.
- PR #14 was a stale status-document snapshot and is closed as superseded.
- Historical Socket.IO live order tracking merge: `fb3baf38ba2926c033ea1a11e93e6f1350c15d77`.
- Historical Socket.IO session-expiry hardening merge: `71d18fec59dd4106a43d6efd34327639035a7a25`.
- Order-list skeletons reserve space for the repeat-order footer to reduce layout shift; the footer shape is hidden from assistive technology as decorative loading UI.
- Safe repeat-order is the customer order-history feature in PR #23: it rebuilds delivered/cancelled orders using the current catalog, refuses partial restores or substitutions when recipes/options are missing or unavailable, and keeps payment checkout as a separate explicit action.
- Verification outside GitHub Actions: isolated utility tests passed 10/10; full `npm test` passed 124/124 and Vite production build passed in a remote workspace using Node 26.8.2/npm 12.2.0. Chrome rendered the home page, order history, and repeat-order cart with deterministic mocked API responses at desktop and 390px mobile; no page errors were recorded, and mobile document width matched scroll width (390px). These are UI/component checks, not live API/payment proof.
- Nodemailer is now declared as `^10.1.7` after PR #24. The isolated upgrade verification passed 124/124 tests, production build, and `npm audit --prefix server` with zero reported vulnerabilities; real SMTP provider delivery still needs a configuration-backed test.
- Reproducible dependency installation now uses root/server/client lockfileVersion 3 manifests and `npm run install:all` runs `npm ci` in all three packages. Clean install, full tests (124/124), production build and root/server/client audits (0 vulnerabilities each) passed on Node 22.22.2/npm 10.9.7 outside GitHub Actions.
- PR #27 adds authenticated issue reports for eligible paid orders, a partial unique index for one active case per order/customer, an admin queue with `open → under_review → resolved` transitions, and customer-visible updates. Validation uses allowlisted bodies and does not issue refunds. Isolated Node 22.22.2/npm 10.9.7 verification: `npm test` 141/141, production build passed, root/server/client audits reported zero vulnerabilities, and unauthenticated customer/admin issue endpoints returned 401. Chrome tested report submission → admin review/message → customer refresh using mocked API responses; no page errors and no 390px horizontal overflow. Live MongoDB/provider/email behaviour remains unverified.
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
- Before Razorpay is opened, checkout compares the visible cart against the server-priced order; changed prices, totals, or recipe details require explicit review. Accepting only updates the cart; a second explicit checkout action is required to open payment.
- Authenticated Socket.IO updates with role-derived rooms, session-expiry checks and REST refresh on reconnect.
- Admin inventory controls, low-stock notification job and fulfillment status transition validation.
- CI installs root/server/client dependencies, runs the configured server/client test suite and builds the production client. A passing CI run is not the same as live end-to-end verification.

## Latest verified automated checks

- PR #27 verification on the merged source: 141/141 tests passed; production client build passed; root/server/client npm audits reported zero vulnerabilities; unauthenticated customer/admin issue routes returned HTTP 401; issue submission/admin review/customer refresh was exercised in Chrome with mocked API responses.
- PR #26 reproducible installs: root, server and client `package-lock.json` generated with npm 10.9.4 (lockfileVersion 3); `npm run install:all` executed clean `npm ci` installs on Node 22.22.2/npm 10.9.7. At that checkpoint, 124/124 tests, Vite production build, and all three audits passed. This verification ran in an isolated workspace, not via GitHub Actions.
- Latest non-GitHub-Actions verification for the merged PR #23 + #24 source: full `npm test` passed 124/124; `npm run build` succeeded; `npm audit --prefix server` reported 0 vulnerabilities for Nodemailer `^10.1.7`. Chrome rendered home, desktop/mobile order history, and repeat-order cart with mocked API responses; no page errors, and 390px viewport width matched document scroll width. External MongoDB, SMTP delivery, Razorpay, and production deployment were not tested.
- PR #22 source commit: `652c2bd7489372e24671cfd9f9dbefe78d4f52be` — GitHub Actions run `39448534587` passed dependency installation, the configured client/server test suite, and the production client build for the P0.3 readability, touch-target, and responsive inventory-field changes. Follow-up commits in PR #22 synchronize the status and roadmap documentation.
- PR #21 price-confirmation head: `657607ce4d462cbedf95f504cdc24266dad5d6fc` — GitHub Actions run `39447782348` passed dependency installation, the configured test suite, and production build.
- PR #18 code head: `e29bf1f78c9206c9d222d87dabb2c5bf5fb70aea`.
- Pull-request check: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39319853575 — passed.
- Push check: https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39319845265 — passed.
- Both checks completed dependency installation, configured tests/smoke checks and the production client build successfully.
- They do not verify external MongoDB, Razorpay, SMTP or deployed-browser behaviour.

- Complete accessibility QA beyond the visual preview: keyboard-only journey, focus visibility, contrast, screen-reader announcements, 320px viewport, and 200% text zoom. Repeat-order and issue-reporting flows were visually exercised with mocked API responses; checkout, database and real email/provider workflows remain pending.

## Final setup and end-to-end verification — still pending

1. Complete configuration-backed verification with MongoDB replica-set transactions, Razorpay Test Mode capture/webhook/refund paths, SMTP sends and the full browser journey. The reproducible-install change was validated separately on Node 22.22.2/npm 10.9.7 with `npm ci`, all tests, build and audits before inclusion here.
2. Configure a transaction-capable MongoDB replica set/Atlas environment and seed inventory; test concurrent stock contention, sold-out items and expired reservations.
3. Configure Razorpay Test Mode keys and the separate webhook secret; test checkout capture, invalid signature, duplicate and out-of-order webhook delivery, ambiguous verification, multiple captured payments, refunds and retry/reconciliation.
4. Run the browser journey: register → email verification → login → choose/build pizza → enter address → create order → payment → customer order history → admin fulfillment.
5. Confirm pending payment recovery after reload; test cancelled expired orders and captured payments routed to manual review without asking the customer to pay twice.
6. Verify SMTP email verification/reset/low-stock notification and provider outage behaviour.
7. Test customer/admin Socket.IO updates, reconnect, logout/session expiry, and make sure private order events stay scoped to the right sessions.
8. Validate production HTTPS, exact CORS origins, secure cookie policy, environment variables, health endpoint and server logs.
9. Complete rendered-browser accessibility checks: contrast, keyboard-only order journey, focus visibility, screen-reader loading announcements, text zoom, and layout at 320px/200% zoom.

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
