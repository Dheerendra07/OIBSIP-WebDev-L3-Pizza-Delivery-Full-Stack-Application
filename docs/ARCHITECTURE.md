# Architecture and request flow

## Components

- `client/src/App.jsx`: ordering UI, authentication dialogs, checkout, order tracking and admin actions.
- `client/src/api.js`: JSON API wrapper with cookie credentials.
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
6. The user dashboard polls persisted order status; admin changes are validated and persisted.

## Security boundaries

- Public registration always creates the `user` role. Admin accounts are separately seeded.
- JWT uses an HttpOnly cookie; reset/verification tokens are stored as hashes with expiry. Password reset increments `sessionVersion` to revoke earlier tokens.
- Never commit `.env`; use Razorpay test keys, HTTPS, a verified SMTP sender and restricted database network access.

## Deployment caveats

- Stock transactions require MongoDB transaction support (Atlas or replica-set-capable MongoDB).
- Before production payments, add and test a signature-verified Razorpay webhook and audited refund/reconciliation procedures.
- Configure exact CORS origins and test cookies against the chosen frontend/API hosting topology.
