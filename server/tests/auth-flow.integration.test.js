import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

test('production auth HTTP flow: signup, login cookie, current user, protected orders and logout', async (t) => {
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const webOrigin = 'https://pizza-house-web-n75h.onrender.com';
  const apiOrigin = 'https://pizza-house-api.onrender.com';
  const env = {
    NODE_ENV: 'production',
    MONGODB_URI: mongod.getUri('pizza_house_auth_e2e'),
    JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    JWT_EXPIRES_IN: '1d',
    CLIENT_ORIGIN: webOrigin,
    CLIENT_BASE_URL: webOrigin,
    APP_BASE_URL: apiOrigin,
    COOKIE_SAME_SITE: 'none',
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
  // builds the exact Secure + SameSite=None cookie expected on Render.
  const { default: app } = await import('../src/app.js');
  await mongoose.connect(env.MONGODB_URI);
  const { ensureInventorySeeded, ensureAdminAccount } = await import('../src/utils/databaseBootstrap.js');
  await ensureInventorySeeded();
  await ensureAdminAccount({ env });
  const { default: Order } = await import('../src/models/Order.js');
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
  assert.match(sessionCookie, /SameSite=None/i);
  const cookie = sessionCookie.split(';', 1)[0];

  const me = await fetch(`${base}/api/auth/me`, { headers: { Origin: webOrigin, Cookie: cookie } });
  assert.equal(me.status, 200, 'session cookie should authenticate /me');
  assert.equal((await me.json()).user.email, 'auth-flow@example.com');

  const orders = await fetch(`${base}/api/orders/my`, { headers: { Origin: webOrigin, Cookie: cookie } });
  assert.equal(orders.status, 200, 'authenticated customer should load order history');
  assert.deepEqual((await orders.json()).orders, []);

  // Real HTTP order creation against isolated MongoDB: authoritative price and persistence.
  const createOrder = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify({
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
    }),
  });
  assert.equal(createOrder.status, 201, 'authenticated customer should create an order');
  const createdOrder = (await createOrder.json()).order;
  assert.ok(createdOrder?.id);
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

  // Admin fulfillment must follow the legal paid-order transition sequence.
  for (const status of ['in_kitchen', 'sent_to_delivery', 'delivered']) {
    const update = await fetch(`${base}/api/admin/orders/${createdOrder.id}/status`, {
      method: 'PATCH',
      headers: { ...headers, Cookie: adminCookie },
      body: JSON.stringify({ status }),
    });
    assert.equal(update.status, 200, `admin should be able to move paid order to ${status}`);
    assert.equal((await update.json()).order.status, status);
  }
  const finalCustomerHistory = await fetch(`${base}/api/orders/my`, {
    headers: { Origin: webOrigin, Cookie: cookie },
  });
  assert.equal(finalCustomerHistory.status, 200);
  assert.equal((await finalCustomerHistory.json()).orders[0].status, 'delivered', 'customer history should reflect admin fulfillment updates');

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
