# Pizza House — Full-Stack Pizza Ordering & Inventory

Pizza House is a MERN full-stack internship project for custom pizza ordering, secure accounts, inventory reservation, payment verification and live order tracking. The payment integration uses Razorpay Test Mode; this repository has not been certified for production payments.

## Features

### Customer experience
- Register and sign in with email verification, HttpOnly-cookie sessions, logout, forgot-password and reset-password.
- Browse featured pizzas, filter the menu, build a custom pizza, manage the cart and view server-calculated totals.
- Enter and validate recipient, mobile number and delivery address before creating a payable order; update destination details while payment is pending.
- Start Razorpay Test Mode checkout and retry server verification for the same payment when confirmation is uncertain, including after a page reload in the same browser tab/session.
- See saved delivery details in order history and authenticated Socket.IO order updates.
- Repeat delivered/cancelled orders from history using the current menu prices; unavailable ingredients are not silently substituted, and payment starts only after a new explicit checkout.
- Report a missing item, wrong item, food-quality concern or delivery delay against an eligible paid order; follow the case reference and see customer-visible updates from order history.

### Admin experience
- Separate admin login; public registration cannot create admin accounts.
- Inventory dashboard with stock/threshold edits and scheduled low-stock email alerts.
- Incoming-order queue, paid-order transition validation and operations summary.
- Customer issue queue with reference IDs, review/resolution states and customer-visible case updates.
- Payment-review queue for captured payments that cannot safely proceed to fulfillment.
- Guarded full-refund action for eligible payment-review orders. Refund requests use an idempotency key; uncertain/failed results remain recoverable, and inventory is released only after a confirmed full refund. Multiple-capture cases require manual reconciliation.

### Payment and inventory safety
- Server rebuilds order line items from the allowlisted catalog; client-provided prices and totals are not trusted.
- Ingredient stock is reserved using MongoDB transactions before checkout.
- Checkout verification checks the payment signature and independently verifies provider payment status, order linkage, amount and INR currency.
- Signed POST /api/payments/webhook validates the raw request body with the separate RAZORPAY_WEBHOOK_SECRET.
- Webhook event receipts make duplicate deliveries idempotent. payment.failed is not treated as final proof that an order can be released; late-capture attempts are protected by a conservative hold window.
- Captures that mismatch the order, amount, currency, active inventory reservation or required delivery details are placed in payment_review instead of being sent to the kitchen.
- Captured-payment verification exceptions create admin-visible review receipts; customers are told not to pay again when manual review is required.
- Invalid custom pizza options are returned as client validation errors instead of server errors.
- Before automatic refund recovery, the server checks Razorpay order payment history and blocks the refund unless exactly one captured payment matches the reviewed payment.
- Expired unpaid reservations are marked cancelled after safe reconciliation. Provider order references are retained so late captures can still be tied to the original order; uncertain provider state defers release.

## Technology
- Frontend: React, Vite
- Backend: Node.js, Express
- Database: MongoDB with Mongoose
- Payments: Razorpay Test Mode
- Realtime: Socket.IO
- Security: HttpOnly JWT cookie, password hashing, expiring hashed verification/reset tokens, auth rate limiting, admin-only routes and session-version invalidation
- Checks: Node.js test runner, client unit tests, Vite production build and GitHub Actions CI

## Run locally

### Requirements
- Node.js 22 recommended (the server requires Node.js 20.19+).
- MongoDB running as a replica set or a transaction-capable MongoDB Atlas cluster. Multi-document inventory updates require transaction support.
- Razorpay Test Mode credentials and SMTP details for testing actual checkout/email delivery.

