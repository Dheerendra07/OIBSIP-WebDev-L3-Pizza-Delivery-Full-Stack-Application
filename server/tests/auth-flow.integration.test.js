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
        return { id: mockProviderOrderId, amount, currency };
      },
      fetchPayments: async (orderId) => providerPaymentsByOrderId.get(orderId) || { items: [] },
    },
    payments: {
      fetch: async (id) => ({
        id,
        order_id: mockProviderOrderId,
        amount: 52700,
        currency: 'INR',
        status: 'captured',
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

  const adminQueueResponse = await fetch(`${base}/api/admin/orders`, {
    headers: { Origin: webOrigin, Cookie: adminCookie },
  });
  assert.equal(adminQueueResponse.status, 200);
  const adminQueue = (await adminQueueResponse.json()).orders;
  assert.ok(adminQueue.some((order) => String(order.id) === String(createdOrder.id)), 'admin queue should contain the customer order');

  // A Test Mode payment is useful for validating checkout, but it must never authorize
  // real kitchen/delivery fulfilment in production. Assert the controller blocks the
  // transition and leaves the paid order in its initial state.
  const testModeFulfillment = await fetch(`${base}/api/admin/orders/${createdOrder.id}/status`, {
    method: 'PATCH',
    headers: { ...headers, Cookie: adminCookie },
    body: JSON.stringify({ status: 'in_kitchen' }),
  });
  assert.equal(testModeFulfillment.status, 409, 'a Test Mode order must not enter real fulfilment');
  const testModeFulfillmentBody = await testModeFulfillment.json();
  assert.match(testModeFulfillmentBody.error || '', /Real fulfillment is blocked/i);
  const unchangedPaidOrder = await Order.findById(createdOrder.id).lean();
  assert.equal(unchangedPaidOrder.status, 'order_received', 'blocked fulfilment must not mutate the order');
  assert.equal(unchangedPaidOrder.paymentStatus, 'paid', 'the payment verification result must remain intact');

  const finalCustomerHistory = await fetch(`${base}/api/orders/my`, {
    headers: { Origin: webOrigin, Cookie: cookie },
  });
  assert.equal(finalCustomerHistory.status, 200);
  assert.equal((await finalCustomerHistory.json()).orders[0].status, 'order_received', 'customer history must retain the paid, unfulfilled Test Mode order');

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
