import test from 'node:test';
import assert from 'node:assert/strict';
import { createFullRefundIdempotencyKey, classifyRefundWebhook } from '../src/utils/paymentRefund.js';

const baseOrder = (overrides = {}) => ({
  _id: '64b000000000000000000001',
  total: 278,
  razorpayOrderId: 'order_test_123',
  razorpayPaymentId: 'pay_test_123',
  paymentStatus: 'paid',
  status: 'payment_review',
  paymentReviewRequired: true,
  refundStatus: 'requested',
  refundIdempotencyKey: 'pizza-house-64b000000000000000000001-full-refund',
  refundAmount: 27800,
  razorpayRefundId: null,
  ...overrides,
});

const refund = (overrides = {}) => ({
  id: 'rfnd_test_123',
  payment_id: 'pay_test_123',
  amount: 27800,
  currency: 'INR',
  status: 'pending',
  ...overrides,
});

test('full-refund idempotency keys are deterministic and only accept Mongo ObjectIds', () => {
  assert.equal(createFullRefundIdempotencyKey('64B000000000000000000001'), 'pizza-house-64b000000000000000000001-full-refund');
  assert.equal(createFullRefundIdempotencyKey('not-an-object-id'), null);
  assert.equal(createFullRefundIdempotencyKey(null), null);
});

test('a matching refund.created event may be recorded as pending', () => {
  assert.deepEqual(classifyRefundWebhook('refund.created', refund(), baseOrder()), {
    action: 'apply', status: 'pending', refundId: 'rfnd_test_123', amount: 27800,
  });
});

test('a matching refund.processed event can finalize the full refund', () => {
  assert.deepEqual(classifyRefundWebhook('refund.processed', refund({ status: 'processed' }), baseOrder()), {
    action: 'apply', status: 'processed', refundId: 'rfnd_test_123', amount: 27800,
  });
});

test('refund.failed stays explicit and requires manual review', () => {
  assert.deepEqual(classifyRefundWebhook('refund.failed', refund({ status: 'failed' }), baseOrder()), {
    action: 'apply', status: 'failed', refundId: 'rfnd_test_123', amount: 27800,
  });
});

test('invalid payloads, unknown payments and unrelated refunds fail closed', () => {
  assert.deepEqual(classifyRefundWebhook('refund.processed', null, baseOrder()), { action: 'review', reason: 'invalid_refund_payload' });
  assert.deepEqual(classifyRefundWebhook('refund.processed', refund(), null), { action: 'review', reason: 'refund_payment_order_not_found' });
  assert.deepEqual(classifyRefundWebhook('refund.processed', refund({ payment_id: 'pay_other' }), baseOrder()), { action: 'review', reason: 'refund_payment_mismatch' });
  assert.deepEqual(classifyRefundWebhook('refund.processed', refund({ currency: 'USD' }), baseOrder()), { action: 'review', reason: 'invalid_refund_payload' });
  assert.deepEqual(classifyRefundWebhook('refund.processed', refund({ amount: 100 }), baseOrder()), { action: 'review', reason: 'refund_amount_mismatch' });
});

test('refunds not initiated by this application require manual review', () => {
  assert.deepEqual(classifyRefundWebhook('refund.processed', refund(), baseOrder({ refundIdempotencyKey: null })), {
    action: 'review', reason: 'refund_not_requested_by_application',
  });
});

test('a second refund ID cannot silently replace an already processed refund', () => {
  assert.deepEqual(classifyRefundWebhook('refund.processed', refund({ id: 'rfnd_second' }), baseOrder({
    paymentStatus: 'refunded', refundStatus: 'processed', razorpayRefundId: 'rfnd_first',
  })), { action: 'review', reason: 'additional_refund_requires_manual_review' });
});

test('duplicate delivery of the already-applied refund is idempotent', () => {
  assert.deepEqual(classifyRefundWebhook('refund.processed', refund({ status: 'processed' }), baseOrder({
    paymentStatus: 'refunded', refundStatus: 'processed', razorpayRefundId: 'rfnd_test_123',
  })), { action: 'already_processed', status: 'processed', refundId: 'rfnd_test_123' });
});
