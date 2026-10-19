import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOrderPayments, LATE_CAPTURE_GRACE_MS } from '../src/utils/paymentReconciliation.js';

const expected = { orderId: 'order_test_123', amountPaise: 27800 };
const payment = (overrides = {}) => ({ id: 'pay_test_123', order_id: expected.orderId, amount: expected.amountPaise, currency: 'INR', status: 'captured', ...overrides });

test('reconciliation accepts a captured payment only when order, amount and currency match', () => assert.deepEqual(classifyOrderPayments([payment()], expected), { state: 'captured', payment: payment() }));
test('reconciliation preserves stock and exposes a captured payment with a mismatched amount', () => {
  const result = classifyOrderPayments([payment({ amount: expected.amountPaise - 100 })], expected);
  assert.equal(result.state, 'mismatch');
  assert.equal(result.reason, 'captured_amount_mismatch');
  assert.equal(result.payment.id, 'pay_test_123');
});
test('reconciliation exposes a captured payment with a mismatched currency for review', () => {
  const result = classifyOrderPayments([payment({ currency: 'USD' })], expected);
  assert.equal(result.state, 'mismatch');
  assert.equal(result.reason, 'captured_currency_mismatch');
  assert.equal(result.payment.id, 'pay_test_123');
});
test('reconciliation exposes a captured payment linked to a different order for review', () => {
  const result = classifyOrderPayments([payment({ order_id: 'order_other' })], expected);
  assert.equal(result.state, 'mismatch');
  assert.equal(result.reason, 'provider_order_mismatch');
  assert.equal(result.payment.id, 'pay_test_123');
});
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

test('multiple captured payments require review even when one matches the expected order', () => {
  const matching = payment({ id: 'pay_primary' });
  const duplicate = payment({ id: 'pay_second', amount: expected.amountPaise + 100 });
  const result = classifyOrderPayments([matching, duplicate], expected);
  assert.equal(result.state, 'mismatch');
  assert.equal(result.reason, 'multiple_captured_payments_for_order');
  assert.equal(result.payment.id, 'pay_primary');
  assert.deepEqual(result.payments.map((item) => item.id), ['pay_primary', 'pay_second']);
});
