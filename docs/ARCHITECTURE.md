# Architecture and Request Flow

## Components

- client/src/App.jsx: customer UI, authentication, checkout, customer/admin order views and payment-review recovery actions.
- client/src/api.js: credentialed JSON API requests.
- server/src/app.js: Express middleware and route registration; signed payment webhooks are mounted with raw-body parsing before JSON parsing.
- server/src/controllers/: authentication, catalog, order/payment, signed webhook and admin handlers.
- server/src/services/payments.js: Razorpay Test Mode client, checkout signature helper and idempotent full-refund submission.
- server/src/services/refunds.js: eligibility checks, full-refund request state, provider refund webhook reconciliation and inventory/order-state transaction.
- server/src/utils/paymentSignature.js: timing-safe HMAC verification for checkout and raw webhook body.
- server/src/utils/paymentWebhook.js and paymentRefund.js: fail-closed classification of captured-payment/refund events.
- server/src/models/: users, inventory, orders and webhook receipts.
- server/src/jobs/stockAlerts.js: low-stock notifications and expired checkout/inventory reconciliation.
- server/src/services/realtime.js: authenticated Socket.IO connections and privacy-limited order updates.

## Customer checkout

1. The client submits cart choices; the server rebuilds line items from an allowlisted catalog and computes prices and fees.
2. Ingredient stock is reserved in a MongoDB transaction before a Razorpay order is created.
3. Checkout returns Razorpay order details to the browser. The client submits the order/payment IDs and signature for server verification.
4. The server validates checkout HMAC, queries the provider payment and checks linked order, captured status, amount and INR currency before fulfillment.
5. If browser verification does not finish, POST /api/payments/webhook can reconcile a signed payment.captured event. The route validates X-Razorpay-Signature over the exact raw JSON body with RAZORPAY_WEBHOOK_SECRET; event-ID receipts make repeated delivery idempotent.
6. payment.failed is not treated as final while late capture remains possible. Expired-reservation reconciliation checks provider state and defers on uncertain, in-flight or mismatched payment states.
7. A capture fulfills only when linked order, amount, currency and inventory reservation match. Unsafe captures are recorded as payment_review; they are not sent to the kitchen.

## Refund recovery

1. Admin endpoints are protected by authentication and admin-role authorization.
2. The review queue lists webhook exceptions. The refund action is offered only for an eligible captured review hold with the exact recorded payment ID; multiple-capture cases require manual reconciliation.
3. Before submitting, the server fetches the provider payment and verifies its order link, captured status, INR currency, refundable amount and refund state.
4. The server persists a deterministic refund idempotency key before contacting Razorpay. A retry reuses that same key. Network or uncertain provider outcomes must not trigger a new independent refund.
5. Signed refund.created, refund.processed and refund.failed events are reconciled through the webhook controller. A refund is not considered complete merely because the request was acknowledged.
6. Only a matching confirmed full-refund result can mark the order refunded/cancelled and release any still-reserved inventory in a database transaction. Failed, mismatched, extra or uncertain refunds remain on manual review.

## Authentication, inventory and realtime boundaries

- Public registration always creates a customer. Admin accounts are seeded separately.
- Passwords are hashed; verification/reset tokens are stored as hashes with expiry. Password reset increments session version to revoke earlier sessions.
- API/admin route authorization is separate from client-side UI gating.
- Stock decrement/release and related order updates use MongoDB transactions; a replica-set-capable MongoDB is required.
- Socket.IO authenticates the session, derives customer/admin rooms from verified database identity, minimizes event payloads and disconnects expired sessions.
- Client REST refresh on socket connect/reconnect is the source of truth when live events are missed.

## Environment and integration requirements

- Keep .env files and provider credentials out of Git.
- Use a transaction-capable database, strong JWT secret, HTTPS origins, secure cookies and verified SMTP configuration.
- Configure POST /api/payments/webhook in Razorpay Test Mode and set the same separate RAZORPAY_WEBHOOK_SECRET in the server environment and provider dashboard.
- Enable payment.captured, payment.failed, refund.created, refund.processed and refund.failed; verify actual delivery, duplicate events and out-of-order handling before production.
- Automated CI validates unit tests and the production client build. It does not validate live provider delivery, external MongoDB transaction behavior, SMTP delivery or the full browser-to-provider flow.
