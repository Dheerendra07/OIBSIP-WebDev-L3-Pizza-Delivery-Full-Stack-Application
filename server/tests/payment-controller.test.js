import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentOrder, getOrder, verifyPayment } from '../src/controllers/orderController.js';

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('payment verification rejects a malformed order ID before database or payment-provider lookup', async () => {
  const req = {
    body: {
      orderId: 'not-an-object-id',
      razorpay_order_id: 'order_test_123',
      razorpay_payment_id: 'pay_test_456',
      razorpay_signature: 'signature',
    },
    user: { _id: '64b000000000000000000001' },
  };
  const res = responseRecorder();
  let nextError;

  await verifyPayment(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'A valid order ID is required' });
});

test('payment verification returns a controlled 400 when required verification details are missing', async () => {
  const req = {
    body: {
      orderId: '64b000000000000000000002',
      razorpay_order_id: 'order_test_123',
      razorpay_payment_id: 'pay_test_456',
    },
    user: { _id: '64b000000000000000000001' },
  };
  const res = responseRecorder();
  let nextError;

  await verifyPayment(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'Missing payment verification details' });
});


test('payment endpoints reject non-string IDs even when Mongoose can cast their type', async () => {
  const user = { _id: '64b000000000000000000001', role: 'user' };
  const cases = [
    { handler: createPaymentOrder, req: { body: { orderId: 123 }, user }, expected: 'A valid order ID is required' },
    { handler: verifyPayment, req: { body: { orderId: 123, razorpay_order_id: 'order_test_123', razorpay_payment_id: 'pay_test_456', razorpay_signature: 'signature' }, user }, expected: 'A valid order ID is required' },
    { handler: getOrder, req: { params: { id: '123' }, user }, expected: 'Invalid order identifier' },
  ];

  for (const item of cases) {
    const res = responseRecorder();
    let nextError;
    await item.handler(item.req, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: item.expected });
  }
});
