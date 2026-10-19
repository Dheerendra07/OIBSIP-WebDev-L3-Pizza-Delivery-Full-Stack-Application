import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCapturedPayment } from '../src/utils/paymentWebhook.js';

const payment = (overrides = {}) => ({
  id: 'pay_test_123',
  order_id: 'order_test_123',
  amount: 27800,
  currency: 'INR',
  status: 'captured',
  ...overrides,
});
const order = (overrides = {}) => ({
  razorpayOrderId: 'order_test_123',
  razorpayPaymentId: null,
  total: 278,
  paymentStatus: 'pending',
  status: 'pending_payment',
  inventoryReserved: true,
  paymentReviewRequired: false,
  deliveryDetails: { recipientName: 'Test Customer', phone: '9876543210', addressLine: '12 Green Park Road', city: 'Meerut', state: 'Uttar Pradesh', postalCode: '250001' },
  ...overrides,
});

test('a matching capture fulfills only a pending order with an active stock reservation', () => {
  assert.deepEqual(classifyCapturedPayment(payment(), order()), { action: 'fulfill' });
});

test('an event without a valid captured payment payload requires review', () => {
  assert.deepEqual(classifyCapturedPayment(null, order()), { action: 'review', reason: 'invalid_captured_payment_payload' });
  assert.deepEqual(classifyCapturedPayment(payment({ amount: '27800' }), order()), { action: 'review', reason: 'invalid_captured_payment_payload' });
  assert.deepEqual(classifyCapturedPayment(payment({ status: 'failed' }), order()), { action: 'review', reason: 'invalid_captured_payment_payload' });
});

test('unknown provider orders require review instead of being silently discarded', () => {
  assert.deepEqual(classifyCapturedPayment(payment(), null), { action: 'review', reason: 'provider_order_not_found' });
});

test('amount, currency and provider-order mismatches require review', () => {
  assert.deepEqual(classifyCapturedPayment(payment({ amount: 100 }), order()), { action: 'review', reason: 'captured_amount_mismatch' });
  assert.deepEqual(classifyCapturedPayment(payment({ currency: 'USD' }), order()), { action: 'review', reason: 'captured_currency_mismatch' });
  assert.deepEqual(classifyCapturedPayment(payment({ order_id: 'order_other' }), order()), { action: 'review', reason: 'provider_order_mismatch' });
});

test('a capture after the stock hold is gone requires manual review', () => {
  assert.deepEqual(classifyCapturedPayment(payment(), order({ inventoryReserved: false })), { action: 'review', reason: 'inventory_reservation_missing' });
});

test('a capture for an order no longer awaiting payment requires manual review', () => {
  assert.deepEqual(classifyCapturedPayment(payment(), order({ status: 'cancelled' })), { action: 'review', reason: 'order_not_awaiting_payment' });
});

test('duplicate capture for the same paid order is idempotent', () => {
  assert.deepEqual(classifyCapturedPayment(payment(), order({ paymentStatus: 'paid', razorpayPaymentId: 'pay_test_123', status: 'order_received', inventoryReserved: false })), { action: 'already_processed' });
});

test('a second captured payment for an already-paid order requires review', () => {
  assert.deepEqual(classifyCapturedPayment(payment({ id: 'pay_second' }), order({ paymentStatus: 'paid', razorpayPaymentId: 'pay_first', status: 'order_received', inventoryReserved: false })), { action: 'review', reason: 'multiple_captured_payments_for_order' });
});


test('a captured payment cannot fulfill an order without valid delivery details', () => {
  assert.deepEqual(
    classifyCapturedPayment(payment(), order({ deliveryDetails: undefined })),
    { action: 'review', reason: 'delivery_details_missing_or_invalid' },
  );
  assert.deepEqual(
    classifyCapturedPayment(payment(), order({ deliveryDetails: { ...order().deliveryDetails, phone: '12345' } })),
    { action: 'review', reason: 'delivery_details_missing_or_invalid' },
  );
});
