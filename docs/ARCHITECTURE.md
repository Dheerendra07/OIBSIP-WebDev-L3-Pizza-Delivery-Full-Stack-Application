# Architecture and request flow

## Components

- `client/src/App.jsx`: ordering UI, authentication dialogs, checkout, order tracking and admin actions.
- `client/src/api.js`: JSON API wrapper with cookie credentials and the API origin used by Socket.IO.
- `server/src/services/realtime.js`: cookie-authenticated Socket.IO connections, session-expiry enforcement, role-derived rooms, and privacy-limited order update events.
- `server/src/app.js`: Express middleware and route registration.
- `server/src/controllers/`: authentication, catalog, orders/payments, signed Razorpay webhook reconciliation and admin operations.
- `server/src/models/`: users, inventory, orders and idempotent payment-webhook receipts.
- `server/src/jobs/stockAlerts.js`: stock threshold emails and expired checkout reconciliation.

## Checkout

1. The client sends cart choices; the server resolves them against an allowlisted catalog and computes prices itself.
2. The server reserves ingredient stock in a MongoDB transaction before starting Razorpay Checkout.
3. The client sends the Razorpay order/payment IDs and signature to the API.
4. The checkout callback is verified server-side using HMAC plus provider payment linkage, captured status, amount and INR currency.
5. The signed Razorpay webhook endpoint validates `X-Razorpay-Signature` against the exact raw JSON body using `RAZORPAY_WEBHOOK_SECRET`. It records `x-razorpay-event-id` receipts to make duplicate deliveries idempotent and reconciles `payment.captured` events even if the customer closes the checkout before the browser callback finishes.
6. A matching capture fulfills the order only when the stock reservation is still present. Captures that do not safely match the expected amount/order/reservation are recorded as `payment_review` holds and surfaced to admins; stock is not released automatically and no automatic refund is attempted.
7. `payment.failed` is treated as a non-terminal attempt, not proof that the order can be released. Expired holds continue to be reconciled with provider state before release.
6. The client subscribes to authenticated Socket.IO `order:update` events. REST responses remain the source of truth: the client re-fetches on connect/reconnect and after an update, so missed events do not become stale client state.
7. The server derives socket rooms from the currently verified database user and role. It emits after order creation, captured payment verification, admin fulfillment transitions, and captured-payment reconciliation. Payloads contain only order ID/number, status, payment status, and update time.

## Security boundaries

- Public registration always creates the `user` role. Admin accounts are separately seeded.
- JWT uses an HttpOnly cookie; reset/verification tokens are stored as hashes with expiry. Password reset increments `sessionVersion` to revoke earlier tokens.
- Socket handshakes verify JWT issuer/audience, require a future expiry, validate the user's current database role/email-verification/session version, and only then join server-derived rooms. Active sockets are disconnected at JWT expiry; timer cleanup occurs on disconnect.
- Logout and password reset explicitly disconnect relevant active user sockets.
- Never commit `.env`; use Razorpay test keys, HTTPS, a verified SMTP sender and restricted database network access.
- Webhooks must be signed with a separate `RAZORPAY_WEBHOOK_SECRET`. In production it is required; configure the same secret in the Razorpay Dashboard and `server/.env`.

## Deployment caveats

- Stock transactions require MongoDB transaction support (Atlas or replica-set-capable MongoDB).
- Configure and test the signed Razorpay webhook in Razorpay Test Mode at `POST /api/payments/webhook` with `payment.captured` and `payment.failed` enabled. A manual review queue is not an automatic refund system; define, audit and test refund/reconciliation operations before production payments.
- Configure exact CORS origins and test cookies against the chosen frontend/API hosting topology.
- A passing CI run covers automated tests and the production client build, not the configured browser-to-database-to-payment end-to-end journey.
