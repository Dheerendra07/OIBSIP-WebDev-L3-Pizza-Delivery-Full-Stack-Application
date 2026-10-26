import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISSUE_CATEGORIES,
  canReportOrderIssue,
  normalizeIssueReport,
  validateIssueUpdate,
} from '../src/utils/issueRules.js';

const validReport = (overrides = {}) => ({
  orderId: '64b000000000000000000001',
  category: 'missing_item',
  description: 'One item from my order was not included.',
  ...overrides,
});
const paidOrder = (overrides = {}) => ({
  status: 'delivered',
  paymentStatus: 'paid',
  paymentReviewRequired: false,
  refundStatus: 'none',
  ...overrides,
});

test('exposes only the supported report categories', () => {
  assert.deepEqual(ISSUE_CATEGORIES, ['missing_item', 'wrong_item', 'damaged_item', 'quality_issue', 'delivery_delay', 'payment_refund', 'other']);
});

test('normalizes a valid report description without changing the selected category', () => {
  assert.deepEqual(normalizeIssueReport(validReport({ description: '  The   drink was missing.  ' })), {
    orderId: '64b000000000000000000001',
    category: 'missing_item',
    description: 'The drink was missing.',
  });
  assert.equal(normalizeIssueReport(validReport({ category: 'damaged_item' })).category, 'damaged_item');
  assert.equal(normalizeIssueReport(validReport({ category: 'payment_refund' })).category, 'payment_refund');
});

test('rejects a missing or array request body', () => {
  assert.throws(() => normalizeIssueReport(null), /valid issue report/i);
  assert.throws(() => normalizeIssueReport([]), /valid issue report/i);
});

test('rejects unknown report fields rather than silently accepting extra input', () => {
  assert.throws(() => normalizeIssueReport(validReport({ userId: 'forged-user' })), /unsupported field/i);
});

test('rejects malformed order IDs and unknown categories', () => {
  assert.throws(() => normalizeIssueReport(validReport({ orderId: '../admin' })), /valid order/i);
  assert.throws(() => normalizeIssueReport(validReport({ category: 'refund_now' })), /category/i);
});

test('requires a useful description and caps it at 600 characters', () => {
  assert.throws(() => normalizeIssueReport(validReport({ description: 'too short' })), /at least 10/i);
  assert.throws(() => normalizeIssueReport(validReport({ description: 'x'.repeat(601) })), /600 characters/i);
  assert.throws(() => normalizeIssueReport(validReport({ description: 123 })), /must be text/i);
});

test('allows issues on paid fulfilment states only', () => {
  for (const status of ['order_received', 'in_kitchen', 'sent_to_delivery', 'delivered']) {
    assert.equal(canReportOrderIssue(paidOrder({ status })), true, status);
  }
});

test('blocks food/delivery reports for unpaid, refunded, cancelled, manual-review and unknown states', () => {
  assert.equal(canReportOrderIssue(paidOrder({ paymentStatus: 'pending' })), false);
  assert.equal(canReportOrderIssue(paidOrder({ paymentStatus: 'refunded' })), false);
  assert.equal(canReportOrderIssue(paidOrder({ status: 'cancelled' })), false);
  assert.equal(canReportOrderIssue(paidOrder({ status: 'payment_review' })), false);
  assert.equal(canReportOrderIssue(paidOrder({ paymentReviewRequired: true })), false);
  assert.equal(canReportOrderIssue(paidOrder({ status: 'pending_payment' })), false);
  assert.equal(canReportOrderIssue(null), false);
});

test('allows payment support for failed/refunded orders and orders held for manual payment review', () => {
  assert.equal(canReportOrderIssue(paidOrder({
    status: 'payment_review', paymentStatus: 'pending', paymentReviewRequired: true,
  }), 'payment_refund'), true);
  assert.equal(canReportOrderIssue(paidOrder({
    status: 'cancelled', paymentStatus: 'refunded',
  }), 'payment_refund'), true);
  assert.equal(canReportOrderIssue(paidOrder({
    status: 'cancelled', paymentStatus: 'failed',
  }), 'payment_refund'), true);
  assert.equal(canReportOrderIssue(paidOrder({
    status: 'pending_payment', paymentStatus: 'pending',
  }), 'payment_refund'), false);
  assert.equal(canReportOrderIssue(paidOrder({ status: 'cancelled' }), 'damaged_item'), false);
});

test('allows an open case to move into review or resolve', () => {
  for (const status of ['under_review', 'resolved']) {
    const result = validateIssueUpdate({ status: 'open' }, { status });
    assert.equal(result.allowed, true, status);
    assert.equal(result.updates.status, status);
  }
});

test('allows an in-review case to remain in review or resolve', () => {
  assert.equal(validateIssueUpdate({ status: 'under_review' }, { status: 'under_review' }).allowed, true);
  assert.equal(validateIssueUpdate({ status: 'under_review' }, { status: 'resolved' }).allowed, true);
});

test('forbids reopening resolved cases and unknown transitions', () => {
  const result = validateIssueUpdate({ status: 'resolved' }, { status: 'under_review' });
  assert.equal(result.allowed, false);
  assert.equal(result.statusCode, 409);
  assert.equal(validateIssueUpdate({ status: 'open' }, { status: 'open' }).allowed, false);
  assert.equal(validateIssueUpdate({ status: 'unknown' }, { status: 'resolved' }).allowed, false);
});

test('normalizes customer messages and rejects invalid note payloads', () => {
  assert.deepEqual(validateIssueUpdate({ status: 'open' }, { customerUpdate: '  Call   customer back. ' }).updates, {
    customerUpdate: 'Call customer back.',
  });
  assert.equal(validateIssueUpdate({ status: 'open' }, { customerUpdate: 'x'.repeat(601) }).allowed, false);
  assert.equal(validateIssueUpdate({ status: 'open' }, { status: 'resolved', customerUpdate: 42 }).allowed, false);
});

test('rejects extra fields in admin updates', () => {
  assert.equal(validateIssueUpdate({ status: 'open' }, { status: 'resolved', user: 'forged' }).allowed, false);
});
