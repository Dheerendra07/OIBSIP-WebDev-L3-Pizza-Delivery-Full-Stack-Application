import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePendingVerification, serializePendingVerification } from '../src/pendingPayment.js';

const attempt = {
  orderId: '64b000000000000000000001',
  response: {
    razorpay_order_id: 'order_test_123',
    razorpay_payment_id: 'pay_test_123',
    razorpay_signature: 'a'.repeat(64),
    ignored_extra: 'not needed for retry',
  },
};

test('pending payment verification is safely serialized and restored for retry', () => {
  const saved = serializePendingVerification(attempt);
  assert.ok(saved);
  assert.deepEqual(parsePendingVerification(saved), {
    orderId: attempt.orderId,
    response: {
      razorpay_order_id: 'order_test_123',
      razorpay_payment_id: 'pay_test_123',
      razorpay_signature: 'a'.repeat(64),
    },
  });
});

test('malformed or incomplete saved payment attempts are rejected', () => {
  assert.equal(parsePendingVerification('not-json'), null);
  assert.equal(parsePendingVerification('{}'), null);
  assert.equal(parsePendingVerification(JSON.stringify({ ...attempt, orderId: 'bad' })), null);
  assert.equal(parsePendingVerification(JSON.stringify({ orderId: attempt.orderId, response: { razorpay_order_id: 'order_test_123' } })), null);
  assert.equal(serializePendingVerification({ orderId: 'bad', response: {} }), null);
});
