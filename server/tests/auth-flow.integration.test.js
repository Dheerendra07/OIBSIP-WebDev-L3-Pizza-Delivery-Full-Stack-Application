import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

test('production auth HTTP flow: signup, login cookie, current user, protected orders and logout', async (t) => {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const webOrigin = 'https://pizza-house-api.onrender.com';
  const apiOrigin = 'https://pizza-house-api.onrender.com';
  const env = {
    NODE_ENV: 'production',
    MONGODB_URI: mongod.getUri('pizza_house_auth_e2e'),
    JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    JWT_EXPIRES_IN: '1d',
    CLIENT_ORIGIN: webOrigin,
    CLIENT_BASE_URL: webOrigin,
    APP_BASE_URL: apiOrigin,
    COOKIE_SAME_SITE: 'lax',
    REQUIRE_EMAIL_VERIFICATION: 'false',
    MAIL_FROM: 'Pizza House <noreply@example.com>',
    RESEND_API_KEY: 'test-only-not-used',
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'StrongAdminPass123',
    ADMIN_ALERT_EMAIL: 'alerts@example.com',
    RAZORPAY_KEY_ID: 'rzp_test_auth_e2e',
    RAZORPAY_KEY_SECRET: 'test-only-not-used',
    RAZORPAY_WEBHOOK_SECRET: 'test-only-webhook-secret',
  };
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  let server;
  let restoreRazorpayClientFactory = () => {};
  let razorpayOrderCreateCalls = 0;
  const providerPaymentsByOrderId = new Map();
  const providerPaymentsById = new Map();
  const mockProviderOrderId = 'order_test_auth_e2e';
  const mockProviderPaymentId = 'pay_test_auth_e2e';
  t.after(async () => {
    restoreRazorpayClientFactory();
    if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.disconnect().catch(() => {});
    await mongod.stop();
  });

  // The test provider prevents external payment calls while preserving the real HTTP,
  // session, transaction, inventory, payment-verification and webhook code paths.
  const { setRazorpayClientFactoryForIntegrationTests } = await import('../src/services/payments.js');
  restoreRazorpayClientFactory = setRazorpayClientFactoryForIntegrationTests(() => ({
    orders: {
      create: async ({ amount, currency }) => {
        razorpayOrderCreateCalls += 1;
        const id = razorpayOrderCreateCalls === 1
          ? mockProviderOrderId
          : `order_test_auth_e2e_${razorpayOrderCreateCalls}`;
        return { id, amount, currency };
      },
      fetchPayments: async (orderId) => providerPaymentsByOrderId.get(orderId) || { items: [] },
    },
    payments: {
      fetch: async (id) => providerPaymentsById.get(id) || ({
        id,
        order_id: mockProviderOrderId,
        amount: 52700,
        currency: 'INR',
        status: 'captured',
        amount_refunded: 0,
      }),
    },
  }));

  // Import only after assigning test-only production settings so the real app
  // builds the Secure + SameSite=Lax cookie used by the same-origin Render setup.
  const { default: app } = await import('../src/app.js');
  await mongoose.connect(env.MONGODB_URI);
  const { ensureInventorySeeded, ensureAdminAccount } = await import('../src/utils/databaseBootstrap.js');
  await ensureInventorySeeded();
  await ensureAdminAccount({ env });
  const { default: Order } = await import('../src/models/Order.js');
  await Order.init(); // Ensure the unique checkout idempotency index exists before racing requests.
  const { default: InventoryItem } = await import('../src/models/InventoryItem.js');
  server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: webOrigin, 'Content-Type': 'application/json' };

  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Automated Auth Test',
      email: 'auth-flow@example.com',
      password: 'StrongPassword123',
    }),
  });
  assert.equal(register.status, 201, 'signup should not depend on SMTP when verification is disabled');
  const registerBody = await register.json();
  assert.equal(registerBody.emailVerificationRequired, false);
  assert.match(registerBody.message, /You can now sign in/);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'AUTH-FLOW@example.com', password: 'StrongPassword123' }),
  });
  assert.equal(login.status, 200, 'new account should be able to log in immediately');
  const loginBody = await login.json();
  assert.equal(loginBody.user.email, 'auth-flow@example.com');
  assert.equal(loginBody.user.role, 'user');
  assert.equal(login.headers.get('access-control-allow-origin'), webOrigin);
  assert.equal(login.headers.get('access-control-allow-credentials'), 'true');

  const setCookies = typeof login.headers.getSetCookie === 'function'
    ? login.headers.getSetCookie()
    : [login.headers.get('set-cookie')].filter(Boolean);
  const sessionCookie = setCookies.find((value) => value.startsWith('pizza_session='));
  assert.ok(sessionCookie, 'login should issue the pizza_session cookie');
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /Secure/i);
  assert.match(sessionCookie, /SameSite=Lax/i);
  const cookie = sessionCookie.split(';', 1)[0];

  const me = await fetch(`${base}/api/auth/me`, { headers: { Origin: webOrigin, Cookie: cookie } });
  assert.equal(me.status, 200, 'session cookie should authenticate /me');
  assert.equal((await me.json()).user.email, 'auth-flow@example.com');

  const orders = await fetch(`${base}/api/orders/my`, { headers: { Origin: webOrigin, Cookie: cookie } });
  assert.equal(orders.status, 200, 'authenticated customer should load order history');
  assert.deepEqual((await orders.json()).orders, []);

  // Real HTTP order creation against isolated MongoDB: authoritative price,
  // persistence, replay safety when a response is lost, and payload mismatch protection.
  const createOrderPayload = {
    items: [{ type: 'featured', pizzaId: 'margherita', quantity: 2, unitPrice: 1, lineTotal: 1 }],
    deliveryDetails: {
      recipientName: 'Test Customer',
      phone: '9000000000',
      addressLine: '12 Example Test Lane',
      landmark: 'Test Landmark',
      city: 'Test City',
      state: 'Test State',
      postalCode: '999999',
      instructions: 'Test instructions',
    },
  };
  // Abandoned orders that never created a provider order must not clog the admin queue forever.
  // The scheduled cleanup may cancel only stale, unpaid, unreserved, non-provider-linked orders.
  const {
    cancelAbandonedUnreservedCheckouts,
    UNRESERVED_CHECKOUT_TTL_MS,
  } = await import('../src/jobs/stockAlerts.js');
  const fixtureIngredients = {
    base: 'classic',
    sauce: 'classic-tomato',
    cheese: 'mozzarella',
    vegetables: ['tomato'],
  };
  const fixtureItem = {
    name: 'Margherita Classic',
    quantity: 1,
    unitPrice: 249,
    lineTotal: 249,
    ingredients: fixtureIngredients,
    inventoryKeys: ['base:classic', 'sauce:classic-tomato', 'cheese:mozzarella', 'vegetable:tomato'],
  };
  const makeCheckoutFixture = (label, overrides = {}) => Order.create({
    orderNumber: `PH-CLEANUP-${label}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    user: loginBody.user.id,
    items: [fixtureItem],
    subtotal: 249,
    deliveryFee: 29,
    total: 278,
    deliveryDetails: createOrderPayload.deliveryDetails,
    status: 'pending_payment',
    paymentStatus: 'pending',
    inventoryReserved: false,
    paymentOrderCreationInProgress: false,
    stockReservedAt: null,
    stockReservationExpiresAt: null,
    razorpayOrderId: null,
    ...overrides,
  });
  const [abandonedOrder, recentOrder, providerLinkedOrder, creationInProgressOrder, reservedFixtureOrder, capturedExpiredOrder, inFlightExpiredOrder] = await Promise.all([
    makeCheckoutFixture('STALE'),
    makeCheckoutFixture('RECENT'),
    makeCheckoutFixture('PROVIDER', { razorpayOrderId: 'order_existing_provider_checkout' }),
    makeCheckoutFixture('CREATING', { paymentOrderCreationInProgress: true }),
    makeCheckoutFixture('RESERVED_EMPTY', {
      inventoryReserved: true,
      stockReservationExpiresAt: new Date(Date.now() - 60_000),
      razorpayOrderId: 'order_expired_empty',
    }),
    makeCheckoutFixture('RESERVED_CAPTURED', {
      inventoryReserved: true,
      stockReservationExpiresAt: new Date(Date.now() - 60_000),
      razorpayOrderId: 'order_expired_captured',
    }),
    makeCheckoutFixture('RESERVED_AUTHORIZED', {
      inventoryReserved: true,
      stockReservationExpiresAt: new Date(Date.now() - 60_000),
      razorpayOrderId: 'order_expired_authorized',
    }),
  ]);
  const staleFixtureTime = new Date(Date.now() - UNRESERVED_CHECKOUT_TTL_MS - 60_000);
  for (const order of [abandonedOrder, providerLinkedOrder, creationInProgressOrder, reservedFixtureOrder, capturedExpiredOrder, inFlightExpiredOrder]) {
    await Order.collection.updateOne(
      { _id: order._id },
      { $set: { createdAt: staleFixtureTime, updatedAt: staleFixtureTime } },
    );
  }

  const cancelledUnreserved = await cancelAbandonedUnreservedCheckouts(new Date());
  assert.equal(cancelledUnreserved, 1, 'only one stale unreserved checkout without a provider order should be cancelled');
  assert.equal((await Order.findById(abandonedOrder.id).lean()).status, 'cancelled');
  assert.equal((await Order.findById(recentOrder.id).lean()).status, 'pending_payment', 'recent orders must remain payable');
  assert.equal((await Order.findById(providerLinkedOrder.id).lean()).status, 'pending_payment', 'provider-linked orders must remain on payment reconciliation');
  assert.equal((await Order.findById(creationInProgressOrder.id).lean()).status, 'pending_payment', 'orders marked as creating a payment order must be preserved');
  assert.equal((await Order.findById(reservedFixtureOrder.id).lean()).status, 'pending_payment', 'reserved orders must be handled by reservation reconciliation instead');
  assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, 100, 'unreserved-order cleanup must not modify ingredient stock');

  // Model three expired provider-linked reservations: no payment, captured payment, and an authorized in-flight payment.
  // Debit the stock first so the assertions exercise the same invariant as checkout: a reservation holds inventory.
  for (const _order of [reservedFixtureOrder, capturedExpiredOrder, inFlightExpiredOrder]) {
    for (const key of fixtureItem.inventoryKeys) {
      await InventoryItem.updateOne({ key }, { $inc: { stock: -1 } });
    }
  }
  providerPaymentsByOrderId.set('order_expired_empty', { items: [] });
  providerPaymentsByOrderId.set('order_expired_captured', {
    items: [{ id: 'pay_expired_captured', order_id: 'order_expired_captured', amount: 27800, currency: 'INR', status: 'captured' }],
  });
  providerPaymentsByOrderId.set('order_expired_authorized', {
    items: [{ id: 'pay_expired_authorized', order_id: 'order_expired_authorized', amount: 27800, currency: 'INR', status: 'authorized' }],
  });

  const { releaseExpiredReservations } = await import('../src/jobs/stockAlerts.js');
  const reconciliation = await releaseExpiredReservations(new Date());
  assert.deepEqual(reconciliation, { released: 1, reconciled: 1, deferred: 1, cancelledUnreserved: 0 });
  const releasedOrder = await Order.findById(reservedFixtureOrder.id).lean();
  assert.equal(releasedOrder.status, 'cancelled', 'expired reservations without provider payments should become cancelled');
  assert.equal(releasedOrder.inventoryReserved, false);
  assert.equal(releasedOrder.stockReservationExpiresAt, null);
  assert.equal(releasedOrder.razorpayOrderId, 'order_expired_empty', 'provider order reference must remain for late-capture recovery');

  const recoveredCapture = await Order.findById(capturedExpiredOrder.id).lean();
  assert.equal(recoveredCapture.status, 'order_received', 'a provider-confirmed late capture should be reconciled instead of cancelled');
  assert.equal(recoveredCapture.paymentStatus, 'paid');
  assert.equal(recoveredCapture.razorpayPaymentId, 'pay_expired_captured');
  assert.equal(recoveredCapture.inventoryReserved, false);
  assert.equal(recoveredCapture.stockReservationExpiresAt, null);

  const inFlightOrder = await Order.findById(inFlightExpiredOrder.id).lean();
  assert.equal(inFlightOrder.status, 'pending_payment', 'an authorized payment must retain the reservation');
  assert.equal(inFlightOrder.paymentStatus, 'pending');
  assert.equal(inFlightOrder.inventoryReserved, true);
  assert.equal(inFlightOrder.stockReservationExpiresAt.getTime() <= Date.now(), true);
  assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, 98, 'only the late-captured order and in-flight payment should continue holding stock');

  // Restore fixture-only inventory debits and remove fixture orders so later tests start from a clean catalog.
  for (const key of fixtureItem.inventoryKeys) await InventoryItem.updateOne({ key }, { $inc: { stock: 2 } });
  await Order.deleteMany({ _id: { $in: [abandonedOrder._id, recentOrder._id, providerLinkedOrder._id, creationInProgressOrder._id, reservedFixtureOrder._id, capturedExpiredOrder._id, inFlightExpiredOrder._id] } });

  const checkoutRequestKey = 'integration-checkout-request-0001';
  const postCreateOrder = (payload = createOrderPayload) => fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie, 'Idempotency-Key': checkoutRequestKey },
    body: JSON.stringify(payload),
  });
  const createOrder = await postCreateOrder();
  assert.equal(createOrder.status, 201, 'authenticated customer should create an order');
  const createdOrder = (await createOrder.json()).order;
  assert.ok(createdOrder?.id);

  const duplicateCreateOrder = await postCreateOrder();
  assert.equal(duplicateCreateOrder.status, 200, 'replaying the same checkout request should return the already-created order');
  const duplicateOrder = (await duplicateCreateOrder.json()).order;
  assert.equal(String(duplicateOrder.id), String(createdOrder.id), 'retry must reuse the original order ID');
  assert.equal(await Order.countDocuments({ user: loginBody.user.id }), 1, 'replaying a request must not create a duplicate order');

  const changedPayloadResponse = await postCreateOrder({
    ...createOrderPayload,
    deliveryDetails: { ...createOrderPayload.deliveryDetails, addressLine: '99 Different Street' },
  });
  assert.equal(changedPayloadResponse.status, 409, 'the same idempotency key cannot silently attach a different delivery address');
  assert.equal((await changedPayloadResponse.json()).code, 'CHECKOUT_IDEMPOTENCY_CONFLICT');
  assert.equal(await Order.countDocuments({ user: loginBody.user.id }), 1, 'conflicting payload must not create a second order');

  assert.equal(createdOrder.items[0].unitPrice, 249, 'server catalog price must override client price');
  assert.equal(createdOrder.subtotal, 498);
  assert.equal(createdOrder.deliveryFee, 29);
  assert.equal(createdOrder.total, 527);
  assert.equal(createdOrder.status, 'pending_payment');
  assert.equal(createdOrder.paymentStatus, 'pending');

  const persistedOrdersResponse = await fetch(`${base}/api/orders/my`, {
    headers: { Origin: webOrigin, Cookie: cookie },
  });
  assert.equal(persistedOrdersResponse.status, 200);
  const persistedOrders = (await persistedOrdersResponse.json()).orders;
  assert.equal(persistedOrders.length, 1);
  assert.equal(String(persistedOrders[0].id), String(createdOrder.id));
  assert.equal(persistedOrders[0].total, 527);
  assert.equal(persistedOrders[0].deliveryDetails.postalCode, '999999');

  // A real MongoDB transaction reserves stock before the provider checkout is created.
  assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, 100);
  const createPaymentOrder = async () => fetch(`${base}/api/payments/create-order`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify({ orderId: createdOrder.id }),
  });
  const paymentOrderResponse = await createPaymentOrder();
  assert.equal(paymentOrderResponse.status, 200, 'checkout should create a provider order');
  const paymentOrder = await paymentOrderResponse.json();
  assert.equal(paymentOrder.paymentOrderId, mockProviderOrderId);
  assert.equal(paymentOrder.amount, 52700);
  assert.equal(paymentOrder.currency, 'INR');
  assert.equal(razorpayOrderCreateCalls, 1);

  const reservedOrder = await Order.findById(createdOrder.id).lean();
  assert.equal(reservedOrder.inventoryReserved, true);
  assert.equal(reservedOrder.paymentOrderCreationInProgress, false);
  assert.ok(reservedOrder.stockReservationExpiresAt instanceof Date);
  assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, 98);

  // Reloading/retrying checkout reuses the same provider order and never reserves stock twice.
  const repeatedPaymentOrderResponse = await createPaymentOrder();
  assert.equal(repeatedPaymentOrderResponse.status, 200);
  assert.equal((await repeatedPaymentOrderResponse.json()).paymentOrderId, mockProviderOrderId);
  assert.equal(razorpayOrderCreateCalls, 1);
  assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, 98);

  // A failed attempt is nonterminal: keep the pending order and stock hold so a later retry can capture.
  const failedAttemptBody = JSON.stringify({
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: 'pay_test_failed_attempt',
          order_id: mockProviderOrderId,
          amount: 52700,
          currency: 'INR',
          status: 'failed',
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    },
  });
  const failedAttemptSignature = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(failedAttemptBody)
    .digest('hex');
  const failedAttemptResponse = await fetch(`${base}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      Origin: webOrigin,
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': failedAttemptSignature,
      'X-Razorpay-Event-Id': 'integration-payment-failed-nonterminal-1',
    },
    body: failedAttemptBody,
  });
  assert.equal(failedAttemptResponse.status, 200);
  assert.equal((await failedAttemptResponse.json()).status, 'ignored');
  const afterFailedAttempt = await Order.findById(createdOrder.id).lean();
  assert.equal(afterFailedAttempt.status, 'pending_payment', 'a failed attempt must not cancel a still-retryable order');
  assert.equal(afterFailedAttempt.paymentStatus, 'pending');
  assert.equal(afterFailedAttempt.inventoryReserved, true, 'a failed attempt alone must not release the stock hold');
  assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, 98);

  // Simulate the browser's successful Razorpay callback and validate server-side capture status.
  const paymentSignature = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${mockProviderOrderId}|${mockProviderPaymentId}`)
    .digest('hex');
  const paymentVerificationResponse = await fetch(`${base}/api/payments/verify`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify({
      orderId: createdOrder.id,
      razorpay_order_id: mockProviderOrderId,
      razorpay_payment_id: mockProviderPaymentId,
      razorpay_signature: paymentSignature,
    }),
  });
  assert.equal(paymentVerificationResponse.status, 200, 'captured payment should be verified');
  const paymentVerification = await paymentVerificationResponse.json();
  assert.equal(paymentVerification.order.status, 'order_received');
  assert.equal(paymentVerification.order.paymentStatus, 'paid');
  const paidOrder = await Order.findById(createdOrder.id).lean();
  assert.equal(paidOrder.paymentStatus, 'paid');
  assert.equal(paidOrder.status, 'order_received');
  assert.equal(paidOrder.inventoryReserved, false);
  assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, 98);

  // Deliver a correctly signed provider webhook after browser verification, then replay it.
  const webhookBody = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: mockProviderPaymentId,
          order_id: mockProviderOrderId,
          amount: 52700,
          currency: 'INR',
          status: 'captured',
          amount_refunded: 0,
        },
      },
    },
  });
  const webhookSignature = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(webhookBody)
    .digest('hex');
  const webhookHeaders = {
    Origin: webOrigin,
    'Content-Type': 'application/json',
    'X-Razorpay-Signature': webhookSignature,
    'X-Razorpay-Event-Id': 'integration-payment-captured-1',
  };
  const webhookResponse = await fetch(`${base}/api/payments/webhook`, {
    method: 'POST',
    headers: webhookHeaders,
    body: webhookBody,
  });
  assert.equal(webhookResponse.status, 200);
  assert.equal((await webhookResponse.json()).status, 'processed');
  const { default: PaymentWebhookReceipt } = await import('../src/models/PaymentWebhookReceipt.js');
  assert.equal(await PaymentWebhookReceipt.countDocuments({ eventId: 'integration-payment-captured-1' }), 1);

  const replayResponse = await fetch(`${base}/api/payments/webhook`, {
    method: 'POST',
    headers: webhookHeaders,
    body: webhookBody,
  });
  assert.equal(replayResponse.status, 200);
  const replayBody = await replayResponse.json();
  assert.equal(replayBody.duplicate, true);
  assert.equal(await PaymentWebhookReceipt.countDocuments({ eventId: 'integration-payment-captured-1' }), 1);
  assert.equal((await Order.findById(createdOrder.id).lean()).razorpayPaymentId, mockProviderPaymentId);

  // A provider capture that already has a partial refund must not become a
  // kitchen-ready order. Verify this through the real HTTP app and isolated DB.
  const priorRefundCheckout = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie, 'Idempotency-Key': 'integration-prior-refund-checkout-0001' },
    body: JSON.stringify({
      items: [{ type: 'featured', pizzaId: 'margherita', quantity: 1 }],
      deliveryDetails: createOrderPayload.deliveryDetails,
    }),
  });
  assert.equal(priorRefundCheckout.status, 201);
  const priorRefundOrder = (await priorRefundCheckout.json()).order;
  const priorRefundSetup = await fetch(`${base}/api/payments/create-order`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify({ orderId: priorRefundOrder.id }),
  });
  assert.equal(priorRefundSetup.status, 200);
  const priorRefundPaymentOrder = await priorRefundSetup.json();
  assert.equal(priorRefundPaymentOrder.amount, 27800);
  const priorRefundPaymentId = 'pay_test_prior_refund';
  providerPaymentsById.set(priorRefundPaymentId, {
    id: priorRefundPaymentId,
    order_id: priorRefundPaymentOrder.paymentOrderId,
    amount: 27800,
    currency: 'INR',
    status: 'captured',
    amount_refunded: 1000,
  });
  const priorRefundSignature = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${priorRefundPaymentOrder.paymentOrderId}|${priorRefundPaymentId}`)
    .digest('hex');
  const priorRefundVerification = await fetch(`${base}/api/payments/verify`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify({
      orderId: priorRefundOrder.id,
      razorpay_order_id: priorRefundPaymentOrder.paymentOrderId,
      razorpay_payment_id: priorRefundPaymentId,
      razorpay_signature: priorRefundSignature,
    }),
  });
  assert.equal(priorRefundVerification.status, 200);
  const priorRefundVerificationBody = await priorRefundVerification.json();
  assert.equal(priorRefundVerificationBody.order.status, 'payment_review');
  assert.equal(priorRefundVerificationBody.order.paymentReviewRequired, true);
  const heldPriorRefundOrder = await Order.findById(priorRefundOrder.id).lean();
  assert.equal(heldPriorRefundOrder.paymentReviewReason, 'captured_payment_has_prior_refund');
  assert.equal(heldPriorRefundOrder.paymentStatus, 'paid');
  assert.equal(heldPriorRefundOrder.inventoryReserved, true, 'inventory remains held while the partial refund is reconciled');
  assert.ok(heldPriorRefundOrder.stockReservationExpiresAt instanceof Date);
  const { default: InventoryItemForPriorRefund } = await import('../src/models/InventoryItem.js');
  assert.equal(
    (await InventoryItemForPriorRefund.findOne({ key: 'base:classic' }).lean()).stock,
    97,
    'partial-refund capture must not be released to the ingredient pool or dispatched',
  );
  const priorRefundReviewReceipt = await PaymentWebhookReceipt.findOne({ eventId: `verification-${priorRefundPaymentId}` }).lean();
  assert.equal(priorRefundReviewReceipt.status, 'review_required');
  assert.equal(priorRefundReviewReceipt.reason, 'captured_payment_has_prior_refund');

  // Customer sessions cannot access the admin queue; the seeded admin can.
  const forbiddenAdminQueue = await fetch(`${base}/api/admin/orders`, {
    headers: { Origin: webOrigin, Cookie: cookie },
  });
  assert.equal(forbiddenAdminQueue.status, 403, 'customer must not access the admin order queue');

  const adminLogin = await fetch(`${base}/api/auth/admin/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
  });
  assert.equal(adminLogin.status, 200, 'the seeded admin should be able to sign in');
  const adminCookies = typeof adminLogin.headers.getSetCookie === 'function'
    ? adminLogin.headers.getSetCookie()
    : [adminLogin.headers.get('set-cookie')].filter(Boolean);
  const adminSession = adminCookies.find((value) => value.startsWith('pizza_session='));
  assert.ok(adminSession, 'admin login should issue a session cookie');
  const adminCookie = adminSession.split(';', 1)[0];

  // Exercise the post-payment recovery path over the real HTTP app and isolated MongoDB.
  // The provider client and refund HTTP request are test-only stubs; no external payment
  // or refund is sent, and all writes remain inside this disposable database.
  const reviewOrderResponse = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie, 'Idempotency-Key': 'integration-refund-review-order-0001' },
    body: JSON.stringify({ items: [{ type: 'featured', pizzaId: 'margherita', quantity: 1 }], deliveryDetails: createOrderPayload.deliveryDetails }),
  });
  assert.equal(reviewOrderResponse.status, 201);
  const reviewOrder = (await reviewOrderResponse.json()).order;
  const reviewProviderOrderId = 'order_test_refund_review_1';
  const reviewProviderPaymentId = 'pay_test_refund_review_1';
  const reviewRefundId = 'rfnd_test_refund_review_1';
  const reviewCapturedAmount = reviewOrder.total * 100 - 100;
  const reviewCapture = {
    id: reviewProviderPaymentId,
    order_id: reviewProviderOrderId,
    amount: reviewCapturedAmount,
    amount_refunded: 0,
    currency: 'INR',
    status: 'captured',
  };
  const restoreRefundProvider = setRazorpayClientFactoryForIntegrationTests(() => ({
    orders: {
      create: async ({ amount, currency }) => ({ id: reviewProviderOrderId, amount, currency }),
      fetchPayments: async (orderId) => ({ items: orderId === reviewProviderOrderId ? [reviewCapture] : [] }),
    },
    payments: {
      fetch: async (paymentId) => paymentId === reviewProviderPaymentId ? reviewCapture : null,
    },
  }));
  try {
    const stockBeforeReviewRefund = (await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock;
    const reviewPaymentSetup = await fetch(`${base}/api/payments/create-order`, {
      method: 'POST',
      headers: { ...headers, Cookie: cookie },
      body: JSON.stringify({ orderId: reviewOrder.id }),
    });
    assert.equal(reviewPaymentSetup.status, 200);
    assert.equal((await reviewPaymentSetup.json()).paymentOrderId, reviewProviderOrderId);
    assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, stockBeforeReviewRefund - 1, 'provider checkout reserves exactly one pizza worth of stock');
    const capturedReviewBody = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { ...reviewCapture } } },
    });
    const capturedReviewSignature = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(capturedReviewBody)
      .digest('hex');
    const capturedReviewResponse = await fetch(`${base}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        Origin: webOrigin,
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': capturedReviewSignature,
        'X-Razorpay-Event-Id': 'integration-refund-review-capture-1',
      },
      body: capturedReviewBody,
    });
    assert.equal(capturedReviewResponse.status, 200);
    assert.equal((await capturedReviewResponse.json()).status, 'review_required');
    const heldReviewOrder = await Order.findById(reviewOrder.id).lean();
    assert.equal(heldReviewOrder.status, 'payment_review');
    assert.equal(heldReviewOrder.paymentStatus, 'paid');
    assert.equal(heldReviewOrder.paymentReviewRequired, true);
    assert.equal(heldReviewOrder.paymentReviewReason, 'captured_amount_mismatch');
    assert.equal(heldReviewOrder.inventoryReserved, true, 'a captured-payment mismatch must retain the stock hold');
    assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, stockBeforeReviewRefund - 1);

    // The API service submits the refund through its native idempotency header.
    // Intercept only the Razorpay refund URL; local HTTP requests still hit the real app.
    const originalFetch = globalThis.fetch;
    const refundProviderRequests = [];
    globalThis.fetch = async (input, options) => {
      const url = typeof input === 'string' ? input : input?.url;
      if (url === `https://api.razorpay.com/v1/payments/${encodeURIComponent(reviewProviderPaymentId)}/refund`) {
        refundProviderRequests.push({ url, options });
        return new Response(JSON.stringify({
          id: reviewRefundId,
          payment_id: reviewProviderPaymentId,
          amount: reviewCapturedAmount,
          currency: 'INR',
          status: 'pending',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return originalFetch(input, options);
    };

    let refundRequest;
    try {
      refundRequest = await fetch(`${base}/api/admin/orders/${reviewOrder.id}/refund`, {
        method: 'POST',
        headers: { ...headers, Cookie: adminCookie },
        body: JSON.stringify({ paymentId: reviewProviderPaymentId }),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(refundRequest.status, 200, 'authorized admin can submit a safe full-refund recovery');
    const refundRequestBody = await refundRequest.json();
    assert.equal(refundRequestBody.refundStatus, 'pending');
    assert.equal(refundRequestBody.paymentStatus, 'paid');
    assert.equal(refundProviderRequests.length, 1);
    assert.equal(refundProviderRequests[0].options.method, 'POST');
    assert.equal(refundProviderRequests[0].options.headers['X-Refund-Idempotency'], `pizza-house-${String(reviewOrder.id).toLowerCase()}-full-refund`);
    assert.equal(JSON.parse(refundProviderRequests[0].options.body).amount, reviewCapturedAmount);

    const pendingRefundOrder = await Order.findById(reviewOrder.id).lean();
    assert.equal(pendingRefundOrder.refundStatus, 'pending');
    assert.equal(pendingRefundOrder.paymentStatus, 'paid');
    assert.equal(pendingRefundOrder.status, 'payment_review');
    assert.equal(pendingRefundOrder.inventoryReserved, true, 'stock is not restored until the provider confirms the refund');
    assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, stockBeforeReviewRefund - 1);

    const processedRefundBody = JSON.stringify({
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: reviewRefundId,
            payment_id: reviewProviderPaymentId,
            amount: reviewCapturedAmount,
            currency: 'INR',
            status: 'processed',
          },
        },
      },
    });
    const processedRefundSignature = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(processedRefundBody)
      .digest('hex');
    const processedRefundHeaders = {
      Origin: webOrigin,
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': processedRefundSignature,
      'X-Razorpay-Event-Id': 'integration-refund-processed-1',
    };
    const processedRefundResponse = await fetch(`${base}/api/payments/webhook`, {
      method: 'POST',
      headers: processedRefundHeaders,
      body: processedRefundBody,
    });
    assert.equal(processedRefundResponse.status, 200);
    assert.equal((await processedRefundResponse.json()).status, 'processed');

    const refundedOrder = await Order.findById(reviewOrder.id).lean();
    assert.equal(refundedOrder.refundStatus, 'processed');
    assert.equal(refundedOrder.paymentStatus, 'refunded');
    assert.equal(refundedOrder.status, 'cancelled');
    assert.equal(refundedOrder.paymentReviewRequired, false);
    assert.equal(refundedOrder.paymentReviewReason, null);
    assert.equal(refundedOrder.inventoryReserved, false);
    assert.equal(refundedOrder.stockReservationExpiresAt, null);
    assert.equal(refundedOrder.razorpayRefundId, reviewRefundId);
    assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, stockBeforeReviewRefund, 'inventory must be restored only after the confirmed refund');

    const { default: PaymentWebhookReceipt } = await import('../src/models/PaymentWebhookReceipt.js');
    const reviewCaptureReceipt = await PaymentWebhookReceipt.findOne({ eventId: 'integration-refund-review-capture-1' }).lean();
    assert.equal(reviewCaptureReceipt.status, 'processed');
    assert.equal(reviewCaptureReceipt.reason, 'resolved_by_full_refund');

    const duplicateRefundResponse = await fetch(`${base}/api/payments/webhook`, {
      method: 'POST',
      headers: processedRefundHeaders,
      body: processedRefundBody,
    });
    assert.equal(duplicateRefundResponse.status, 200);
    assert.equal((await duplicateRefundResponse.json()).duplicate, true);
    assert.equal((await Order.findById(reviewOrder.id).lean()).paymentStatus, 'refunded');
    assert.equal((await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock, stockBeforeReviewRefund, 'replayed refund webhook must not restore inventory twice');
  } finally {
    restoreRefundProvider();
  }

  const adminQueueResponse = await fetch(`${base}/api/admin/orders`, {
    headers: { Origin: webOrigin, Cookie: adminCookie },
  });
  assert.equal(adminQueueResponse.status, 200);
  const adminQueue = (await adminQueueResponse.json()).orders;
  assert.ok(adminQueue.some((order) => String(order.id) === String(createdOrder.id)), 'admin queue should contain the customer order');

  // Provision separate kitchen and delivery accounts through the authenticated admin API.
  const createKitchen = await fetch(base + '/api/admin/staff', {
    method: 'POST',
    headers: { ...headers, Cookie: adminCookie },
    body: JSON.stringify({ name: 'Kitchen QA', email: 'kitchen-integration@example.test', password: 'KitchenPass123', role: 'kitchen' }),
  });
  assert.equal(createKitchen.status, 201);
  const kitchenStaff = (await createKitchen.json()).staff;
  assert.equal(kitchenStaff.role, 'kitchen');
  assert.equal(kitchenStaff.active, true);

  const createDelivery = await fetch(base + '/api/admin/staff', {
    method: 'POST',
    headers: { ...headers, Cookie: adminCookie },
    body: JSON.stringify({ name: 'Delivery QA', email: 'delivery-integration@example.test', password: 'DeliveryPass123', role: 'delivery' }),
  });
  assert.equal(createDelivery.status, 201);
  const deliveryStaff = (await createDelivery.json()).staff;
  assert.equal(deliveryStaff.role, 'delivery');

  const escalationAttempt = await fetch(base + '/api/admin/staff', {
    method: 'POST',
    headers: { ...headers, Cookie: adminCookie },
    body: JSON.stringify({ name: 'Escalation QA', email: 'escalation-integration@example.test', password: 'KitchenPass123', role: 'admin' }),
  });
  assert.equal(escalationAttempt.status, 400, 'staff creation must never grant admin access');

  const signInStaff = async (email, password, expectedRole, newPassword) => {
    const response = await fetch(base + '/api/auth/staff/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200, 'provisioned staff should be able to sign in');
    const result = await response.json();
    assert.equal(result.user.role, expectedRole);
    assert.equal(result.user.mustChangePassword, true, 'new staff must rotate the temporary password');
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    const session = cookies.find(value => value.startsWith('pizza_session='));
    assert.ok(session);
    const initialCookie = session.split(';', 1)[0];

    const blockedQueue = await fetch(base + '/api/ops/orders', { headers: { Origin: webOrigin, Cookie: initialCookie } });
    assert.equal(blockedQueue.status, 428, 'the temporary password must block operations access');

    const changeResponse = await fetch(base + '/api/auth/staff/change-password', {
      method: 'POST',
      headers: { ...headers, Cookie: initialCookie },
      body: JSON.stringify({ currentPassword: password, newPassword }),
    });
    assert.equal(changeResponse.status, 200);
    const changed = await changeResponse.json();
    assert.equal(changed.user.mustChangePassword, false);
    const changedCookies = typeof changeResponse.headers.getSetCookie === 'function'
      ? changeResponse.headers.getSetCookie()
      : [changeResponse.headers.get('set-cookie')].filter(Boolean);
    const refreshedCookie = changedCookies.find(value => value.startsWith('pizza_session='));
    assert.ok(refreshedCookie, 'password rotation should issue a refreshed session cookie');

    const oldPassword = await fetch(base + '/api/auth/staff/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    });
    assert.equal(oldPassword.status, 401, 'the temporary password must stop working after rotation');
    return { user: changed.user, cookie: refreshedCookie.split(';', 1)[0] };
  };
  const kitchenSession = await signInStaff('kitchen-integration@example.test', 'KitchenPass123', 'kitchen', 'KitchenRotated456');
  const deliverySession = await signInStaff('delivery-integration@example.test', 'DeliveryPass123', 'delivery', 'DeliveryRotated456');

  const customerOpsDenied = await fetch(base + '/api/ops/orders', { headers: { Origin: webOrigin, Cookie: cookie } });
  assert.equal(customerOpsDenied.status, 403, 'customer accounts must not access staff queues');
  const kitchenAdminDenied = await fetch(base + '/api/admin/orders', { headers: { Origin: webOrigin, Cookie: kitchenSession.cookie } });
  assert.equal(kitchenAdminDenied.status, 403, 'kitchen staff must not access the admin queue');

  const assignResponse = await fetch(base + '/api/admin/orders/' + createdOrder.id + '/assignments', {
    method: 'PATCH',
    headers: { ...headers, Cookie: adminCookie },
    body: JSON.stringify({ kitchenStaffId: kitchenStaff.id, deliveryStaffId: deliveryStaff.id }),
  });
  assert.equal(assignResponse.status, 200);
  const assignedResult = await assignResponse.json();
  assert.equal(assignedResult.order.kitchenStaff.name, 'Kitchen QA');
  assert.equal(assignedResult.order.deliveryStaff.name, 'Delivery QA');
  assert.equal(assignedResult.order.fulfillmentMode, 'simulated');

  const kitchenQueue = await fetch(base + '/api/ops/orders', { headers: { Origin: webOrigin, Cookie: kitchenSession.cookie } });
  assert.equal(kitchenQueue.status, 200);
  assert.ok((await kitchenQueue.json()).orders.some(order => String(order.id) === String(createdOrder.id)), 'kitchen queue should contain its assigned order');

  const prematureHandoff = await fetch(base + '/api/ops/orders/' + createdOrder.id + '/status', {
    method: 'PATCH',
    headers: { ...headers, Cookie: kitchenSession.cookie },
    body: JSON.stringify({ status: 'sent_to_delivery' }),
  });
  assert.equal(prematureHandoff.status, 400, 'kitchen cannot skip directly from received to dispatch');

  const startPreparation = await fetch(base + '/api/ops/orders/' + createdOrder.id + '/status', {
    method: 'PATCH',
    headers: { ...headers, Cookie: kitchenSession.cookie },
    body: JSON.stringify({ status: 'in_kitchen' }),
  });
  assert.equal(startPreparation.status, 200);
  const preparationResult = await startPreparation.json();
  assert.equal(preparationResult.order.fulfillmentMode, 'simulated');
  assert.ok(preparationResult.order.kitchenStartedAt);

  const deliveryQueueBeforeDispatch = await fetch(base + '/api/ops/orders', { headers: { Origin: webOrigin, Cookie: deliverySession.cookie } });
  assert.equal(deliveryQueueBeforeDispatch.status, 200);
  assert.ok((await deliveryQueueBeforeDispatch.json()).orders.some(order => String(order.id) === String(createdOrder.id)), 'assigned delivery staff can see a kitchen-stage job');
  const prematureDelivery = await fetch(base + '/api/ops/orders/' + createdOrder.id + '/status', {
    method: 'PATCH',
    headers: { ...headers, Cookie: deliverySession.cookie },
    body: JSON.stringify({ status: 'delivered' }),
  });
  assert.equal(prematureDelivery.status, 400, 'delivery staff cannot mark an undispatched order delivered');

  const dispatchResponse = await fetch(base + '/api/ops/orders/' + createdOrder.id + '/status', {
    method: 'PATCH',
    headers: { ...headers, Cookie: kitchenSession.cookie },
    body: JSON.stringify({ status: 'sent_to_delivery' }),
  });
  assert.equal(dispatchResponse.status, 200);
  const dispatchResult = await dispatchResponse.json();
  assert.equal(dispatchResult.order.fulfillmentMode, 'simulated');
  assert.ok(dispatchResult.order.dispatchedAt);

  const deliveryQueueAfterDispatch = await fetch(base + '/api/ops/orders', { headers: { Origin: webOrigin, Cookie: deliverySession.cookie } });
  assert.equal(deliveryQueueAfterDispatch.status, 200);
  assert.ok((await deliveryQueueAfterDispatch.json()).orders.some(order => String(order.id) === String(createdOrder.id)), 'driver queue should contain dispatched assigned orders');

  const deliveredResponse = await fetch(base + '/api/ops/orders/' + createdOrder.id + '/status', {
    method: 'PATCH',
    headers: { ...headers, Cookie: deliverySession.cookie },
    body: JSON.stringify({ status: 'delivered' }),
  });
  assert.equal(deliveredResponse.status, 200);
  const deliveredResult = await deliveredResponse.json();
  assert.equal(deliveredResult.order.fulfillmentMode, 'simulated');
  assert.ok(deliveredResult.order.deliveredAt);

  const finalCustomerHistory = await fetch(base + '/api/orders/my', {
    headers: { Origin: webOrigin, Cookie: cookie },
  });
  assert.equal(finalCustomerHistory.status, 200);
  const finalHistoryBody = await finalCustomerHistory.json();
  const progressedOrder = finalHistoryBody.orders.find(order => String(order.id) === String(createdOrder.id));
  assert.ok(progressedOrder);
  assert.equal(progressedOrder.status, 'delivered');
  assert.ok(progressedOrder.kitchenStartedAt);
  assert.ok(progressedOrder.dispatchedAt);
  assert.ok(progressedOrder.deliveredAt);
  assert.equal(progressedOrder.paymentStatus, 'paid');

  const disableDriver = await fetch(base + '/api/admin/staff/' + deliveryStaff.id + '/active', {
    method: 'PATCH',
    headers: { ...headers, Cookie: adminCookie },
    body: JSON.stringify({ active: false }),
  });
  const disableDriverBody = await disableDriver.json();
  assert.equal(disableDriver.status, 200, JSON.stringify({ staffId: deliveryStaff.id, response: disableDriverBody }));
  assert.equal(disableDriverBody.staff.active, false);
  const disabledQueue = await fetch(base + '/api/ops/orders', { headers: { Origin: webOrigin, Cookie: deliverySession.cookie } });
  assert.equal(disabledQueue.status, 403, 'disabling a staff account must revoke its active session');

  // Provider rejects the configured Test Mode credential pair after the database reservation is committed.
  // Verify the safe 502 diagnosis, stock-release compensation, and same-order retry recovery.
  const failedProviderCheckout = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie, 'Idempotency-Key': 'integration-payment-failure-recovery-0001' },
    body: JSON.stringify(createOrderPayload),
  });
  assert.equal(failedProviderCheckout.status, 201);
  const failedProviderOrder = (await failedProviderCheckout.json()).order;
  const stockBeforeProviderFailure = (await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock;

  const restoreFailingProvider = setRazorpayClientFactoryForIntegrationTests(() => ({
    orders: {
      create: async () => {
        throw Object.assign(new Error('private provider response text must not reach the browser'), {
          statusCode: 401,
          error: { code: 'BAD_REQUEST_ERROR', description: 'credentials rejected; must not be exposed' },
        });
      },
    },
  }));
  try {
    const failedPaymentSetup = await fetch(`${base}/api/payments/create-order`, {
      method: 'POST',
      headers: { ...headers, Cookie: cookie },
      body: JSON.stringify({ orderId: failedProviderOrder.id }),
    });
    assert.equal(failedPaymentSetup.status, 502, 'provider authentication failure is an upstream error, not a customer-session 401');
    assert.equal(
      (await failedPaymentSetup.json()).error,
      'Razorpay rejected the configured Test Mode credentials. Check that RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are the matching Test Mode pair. No payment was started.',
    );

    const releasedOrder = await Order.findById(failedProviderOrder.id).lean();
    assert.equal(releasedOrder.status, 'pending_payment', 'the customer can retry checkout on the same order');
    assert.equal(releasedOrder.paymentStatus, 'pending');
    assert.equal(releasedOrder.inventoryReserved, false);
    assert.equal(releasedOrder.paymentOrderCreationInProgress, false);
    assert.equal(releasedOrder.stockReservedAt, null);
    assert.equal(releasedOrder.stockReservationExpiresAt, null);
    assert.equal(releasedOrder.razorpayOrderId, null);
    assert.equal(
      (await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock,
      stockBeforeProviderFailure,
      'a provider outage must not permanently consume ingredient stock',
    );
  } finally {
    restoreFailingProvider();
  }

  const restoreRetryProvider = setRazorpayClientFactoryForIntegrationTests(() => ({
    orders: {
      create: async ({ amount, currency }) => ({ id: 'order_test_auth_e2e_recovered', amount, currency }),
    },
  }));
  try {
    const recoveredPaymentSetup = await fetch(`${base}/api/payments/create-order`, {
      method: 'POST',
      headers: { ...headers, Cookie: cookie },
      body: JSON.stringify({ orderId: failedProviderOrder.id }),
    });
    assert.equal(recoveredPaymentSetup.status, 200, 'the same unpaid order should be retryable after provider recovery');
    const recoveredPayment = await recoveredPaymentSetup.json();
    assert.equal(recoveredPayment.paymentOrderId, 'order_test_auth_e2e_recovered');
    assert.equal(recoveredPayment.amount, failedProviderOrder.total * 100);
    assert.equal(recoveredPayment.currency, 'INR');

    const recoveredOrder = await Order.findById(failedProviderOrder.id).lean();
    assert.equal(recoveredOrder.inventoryReserved, true);
    assert.equal(recoveredOrder.paymentOrderCreationInProgress, false);
    assert.equal(recoveredOrder.razorpayOrderId, 'order_test_auth_e2e_recovered');
    assert.equal(
      (await InventoryItem.findOne({ key: 'base:classic' }).lean()).stock,
      stockBeforeProviderFailure - 2,
      'retry should reserve ingredients exactly once',
    );
  } finally {
    restoreRetryProvider();
  }

  const logout = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: webOrigin, Cookie: cookie },
  });
  assert.equal(logout.status, 200);
  assert.equal(logout.headers.get('access-control-allow-credentials'), 'true');
  const clearedCookies = typeof logout.headers.getSetCookie === 'function'
    ? logout.headers.getSetCookie()
    : [logout.headers.get('set-cookie')].filter(Boolean);
  assert.ok(clearedCookies.some((value) => value.startsWith('pizza_session=')), 'logout should clear the session cookie');

  const afterLogout = await fetch(`${base}/api/auth/me`, { headers: { Origin: webOrigin, Cookie: '' } });
  assert.equal(afterLogout.status, 401, 'cleared session must no longer authorize protected routes');
});