### Setup
1. From the repository root, run `npm run setup:local`. It creates `server/.env` from the example only when needed and generates a strong local `JWT_SECRET` if the existing one is missing or a placeholder. It will not overwrite other values or modify an env file marked `NODE_ENV=production`. Generated secret values are not printed.
2. Install dependencies from the repository root: `npm run install:all`.
3. Configure `MONGODB_URI`, the exact app/frontend URLs, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` in `server/.env`. For actual email tests, add SMTP settings. For payments, use only Razorpay Test Mode keys (`rzp_test_...`) and set a separate `RAZORPAY_WEBHOOK_SECRET`. Do not send passwords or secret values in chat or commit them.
4. Run `npm --prefix server run qa:preflight` to check configuration shape. This does not test database reachability, SMTP delivery, Razorpay events or browser journeys; blank provider settings will block the full preflight until configured.
5. Seed inventory: `npm run seed:inventory`.
6. Seed the admin account after setting `ADMIN_EMAIL` and `ADMIN_PASSWORD`: `npm run seed:admin`.
7. Start the frontend and API: `npm run dev`.
8. Open http://localhost:5173; API health is at http://localhost:4000/api/health.

### Verify
Run `npm test` and `npm run build` from the repository root. GitHub Actions runs dependency installation, the configured test suite (including the disposable MongoDB integration test), and the production client build on pushes to main, feat/**, fix/**, build/**, and docs/**, and on pull requests targeting main.

The issue lifecycle integration test uses `mongodb-memory-server` with a disposable local MongoDB 7.0.14 instance. It verifies real index creation, customer ownership, admin-only access, issue status/message persistence, resolving and reopening a new case, and concurrent duplicate submissions. CI runs it automatically because GitHub Actions sets `CI=true`. To opt in locally from PowerShell:
```powershell
$env:RUN_MONGODB_INTEGRATION = "1"
npm test
Remove-Item Env:RUN_MONGODB_INTEGRATION
```
The first run downloads the temporary MongoDB binary. The test does not connect to your configured database or require Razorpay/SMTP credentials.

The issue-report dialog keyboard flow was checked in Chrome at 320px: initial focus, Tab/Shift+Tab containment, Escape close, focus restoration, and error-response containment passed. PR #33 verified success/error live-region semantics and selected form-control contrast (14.99:1 text, 3.41:1 field border). PR #35 fixed baseline axe-detected contrast on the pizza-card number, dashboard labels, caption and footer wordmark. PR #37 further fixed builder option prices, ingredient labels, checkout notes and admin metric labels; it also added authentication-dialog focus entry/trapping/Escape/restoration and mobile-navigation focus entry/return. A temporary Playwright + axe-core 4.10.3 harness reported zero WCAG 2.1 A/AA violations over 31 scans of home, menu, builder, populated cart, auth dialog, customer dashboard and admin dashboard after the fixes. Home/menu/builder/populated-cart had no horizontal overflow at 320, 360, 390, 640, 768, 1024 or 1440 CSS-pixel viewport widths. The 640px run was only a viewport size, not literal browser zoom. Some axe checks remain incomplete; actual screen-reader sessions, manual review, remaining 320px states and 200% browser zoom are still unverified.

Reproducible installs: the root, `server/`, and `client/` `package-lock.json` files are tracked together. `npm run install:all` uses `npm ci` for all three manifests, and CI caches all three lockfiles. The root, server and client clean installs passed on Node 22.22.2/npm 10.9.7; the full 142-test suite (including the disposable MongoDB integration test), production build, and all three npm audits passed. MongoDB, live Razorpay, and real SMTP/browser checkout still require configuration-backed end-to-end verification.

## Key API routes

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/auth/register | Register customer |
| POST | /api/auth/login | Customer sign-in |
| POST | /api/auth/admin/login | Admin sign-in |
| GET | /api/catalog | Get menu and options |
| POST | /api/orders | Create server-priced order with validated delivery details |
| GET | /api/orders/my | Customer order history |
| GET | /api/orders/:id | Read an order owned by the customer (admins can inspect any order) |
| PATCH | /api/orders/:id/delivery-details | Update destination while payment is pending |
| POST | /api/payments/create-order | Validate destination, reserve stock and create Razorpay order |
| POST | /api/payments/verify | Verify checkout payment and record captured exceptions for review |
| POST | /api/payments/webhook | Verify signed payment/refund webhook |
| GET | /api/admin/orders | Admin order queue |
| GET | /api/admin/payment-reviews | Captured-payment review queue |
| POST | /api/admin/orders/:id/refund | Request safe full refund for eligible review hold |
| PATCH | /api/admin/orders/:id/status | Advance a paid order through fulfillment |

## Razorpay webhook setup for integration testing

Configure the deployed API endpoint POST /api/payments/webhook in the Razorpay Dashboard, with payment.captured, payment.failed, refund.created, refund.processed and refund.failed enabled. Use the same separate webhook secret in the Dashboard and server/.env. Webhook delivery, real MongoDB transactions, real SMTP delivery and a complete browser-to-provider checkout journey still need configuration-backed end-to-end testing.

## Security and deployment notes
- Never commit .env files, provider credentials, real database exports or user data.
- Use HTTPS in deployment, exact allowed CORS origins, secure cookie settings, a verified email sender and restricted database network access.
- Use Razorpay Test Mode during assessment. Do not use production payment credentials until provider/webhook/refund procedures and the full end-to-end journey have been validated.
- A passing CI run proves the automated tests and client build passed; it does not prove external services are configured or the live checkout flow has been exercised.

## Verified repository status

- Latest merged application hardening commit: `3f6778f33136cd5beb42159d1aceaee3227321f3` (PR #18).
- PR #18 CI, tested against code SHA `e29bf1f78c9206c9d222d87dabb2c5bf5fb70aea`: [pull-request check](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39319853575) and [push check](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39319845265) both passed unit/smoke tests and production client build.
- These checks do not prove live MongoDB transaction behaviour, Razorpay payment/webhook/refund delivery, SMTP delivery or browser end-to-end success. Those remain in the final setup/integration phase.
- [Product discovery and differentiation roadmap](docs/PRODUCT_DISCOVERY.md) captures the research sources, code-audit findings, UI contract, prioritized feature backlog and test discipline.
- See PROJECT_STATUS.md for current verification evidence and remaining integration work.
