import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const KEYS = ['NODE_ENV', 'MONGODB_URI', 'RESEND_API_KEY', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];

test('order notification outbox deduplicates receipts, retries failures and labels Test Mode clearly', async (t) => {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const key of KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await mongoose.disconnect().catch(() => {});
    await mongo.stop();
  });
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = mongo.getUri('pizza_house_notifications');
  process.env.RESEND_API_KEY = 're_test_notification_only';
  process.env.MAIL_FROM = 'Pizza House <orders@example.test>';
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  await mongoose.connect(process.env.MONGODB_URI);

  const [{ default: User }, { default: Order }, { default: OrderNotification }, service] = await Promise.all([
    import('../src/models/User.js'), import('../src/models/Order.js'),
    import('../src/models/OrderNotification.js'), import('../src/services/orderNotifications.js'),
  ]);
  await User.init(); await Order.init(); await OrderNotification.init();
  const user = await User.create({
    name: 'Notification Test Customer', email: 'notification-test@example.test',
    passwordHash: 'test-only-not-a-login-hash', role: 'user', emailVerifiedAt: new Date(),
  });
  const order = await Order.create({
    orderNumber: 'PH-NOTIFY-QA', user: user._id,
    items: [{ name:'Margherita Classic', quantity:1, unitPrice:249, lineTotal:249,
      ingredients:{ base:'classic', sauce:'classic-tomato', cheese:'mozzarella', vegetables:['tomato'] },
      inventoryKeys:['base:classic','sauce:classic-tomato','cheese:mozzarella','vegetable:tomato'] }],
    subtotal:249, deliveryFee:29, total:278,
    deliveryDetails:{ recipientName:'Notification Test Customer', phone:'9876543210', addressLine:'12 Secret Test Street',
      landmark:'Private Test Landmark', city:'Meerut', state:'Uttar Pradesh', postalCode:'250001', instructions:'Keep this address out of email.' },
    status:'order_received', paymentStatus:'paid', paymentMode:'test', razorpayPaymentId:'pay_test_notification',
  });
  assert.equal(await service.enqueueOrderNotification(order, 'payment_confirmed'), true);
  assert.equal(await service.enqueueOrderNotification(order, 'payment_confirmed'), false);
  assert.equal(await OrderNotification.countDocuments({ order: order._id }), 1);

  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    if (requests.length === 1) return new Response(JSON.stringify({ id:'email_test_receipt_1' }), {
      status:200, headers:{ 'content-type':'application/json' },
    });
    return new Response(JSON.stringify({ message:'SENSITIVE_PROVIDER_RESPONSE_SHOULD_NOT_BE_STORED' }), {
      status:422, headers:{ 'content-type':'application/json' },
    });
  };
  assert.deepEqual(await service.processOrderNotificationQueue({ batchSize:1 }), { processed:1, failed:0, dead:0, skipped:false });
  const sent = await OrderNotification.findOne({ order:order._id, eventType:'payment_confirmed' }).lean();
  assert.equal(sent.deliveryStatus, 'sent');
  assert.equal(sent.providerMessageId, 'email_test_receipt_1');
  assert.ok(requests[0].body.subject.startsWith('[TEST MODE]'));
  assert.match(requests[0].body.text, /sandbox-only status/i);
  assert.match(requests[0].body.html, /TEST MODE NOTICE/);
  assert.equal(requests[0].body.text.includes('12 Secret Test Street'), false);
  assert.equal(requests[0].body.html.includes('9876543210'), false);
  assert.equal(requests[0].body.html.includes('Private Test Landmark'), false);

  order.status = 'in_kitchen'; await order.save();
  assert.equal(await service.enqueueOrderNotification(order, 'status_changed'), true);
  assert.deepEqual(await service.processOrderNotificationQueue({ batchSize:1 }), { processed:0, failed:1, dead:0, skipped:false });
  const retryable = await OrderNotification.findOne({ order:order._id, eventType:'status_changed' }).lean();
  assert.equal(retryable.deliveryStatus, 'queued');
  assert.equal(retryable.attempts, 1);
  assert.ok(retryable.nextAttemptAt > new Date());
  assert.doesNotMatch(retryable.lastError, /SENSITIVE_PROVIDER_RESPONSE/);
  assert.ok(requests[1].body.subject.startsWith('[TEST MODE]'));
  assert.match(requests[1].body.text, /no real kitchen or delivery partner is contacted/i);

  delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
  assert.deepEqual(await service.processOrderNotificationQueue({ batchSize:10 }), { processed:0, failed:0, dead:0, skipped:true });
  const queued = await OrderNotification.findById(retryable._id).lean();
  assert.equal(queued.deliveryStatus, 'queued');
  assert.equal(queued.attempts, 1);
  const review = service.formatOrderNotification({ orderNumber:'PH-REVIEW-QA', eventType:'payment_review',
    status:'payment_review', paymentStatus:'paid', paymentMode:'test', total:278, refundAmount:null, items:[] });
  assert.match(review.subject, /payment needs review/);
  assert.match(review.text, /Do not pay again/);
});
