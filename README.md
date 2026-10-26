# Pizza House

**Pizza House** is a full-stack pizza ordering and restaurant-operations application built with React, Express, MongoDB and Razorpay. It has a deployed web/API service and customer, admin, kitchen and delivery-staff workflows. It is still in **launch-preparation**, not certified for accepting real customer payments or operating a real delivery business: the configured payment path and order progression used for validation are in Razorpay Test Mode / sandbox simulation.

- **Hosted app:** https://pizza-house-api.onrender.com
- **Current implementation, verification evidence and launch blockers:** [PROJECT_STATUS.md](PROJECT_STATUS.md)
- **Latest release evidence (26 Oct 2026):** [CI passed](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40342868131), [deployed smoke checks passed](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40342868168), and [hosted real-browser smoke passed](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40342868655) on runtime commit `a6611fa`. Render deployment [dep-dbfmfsrrjlhs73emicd0 is live](https://dashboard.render.com/web/srv-dbca9guq1p3s73cprrl0). The browser run covers menu/detail, Light/Night themes, responsive layouts, loaded featured food photos, image fallback, checkout recovery simulations, customer-confirmed delivery, and admin retryable-notification diagnostics. Auth, checkout and staff/order lifecycle use synthetic/mocked data; this does not prove a real-money transaction, real inbox delivery or physical fulfillment.
- **Product research and roadmap:** [docs/PRODUCT_DISCOVERY.md](docs/PRODUCT_DISCOVERY.md)
- **Same-origin Render setup:** [docs/RENDER_SAME_ORIGIN_DEPLOYMENT.md](docs/RENDER_SAME_ORIGIN_DEPLOYMENT.md)

## What is implemented

### Customer ordering
- **Menu expansion (26 Oct 2026):** Margherita Classic, Garden Party, Firecracker, White Garden, Pesto Forest, Roasted Garden, Cornfire and Olive Atelier. Featured items have name-specific food-photo mappings; the image layer is illustrative only and falls back to local vector art if remote photography fails. No new database or inventory schema was introduced.
- Responsive React/Vite experience with Light and Night themes, an eight-item featured pizza menu served by the API, category filters, recipe-backed ingredient labels, clickable pizza detail views, custom-pizza builder, cart and checkout. Prices, recipe ingredients and availability remain server-owned; new menu recipes reference existing catalog options so inventory checks still apply.
- The custom builder preview tries distinct food-photo sources if its preferred remote image fails, then retains an in-repo vector illustration if all remote photos are unavailable. Ingredient selection and server-derived recipe pricing remain separate from illustrative photography.
- Customer registration, email verification, sign-in, logout, forgot/reset password, and cookie-based sessions.
- When email verification is required, the sign-in dialog can request a replacement link. The endpoint uses a generic response that does not reveal whether an account exists, rotates the 24-hour token and invalidates the old link. Real inbox delivery still depends on provider configuration and must be verified separately.
- Server-authoritative order prices and recipe validation. The server does not trust prices or totals supplied by the browser.
- Required delivery recipient, Indian mobile number, street address, city, state and PIN code are validated and stored with the order; destination details can be corrected while payment is pending.
- Basket and pending-order recovery, checkout idempotency, explicit confirmation when the server quote differs from the visible cart, and retry handling when payment verification is uncertain.
- Customer order history, order-status timeline with recorded milestone times, authenticated real-time refresh events, safe repeat-order from the current catalog, and customer support reports for eligible paid orders.

### Admin and restaurant operations
- Admin-only notification health distinguishes queued, retrying, sending, provider-accepted messages, and dead-letter items. Retryable failures show the sanitized last error and retry time without returning recipient addresses or notification payloads. Provider settings detected does not mean that a real email reached an inbox; use the single-admin test-email action and confirm inbox delivery separately.
- Admin order queue returns persisted kitchen/delivery assignees so assignments remain visible after refresh.
- Delivery is not marked complete by staff alone: the assigned delivery account requests receipt confirmation, the customer confirms from their authenticated account, and only then is the order marked delivered. The request is emailed through the configured customer-notification queue; provider acceptance is not proof the inbox received it.
- Separate admin sign-in; public registration cannot create an admin or staff account.
- Admin summary, inventory/threshold editing, low-stock scan/notification job, incoming orders and payment-review queue.
- Customer issue queue with reference IDs, review/resolution states and customer-visible updates.
- Guarded refund workflow for eligible payment-review cases. The code uses provider idempotency and does not release inventory until a full refund is confirmed; ambiguous or multiple-capture cases need manual review.
- Staff management: admin can create kitchen/delivery staff, assign paid orders to them, and disable accounts.
- Staff onboarding: new staff receive a one-time email link to choose their own password (24-hour expiry); admins can resend setup links for accounts that have not completed setup. The admin roster shows invite/setup state. This requires a working Resend or SMTP sender; provider acceptance is not proof of inbox delivery.
- Staff sign-in and role-filtered kitchen and delivery queues. Accounts that still use the legacy temporary-password flow must rotate it before accessing operations; disabling an account revokes its active session.
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
| GET / POST | /admin/staff | List/provision kitchen and delivery staff; POST creates an email setup invitation when no initial password is supplied |
| POST | /admin/staff/:id/invitation | Re-send a one-time setup link for active staff who have not completed password setup |
| PATCH | /admin/orders/:id/assignments | Assign a paid order to staff |
| GET / PATCH | /ops/orders, /ops/orders/:id/status | Role-filtered kitchen/delivery queue and transitions |
| GET / PATCH | /admin/inventory | Admin inventory view / stock thresholds |
| GET / PATCH | /admin/issues | Admin customer-issue queue and case updates |
| GET | /admin/payment-reviews | Captured-payment review queue |
| POST | /admin/orders/:id/refund | Guarded full-refund recovery for eligible review cases |

## Verification and launch status

**Reviewed 26 Oct 2026.** Pizza House is deployed for launch preparation, but it is **not certified for real-money transactions or real-world delivery operations**.

- **Historical delivery-confirmation deployment (superseded):** [21d3df5](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/commit/21d3df5755e9bac26983b740492a8c8972b9cc60), Render deployment [dep-dbfl4d1srm7s73fct4tg](https://dashboard.render.com/web/srv-dbca9guq1p3s73cprrl0) was an earlier successful runtime. It is **not the current live runtime**; use the release evidence near the top of this README for the latest deployed revision.
- **Customer-confirmed delivery (feature history):** the workflow requires the assigned delivery account to request receipt confirmation, then the authenticated customer to confirm before `delivered` is persisted. An earlier rollout exposed a notification-service syntax error; it was corrected in [21d3df5](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/commit/21d3df5755e9bac26983b740492a8c8972b9cc60). Later runtime deployments superseded that rollout.
- **Test evidence versus latest deployment:** the previously tested browser snapshot is [367c0e9](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/commit/367c0e95e1ff2d1fd70e0ab5a2be3824d935f862), with 81/81 hosted browser checks. The staff invitation, assignment response, and customer-confirmed delivery changes were deployed after that snapshot; they are not covered by those 81 checks. No new feature-specific test suite or authenticated end-to-end fulfillment run was performed for these changes.
- **Previous assignment fix:** [7bea8b3](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/commit/7bea8b356668d8f62369e89a0dd3fa016c2d4e89) ensures kitchen/delivery assignees remain visible after refresh.
- **Latest automated evidence:** [CI passed](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40319975066), [deployed API smoke passed](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40319975198), and [hosted browser smoke passed — 81/81 checks](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40319975244). The hosted browser suite checks the public menu, recipe/price details, Light/Night theme, responsive layout, and a builder photo fallback when the preferred image is deliberately blocked.
- **Test evidence versus latest deployment:** the previously tested browser snapshot is [367c0e9](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/commit/367c0e95e1ff2d1fd70e0ab5a2be3824d935f862), with 81/81 hosted browser checks. Staff email-invitation onboarding and the later order-assignment response fix were deployed after that snapshot; neither feature is claimed as covered by those 81 checks. No new feature-specific test suite or authenticated end-to-end fulfillment run was performed for the assignment fix.
- **Branches:** product work remains on `main`; the latest status audit recorded eight open Dependabot branches for separate dependency review. No product branch was created for the assignment fix.
- **Real-world launch blockers:** actual staff invitation inbox delivery, customer email/SMS delivery, provider-originated Razorpay live payment/webhook/refund handling, staffed kitchen acceptance, driver dispatch and real delivery completion remain unverified. Checkout Test Mode OTP is simulated and does not send an SMS or charge real money. Browser auth/payment/operations checks use mocks or synthetic data where documented.
- **Operational safety:** do not enable Razorpay Live Mode or use destructive tests against production customer/order/inventory data until the provider, notification and fulfillment gates have been explicitly verified. Render's existing `pizza-house-api` service has auto-deploy disabled; future source changes require an intentional deployment.

The admin-only `POST /api/admin/test-email` route sends a test only to the authenticated administrator's stored email address and is rate-limited. Automated tests stub the email provider; no live email was sent during the audit.

**Next release gate:** verify provider configuration without exposing secrets, prove email delivery to the configured admin inbox, then run a controlled Test Mode order through the actual authenticated admin → kitchen → delivery APIs using synthetic data. Separately verify Razorpay webhook/refund behavior with provider test events. Record each result as passed, failed, or blocked; never treat simulated UI progression as proof of real fulfillment.

## Security basics

- Keep server/.env, API keys, webhook secrets, database credentials, user exports and customer personal data out of Git.
- Use HTTPS, exact allowed origins, secure cookies, restricted database network access and a verified sender identity.
- Use Test Mode during development/assessment. Rotate any credential that has been exposed.
- Never run destructive inventory, customer, order or admin-data changes against the production database for a smoke test.
