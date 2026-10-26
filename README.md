# Pizza House

**Pizza House** is a full-stack pizza ordering and restaurant-operations application built with React, Express, MongoDB and Razorpay. It has a deployed web/API service and customer, admin, kitchen and delivery-staff workflows. It is still in **launch-preparation**, not certified for accepting real customer payments or operating a real delivery business: the configured payment path and order progression used for validation are in Razorpay Test Mode / sandbox simulation.

- **Hosted app:** https://pizza-house-api.onrender.com
- **Current implementation, verification evidence and launch blockers:** [PROJECT_STATUS.md](PROJECT_STATUS.md)
- **Product research and roadmap:** [docs/PRODUCT_DISCOVERY.md](docs/PRODUCT_DISCOVERY.md)
- **Same-origin Render setup:** [docs/RENDER_SAME_ORIGIN_DEPLOYMENT.md](docs/RENDER_SAME_ORIGIN_DEPLOYMENT.md)

## What is implemented

### Customer ordering
- Responsive React/Vite experience with Light and Night themes, a featured pizza menu, category filters, recipe-backed ingredient labels, pizza detail views, custom-pizza builder, cart and checkout.
- Customer registration, email verification, sign-in, logout, forgot/reset password, and cookie-based sessions.
- Server-authoritative order prices and recipe validation. The server does not trust prices or totals supplied by the browser.
- Required delivery recipient, Indian mobile number, street address, city, state and PIN code are validated and stored with the order; destination details can be corrected while payment is pending.
- Basket and pending-order recovery, checkout idempotency, explicit confirmation when the server quote differs from the visible cart, and retry handling when payment verification is uncertain.
- Customer order history, order-status timeline with recorded milestone times, authenticated real-time refresh events, safe repeat-order from the current catalog, and customer support reports for eligible paid orders.

### Admin and restaurant operations
- Separate admin sign-in; public registration cannot create an admin or staff account.
- Admin summary, inventory/threshold editing, low-stock scan/notification job, incoming orders and payment-review queue.
- Customer issue queue with reference IDs, review/resolution states and customer-visible updates.
- Guarded refund workflow for eligible payment-review cases. The code uses provider idempotency and does not release inventory until a full refund is confirmed; ambiguous or multiple-capture cases need manual review.
- Staff management: admin can create kitchen/delivery staff, assign paid orders to them, and disable accounts.
- Staff sign-in and role-filtered kitchen and delivery queues. Staff accounts must change their temporary password at first sign-in; disabling an account revokes its active session.
- Kitchen preparation details/tickets and staged handoff. Order status transitions are checked server-side rather than trusting the UI.

### Payment, inventory and security controls
- Razorpay Test Mode checkout with payment-signature checking and independent provider-state, order-linkage, amount and INR-currency checks.
- Signed webhook endpoint with event receipts to make duplicate webhook deliveries idempotent; a payment.failed event alone is not treated as proof that a late capture cannot occur.
- Inventory reservation and cautious expiry/late-capture reconciliation; uncertain payment/provider state preserves review or inventory holds instead of automatically treating the order as safely cancelled.
- Payment-review handling for captured payments whose order, amount, currency, delivery details, reservation or capture history cannot safely proceed.
- Auth rate limiting, hashed expiring verification/reset tokens, HttpOnly session cookies, server-side role checks, session-version invalidation, security headers and constrained error logging.
- CI workflows for tests, dependency/security checks, production client build, hosted browser smoke and deployed API smoke checks.

## Fulfillment modes: important distinction

The application now has separate admin, kitchen and delivery workflows. That does **not** mean a real kitchen or driver has been contacted.

- **Test Mode:** when both the configured application mode and the order payment mode are Test Mode, order stages can be advanced as an explicitly simulated workflow. UI messages identify the simulation; no real kitchen or delivery partner is contacted.
- **Live Mode:** server guardrails require a matching Live Mode configuration and order before a live fulfillment transition can proceed. The real-money checkout, actual provider webhook/refund journey and operating restaurant delivery have **not** been certified by these checks.
- **Real-world setup still needed:** actual staff accounts and training, kitchen preparation/acceptance process, delivery coverage and fees, customer-facing delivery estimates, notification delivery, support/refund policy, and verified payment/email provider configuration. Do not present a simulated status as a real delivery.

## Technology

| Area | Implementation |
|---|---|
| Customer and operations UI | React, Vite, CSS |
| API | Node.js, Express |
| Data | MongoDB, Mongoose |
| Payment integration | Razorpay SDK (Test Mode for current validation) |
| Live UI refresh | Socket.IO |
| Authentication | JWT in HttpOnly cookies, password hashing, expiring tokens |
| Tests | Node.js test runner, client tests, disposable MongoDB integration tests, Playwright hosted browser smoke |
| Hosting | Render API service serves the built UI and API from one origin |

The server requires **Node.js 20.19+**; Node.js 22 is recommended. MongoDB must support transactions (a replica set or compatible MongoDB Atlas deployment) because inventory/order writes span multiple documents.

