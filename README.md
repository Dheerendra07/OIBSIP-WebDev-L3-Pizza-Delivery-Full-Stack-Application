# Pizza House — Full-Stack Pizza Ordering & Inventory

A MERN application for custom pizza ordering, account verification, test-mode checkout, inventory management, and order tracking. Built with React + Vite, Express, MongoDB/Mongoose and Razorpay test mode.

## Assessment feature map

**Customer workflow**
- Email-based registration and verification; JWT session in an HttpOnly cookie; sign-in, sign-out, forgot-password and reset-password flows.
- Menu of featured pizzas plus a custom pizza builder (5 bases, 5 sauces, several cheese choices and selectable vegetable toppings).
- Server-priced order summary, delivery-fee calculation, Razorpay test checkout and retryable server-side payment confirmation.
- Customer order history and polling-based status updates: Order received → In the kitchen → On the way → Delivered.

**Admin workflow**
- Separately provisioned admin sign-in; public registration always creates a customer role.
- Inventory dashboard for bases, sauces, cheeses and vegetables, with stock/threshold edits and low-stock email alerts using a scheduled job.
- Order panel with paid-order status-transition validation and summary metrics.

## Stack and layout
- `client/`: React UI, API client and checkout-matching rules.
- `server/src/routes/`: auth, catalog, order, payment and admin APIs.
- `server/src/controllers/`: server-side validation, authentication, orders and admin behaviour.
- `server/src/models/`: users, inventory and orders.
- `server/src/jobs/stockAlerts.js`: scheduled low-stock notifications and cautious expired-payment/stock reconciliation.
- `server/src/utils/`: catalog/pricing, order rules, signature/session/token and environment validation.
- `server/tests/` and `client/tests/`: deterministic unit tests.
- `PROJECT_STATUS.md`: verified repository state, checks actually run, limitations and handoff.

## Prerequisites
- Node.js 22 LTS recommended.
- MongoDB replica-set-capable database (MongoDB Atlas or local replica set), because stock reservations update multiple documents in a transaction.
- Razorpay **test-mode** credentials (`rzp_test_...`) and SMTP credentials for actual email delivery.

## Local setup
1. Copy `.env.example` to `server/.env`. Copy `client/.env.example` to `client/.env` only if overriding the local API URL.
2. Set a unique JWT secret (32+ random characters), MongoDB URI, SMTP credentials, sender address, frontend/API base URLs and Razorpay test keys. Never commit `.env`.
3. Install dependencies: `npm run install:all`.
4. Seed inventory: `npm run seed:inventory`.
5. Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in `server/.env`, then run `npm run seed:admin`. Public sign-up cannot create admins.
6. Start both services: `npm run dev`.
7. Frontend: `http://localhost:5173`; API health: `http://localhost:4000/api/health`.
8. Run tests: `npm test`.

## Checkout integrity
- Client-supplied prices/totals are ignored; the API rebuilds every line from allowlisted catalog choices.
- Stock is reserved transactionally before payment checkout opens.
- The server verifies Razorpay HMAC and independently checks payment capture state, linked order, amount and INR currency before marking an order paid.
- If confirmation is inconclusive, the UI retries verification for the same payment rather than immediately opening a second checkout.
- Expired stock holds are reconciled against provider payment state before release; uncertain or mismatched states retain the hold for review.

## API overview
- `POST /api/auth/register`, `GET /api/auth/verify-email/:token`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `POST /api/auth/forgot-password`, `POST /api/auth/reset-password/:token`, `POST /api/auth/admin/login`.
- `GET /api/catalog`.
- `POST /api/orders`, `GET /api/orders/my`, `GET /api/orders/:id`.
- `POST /api/payments/create-order`, `POST /api/payments/verify`.
- `GET /api/admin/summary`, `GET /api/admin/inventory`, `PATCH /api/admin/inventory/:key`, `GET /api/admin/orders`, `PATCH /api/admin/orders/:id/status`.

## Security and deployment
- Passwords are hashed; verification/reset tokens are stored as hashes and expire; password reset invalidates previous JWT generations.
- Use exact HTTPS origins for `CLIENT_ORIGIN` in production (comma-separated allowlist; no wildcard/path), HTTPS frontend/API base URLs, a verified `MAIL_FROM`, Razorpay test keys and restricted database network access.
- Set `COOKIE_SAME_SITE` based on deployment. `none` requires production HTTPS; same-site frontend/API domains are easier to operate.
- This project is not certified for production traffic yet. Add/test a signature-verified Razorpay webhook and refund/provider-outage procedures before production payments.

## Verification status
- Locally re-run unit suite: 38 passed, 0 failed after order/config hardening.
- JavaScript syntax, JSX syntax transpilation and CSS parsing passed; these are not a Vite production build.
- Production build is intentionally skipped per owner instruction.
- MongoDB replica-set transactions, actual SMTP delivery and Razorpay test checkout still need end-to-end testing with configured external services.