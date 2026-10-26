import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const ENV_KEYS = [
  'NODE_ENV', 'MONGODB_URI', 'JWT_SECRET', 'CLIENT_ORIGIN', 'CLIENT_BASE_URL',
  'APP_BASE_URL', 'PAYMENT_MODE', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET', 'RESEND_API_KEY', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
];

test('signed Razorpay Test Mode webhook persists a capture once, ignores nonterminal failure, and rejects unsigned events', async (t) => {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let server;

  for (const [key, value] of Object.entries({
    NODE_ENV: 'test',
    MONGODB_URI: mongo.getUri('pizza_house_payment_webhook_http'),
    JWT_SECRET: 'test-only-jwt-secret-with-enough-entropy-1234567890',
    CLIENT_ORIGIN: 'http://127.0.0.1:5173',
    CLIENT_BASE_URL: 'http://127.0.0.1:5173',
    APP_BASE_URL: 'http://127.0.0.1:4000',
    PAYMENT_MODE: 'test',
    RAZORPAY_KEY_ID: 'rzp_test_webhook_http',
    RAZORPAY_KEY_SECRET: 'test-only-razorpay-order-secret',
    RAZORPAY_WEBHOOK_SECRET: 'test-only-webhook-signing-secret',
  })) process.env[key] = value;

  t.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect().catch(() => {});
    await mongo.stop();
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  // Import only after the test environment is set: app config is intentionally
  // read once, and this file must never inherit a developer's provider secrets.
  const { default: app } = await import('../src/app.js');
  const [
    { default: User },
    { default: Order },
    { default: OrderNotification },
    { default: PaymentWebhookReceipt },
  ] = await Promise.all([
    import('../src/models/User.js'),
    import('../src/models/Order.js'),
    import('../src/models/OrderNotification.js'),
    import('../src/models/PaymentWebhookReceipt.js'),
  ]);

  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([User.init(), Order.init(), OrderNotification.init(), PaymentWebhookReceipt.init()]);

  const user = await User.create({
    name: 'Webhook Test Customer',
    email: 'webhook-customer@example.test',
    passwordHash: 'test-only-not-a-login-hash',
    role: 'user',
    emailVerifiedAt: new Date(),
  });

  const makeOrder = async ({ orderNumber, razorpayOrderId }) => Order.create({
    orderNumber,
    user: user._id,
    items: [{
      name: 'Margherita Classic',
      quantity: 1,
      unitPrice: 249,
      lineTotal: 249,
      ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['tomato'] },
      inventoryKeys: ['base:classic', 'sauce:classic-tomato', 'cheese:mozzarella', 'vegetable:tomato'],
    }],
    subtotal: 249,
    deliveryFee: 29,
    total: 278,
    deliveryDetails: {
      recipientName: 'Webhook Test Customer',
      phone: '9876543210',
      addressLine: '12 Test Green Park Road',
      city: 'Meerut',
      state: 'Uttar Pradesh',
      postalCode: '250001',
    },
    status: 'pending_payment',
    paymentStatus: 'pending',
    paymentMode: 'test',
    inventoryReserved: true,
    stockReservedAt: new Date(),
    stockReservationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    razorpayOrderId,
  });

  const sign = (body) => createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(Buffer.from(body, 'utf8'))
    .digest('hex');

  server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const capturedOrder = await makeOrder({
    orderNumber: 'PH-WEBHOOK-CAPTURE-QA',
    razorpayOrderId: 'order_test_webhook_capture',
  });
  const capturedEvent = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_test_webhook_capture',
          order_id: 'order_test_webhook_capture',
          amount: 27800,
          currency: 'INR',
          status: 'captured',
          amount_refunded: 0,
        },
      },
    },
  };
  const capturedBody = JSON.stringify(capturedEvent);
  const eventId = 'evt_test_capture_http_once';

  const captureResponse = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': sign(capturedBody),
      'X-Razorpay-Event-Id': eventId,
    },
    body: capturedBody,
  });
  assert.equal(captureResponse.status, 200);
  assert.deepEqual(await captureResponse.json(), { received: true, status: 'processed' });

  const paidOrder = await Order.findById(capturedOrder._id).lean();
  assert.equal(paidOrder.paymentStatus, 'paid');
  assert.equal(paidOrder.status, 'order_received');
  assert.equal(paidOrder.razorpayPaymentId, 'pay_test_webhook_capture');
  assert.equal(paidOrder.inventoryReserved, false);
  assert.ok(paidOrder.paidAt);
  assert.equal(await PaymentWebhookReceipt.countDocuments({ eventId }), 1);
  assert.equal(await OrderNotification.countDocuments({ order: capturedOrder._id, eventType: 'payment_confirmed' }), 1);

  const replayResponse = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': sign(capturedBody),
      'X-Razorpay-Event-Id': eventId,
    },
    body: capturedBody,
  });
  assert.equal(replayResponse.status, 200);
  assert.deepEqual(await replayResponse.json(), { received: true, duplicate: true, status: 'processed' });
  assert.equal(await PaymentWebhookReceipt.countDocuments({ eventId }), 1, 'the duplicate event must not add a second receipt');
  assert.equal(await OrderNotification.countDocuments({ order: capturedOrder._id, eventType: 'payment_confirmed' }), 1, 'replay must not queue duplicate confirmation email');
  assert.equal((await Order.findById(capturedOrder._id).lean()).paidAt.toISOString(), paidOrder.paidAt.toISOString());

  const pendingOrder = await makeOrder({
    orderNumber: 'PH-WEBHOOK-FAILED-QA',
    razorpayOrderId: 'order_test_webhook_failed',
  });
  const failedBody = JSON.stringify({
    event: 'payment.failed',
    payload: { payment: { entity: {
      id: 'pay_test_webhook_failed',
      order_id: 'order_test_webhook_failed',
      amount: 27800,
      currency: 'INR',
      status: 'failed',
    } } },
  });
  const failedEventId = 'evt_test_failed_nonterminal';
  const failedResponse = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': sign(failedBody),
      'X-Razorpay-Event-Id': failedEventId,
    },
    body: failedBody,
  });
  assert.equal(failedResponse.status, 200);
  assert.deepEqual(await failedResponse.json(), { received: true, status: 'ignored' });
  const stillPending = await Order.findById(pendingOrder._id).lean();
  assert.equal(stillPending.paymentStatus, 'pending');
  assert.equal(stillPending.status, 'pending_payment');
  assert.equal(stillPending.inventoryReserved, true);
  assert.equal(await PaymentWebhookReceipt.countDocuments({ eventId: failedEventId, status: 'ignored' }), 1);

  const unsignedEventId = 'evt_test_invalid_signature_no_receipt';
  const unsignedResponse = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': 'invalid-signature',
      'X-Razorpay-Event-Id': unsignedEventId,
    },
    body: capturedBody,
  });
  assert.equal(unsignedResponse.status, 401);
  assert.deepEqual(await unsignedResponse.json(), { error: 'Invalid webhook signature' });
  assert.equal(await PaymentWebhookReceipt.countDocuments({ eventId: unsignedEventId }), 0);
  assert.equal((await Order.findById(capturedOrder._id).lean()).razorpayPaymentId, 'pay_test_webhook_capture');
});