## Run locally (Windows PowerShell)

1. Clone the repository and open PowerShell at its root.
2. Run the guided local configuration. It creates/preserves server/.env, generates a local JWT secret where needed, masks sensitive prompts and never prints entered secrets:

       npm run setup:local

3. Enter your own configuration directly in the terminal. Use a transaction-capable MongoDB URI, your own admin email/password, an email provider configuration, and **Razorpay Test Mode** keys only. Never paste secrets into an issue, pull request, chat or commit.
4. Install the three locked dependency sets:

       npm run install:all

5. Start the API and UI:

       npm run dev

6. Open http://localhost:5173. The development API health route is http://localhost:4000/api/health.

The setup preflight validates configuration shape; it does not itself prove database connectivity, email delivery, payment checkout or webhook configuration. After adding Test Mode Razorpay credentials, run the following from the repository root. It makes a read-only provider request to check the key pair; it does not create an order, charge a payment or create a refund.

    node server/scripts/razorpay-test-preflight.js

### Useful commands

    npm run install:all
    npm test
    npm run build
    npm run setup:local

The disposable MongoDB integration tests are run by CI. To opt in locally from PowerShell:

    $env:RUN_MONGODB_INTEGRATION = "1"
    npm test
    Remove-Item Env:RUN_MONGODB_INTEGRATION

The first integration run downloads its temporary MongoDB binary. It does not connect to the database configured in server/.env.

## Important API routes

All routes below are under /api.

| Method | Route | Purpose |
|---|---|---|
| GET | /catalog | Public menu, recipes and options |
| POST | /auth/register | Customer registration |
| POST | /auth/login | Customer sign-in |
| POST | /auth/admin/login | Admin sign-in |
| POST | /auth/staff/login | Kitchen/delivery staff sign-in |
| POST | /auth/staff/change-password | Mandatory staff password rotation |
| POST | /orders | Create a server-priced order with delivery details |
| GET | /orders/my | Authenticated customer's order history |
| POST | /payments/create-order | Reserve stock and create a payment order |
| POST | /payments/verify | Verify payment and reconcile captured exceptions |
| POST | /payments/webhook | Verify signed payment/refund webhook |
| GET / PATCH | /admin/orders, /admin/orders/:id/status | Admin queue and guarded status transitions |
| GET / POST | /admin/staff | List/provision kitchen and delivery staff |
| PATCH | /admin/orders/:id/assignments | Assign a paid order to staff |
| GET / PATCH | /ops/orders, /ops/orders/:id/status | Role-filtered kitchen/delivery queue and transitions |
| GET / PATCH | /admin/inventory | Admin inventory view / stock thresholds |
| GET / PATCH | /admin/issues | Admin customer-issue queue and case updates |
| GET | /admin/payment-reviews | Captured-payment review queue |
| POST | /admin/orders/:id/refund | Guarded full-refund recovery for eligible review cases |

## Verification and launch status

The current application/runtime revision fd12cd3 is live on Render deployment dep-dbffouavcj2c738063ug. Render auto-deploy is disabled, so this was manually deployed. The later 452a647 commit adds tests only and does not change the running application.

- [Main CI 40284510500](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40284510500): **254/254 tests passed; 0 failures**, including a disposable MongoDB / real Express HTTP integration path for payment-review support-case creation, customer/admin visibility and preserved fulfillment hold.
- [Deployed API/revision smoke 40284510512](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40284510512): **16/16 passed** for the exact deployed revision, database readiness/catalog, CORS, auth guards, webhook guard and production bundle.
- [Hosted browser smoke 40283837344](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40283837344): **76/76 passed**, including loaded distinct food photos, working product details, Light/Night mode, responsive widths 320–1440px, checkout recovery and the synthetic payment-review support flow.

The latest support work adds distinct **Damaged or spilled item** and **Payment or refund question** categories. Payment/refund cases are allowed for payment-review, failed and refunded order states without bypassing fulfillment holds; the form explicitly states that support does not automatically issue a refund. The integration test uses a disposable MongoDB database in CI, not the production Atlas instance.

**This is still a product foundation, not a certified live delivery business.** Browser checkout/payment/staff sessions are mocked, and deployed smoke probes safe routes only. Real Razorpay-originated payment/webhook/refund reconciliation, actual SMS/email delivery, production staff accounts, real kitchen acceptance and driver dispatch remain unverified. The OTP disclosure refers to the checkout Test Mode simulation: it sends no SMS and does not charge real money. Keep Live Mode disabled until provider/notification operations and real fulfillment acceptance tests are complete; detailed follow-up is in [PROJECT_STATUS.md](PROJECT_STATUS.md).
## Security basics

- Keep server/.env, API keys, webhook secrets, database credentials, user exports and customer personal data out of Git.
- Use HTTPS, exact allowed origins, secure cookies, restricted database network access and a verified sender identity.
- Use Test Mode during development/assessment. Rotate any credential that has been exposed.
- Never run destructive inventory, customer, order or admin-data changes against the production database for a smoke test.
