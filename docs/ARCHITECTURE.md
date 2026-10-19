# Architecture and request flow

## Components

- `client/src/App.jsx`: ordering UI, authentication dialogs, checkout, order tracking and admin actions.
- `client/src/api.js`: JSON API wrapper with cookie credentials and the API origin used by Socket.IO.
- `server/src/services/realtime.js`: cookie-authenticated Socket.IO connections, session-expiry enforcement, role-derived rooms, and privacy-limited order update events.
- `server/src/app.js`: Express middleware and route registration.
- `server/src/controllers/`: authentication, catalog, orders/payments and admin operations.
- `server/src/models/`: users, inventory and orders.
- `server/src/jobs/stockAlerts.js`: stock threshold emails and expired checkout reconciliation.

## Checkout

1. The client sends cart choices; the server resolves them against an allowlisted catalog and computes prices itself.
2. The server reserves ingredient stock in a MongoDB transaction before starting Razorpay Checkout.
3. The client sends the Razorpay order/payment IDs and signature to the API.
4. The server validates HMAC and independently verifies provider payment linkage, captured status, amount and INR currency before marking paid and consuming the reservation.
5. Expired holds are reconciled with the provider before release. Uncertain payment state keeps stock reserved for a later scan.
6. The client subscribes to authenticated Socket.IO `order:update` events. REST responses remain the source of truth: the client re-fetches on connect/reconnect and after an update, so missed events do not become stale client state.
7. The server derives socket rooms from the currently verified database user and role. It emits after order creation, captured payment verification, admin fulfillment transitions, and captured-payment reconciliation. Payloads contain only order ID/number, status, payment status, and update time.

## Security boundaries

- Public registration always creates the `user` role. Admin accounts are separately seeded.
- JWT uses an HttpOnly cookie; reset/verification tokens are stored as hashes with expiry. Password reset increments `sessionVersion` to revoke earlier tokens.
- Socket handshakes verify JWT issuer/audience, require a future expiry, validate the user's current database role/email-verification/session version, and only then join server-derived rooms. Active sockets are disconnected at JWT expiry; timer cleanup occurs on disconnect.
- Logout and password reset explicitly disconnect relevant active user sockets.
- Never commit `.env`; use Razorpay test keys, HTTPS, a verified SMTP sender and restricted database network access.

## Deployment caveats

- Stock transactions require MongoDB transaction support (Atlas or replica-set-capable MongoDB).
- Before production payments, add and test a signature-verified Razorpay webhook and audited refund/reconciliation procedures.
- Configure exact CORS origins and test cookies against the chosen frontend/API hosting topology.
- A passing CI run covers automated tests and the production client build, not the configured browser-to-database-to-payment end-to-end journey.
