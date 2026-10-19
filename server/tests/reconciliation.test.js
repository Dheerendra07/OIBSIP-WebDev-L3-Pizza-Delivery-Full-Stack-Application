import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOrderPayments, LATE_CAPTURE_GRACE_MS } from '../src/utils/paymentReconciliation.js';

const expected = { orderId: 'order_test_123', amountPaise: 27800 };
const payment = (overrides = {}) => ({ id: 'pay_test_123', order_id: expected.orderId, amount: expected.amountPaise, currency: 'INR', status: 'captured', ...overrides });

test('reconciliation accepts a captured payment only when order, amount and currency match', () => assert.deepEqual(classifyOrderPayments([payment()], expected), { state: 'captured', payment: payment() }));
test('reconciliation preserves stock for a captured payment with a mismatched amount', () => assert.deepEqual(classifyOrderPayments([payment({ amount: expected.amountPaise - 100 })], expected), { state: 'mismatch' }));
test('reconciliation preserves stock for a captured payment with a mismatched currency', () => assert.deepEqual(classifyOrderPayments([payment({ currency: 'USD' })], expected), { state: 'mismatch' }));
test('reconciliation preserves stock if a captured payment is linked to a different order', () => assert.deepEqual(classifyOrderPayments([payment({ order_id: 'order_other' })], expected), { state: 'mismatch' }));
test('reconciliation defers stock release while payment is authorized or created', () => { assert.equal(classifyOrderPayments([payment({ status: 'authorized' })], expected).state, 'in_flight'); assert.equal(classifyOrderPayments([payment({ status: 'created' })], expected).state, 'in_flight'); });
test('reconciliation allows release when no capture, failed payment or in-flight attempt exists', () => { assert.equal(classifyOrderPayments([], expected).state, 'no_capture'); });

test('failed payments retain the reservation through the late-capture safety window', () => {
  const createdAt = 1_800_000_000;
  const now = createdAt * 1000 + LATE_CAPTURE_GRACE_MS - 1;
  const result = classifyOrderPayments([payment({ status: 'failed', created_at: createdAt })], { ...expected, now });
  assert.deepEqual(result, {
    state: 'in_flight',
    reason: 'late_capture_window',
    retryAt: new Date(createdAt * 1000 + LATE_CAPTURE_GRACE_MS),
  });
});

test('failed payments permit release only after the late-capture safety window elapses', () => {
  const createdAt = 1_800_000_000;
  const now = createdAt * 1000 + LATE_CAPTURE_GRACE_MS;
  assert.deepEqual(classifyOrderPayments([payment({ status: 'failed', created_at: createdAt })], { ...expected, now }), { state: 'no_capture' });
});

test('multiple failed attempts retain stock until the newest attempt window ends', () => {
  const earlier = 1_800_000_000;
  const latest = earlier + 60;
  const now = latest * 1000 + LATE_CAPTURE_GRACE_MS - 1;
  const result = classifyOrderPayments([
    payment({ id: 'pay_earlier', status: 'failed', created_at: earlier }),
    payment({ id: 'pay_latest', status: 'failed', created_at: latest }),
  ], { ...expected, now });
  assert.equal(result.state, 'in_flight');
  assert.equal(result.reason, 'late_capture_window');
  assert.equal(result.retryAt.getTime(), latest * 1000 + LATE_CAPTURE_GRACE_MS);
});

test('unknown failed-payment timestamps fail closed instead of releasing stock', () => {
  for (const created_at of [undefined, null, 0, -1, '1800000000']) {
    assert.deepEqual(classifyOrderPayments([payment({ status: 'failed', created_at })], expected), {
      state: 'in_flight',
      reason: 'unknown_failed_payment_timestamp',
    });
  }
});
