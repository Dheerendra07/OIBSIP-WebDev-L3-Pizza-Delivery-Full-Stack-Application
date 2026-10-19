# Architecture and Request Flow

## Components

- client/src/App.jsx: customer UI, authentication, checkout, validated delivery form, customer/admin order views and payment-review recovery actions.
- client/src/api.js: credentialed JSON API requests.
- client/src/delivery.js: client-side destination normalizer/validator; the server validates the same fields independently.
- client/src/pendingPayment.js: validation/serialization of pending Razorpay verification attempts for safe same-tab/session retry after reload.
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

1. The client submits cart choices and delivery destination. The server rebuilds line items from an allowlisted catalog and computes prices and fees.
2. Destination fields are normalized and validated on the server: recipient, 10-digit Indian mobile, street address, city, state and PIN code. A pending unpaid order may update its destination; after payment is no longer pending, changes are rejected.
3. Ingredient stock is reserved in a MongoDB transaction before a Razorpay order is created.
4. Checkout returns Razorpay order details to the browser. The client submits the order/payment IDs and signature for server verification; the server rejects payment-order creation if saved delivery details are missing or invalid.
5. The server validates checkout HMAC, queries provider payment state and checks linked order, captured status, amount and INR currency before fulfillment.
6. If browser verification does not finish, POST /api/payments/webhook can reconcile a signed payment.captured event. The route validates X-Razorpay-Signature over the exact raw JSON body with RAZORPAY_WEBHOOK_SECRET; event-ID receipts make repeated delivery idempotent.
7. Captured payment with an invalid amount/currency, missing reservation or invalid destination is persisted to payment_review with an admin-visible receipt. The customer sees a do-not-pay-again review message rather than a misleading pending/failure state.
8. payment.failed is not treated as final while late capture remains possible. Expired-reservation reconciliation checks provider state, defers on uncertain/in-flight state, and routes mismatched or multiple captured payments to manual review. Expired unpaid orders are cancelled; their provider order reference is retained so a late capture can still be linked and reviewed.
9. The client stores a validated pending verification attempt in sessionStorage and restores it after reload, allowing retry of the same payment confirmation instead of restarting checkout.

## Refund recovery

1. Admin endpoints are protected by authentication and admin-role authorization.
2. The review queue lists webhook exceptions. The refund action is offered only for an eligible captured review hold with the exact recorded payment ID; multiple-capture cases require manual reconciliation.
3. Before submitting, the server fetches the provider payment and verifies its order link, captured status, INR currency, refundable amount and refund state.
4. Before automatic recovery, the server fetches the Razorpay order's payment history and requires exactly one captured payment matching the reviewed payment ID, order and amount/currency. Missing history, multiple captures or mismatches fail closed for manual review.
5. The server persists a deterministic refund idempotency key before contacting Razorpay. A retry reuses that same key. Network or uncertain provider outcomes must not trigger a new independent refund.
6. Signed refund.created, refund.processed and refund.failed events are reconciled through the webhook controller. A refund is not considered complete merely because the request was acknowledged.
7. Only a matching confirmed full-refund result can mark the order refunded/cancelled and release any still-reserved inventory in a database transaction. Failed, mismatched, extra or uncertain refunds remain on manual review.
8. If the signed refund webhook finishes reconciliation before the original admin refund request returns, the API recognises the already-processed matching refund instead of surfacing a false failure.

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
