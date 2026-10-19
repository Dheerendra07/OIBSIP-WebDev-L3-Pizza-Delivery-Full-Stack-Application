const REFUND_EVENTS = new Set(['refund.created', 'refund.processed', 'refund.failed']);

export function createFullRefundIdempotencyKey(orderId) {
  if (typeof orderId !== 'string' || !/^[a-f0-9]{24}$/i.test(orderId)) return null;
  return `pizza-house-${orderId.toLowerCase()}-full-refund`;
}

/**
 * Only reconcile refunds requested by this application and tied to the exact
 * captured payment. Unknown, partial, mismatched and duplicate refunds fail closed.
 */
export function classifyRefundWebhook(eventType, refund, order) {
  if (!REFUND_EVENTS.has(eventType)) return { action: 'ignore', reason: 'unsupported_refund_event' };

  if (!refund || typeof refund !== 'object' || Array.isArray(refund) ||
      typeof refund.id !== 'string' || !refund.id ||
      typeof refund.payment_id !== 'string' || !refund.payment_id ||
      !Number.isSafeInteger(refund.amount) || refund.amount <= 0 ||
      refund.currency !== 'INR') {
    return { action: 'review', reason: 'invalid_refund_payload' };
  }

  if (!order) return { action: 'review', reason: 'refund_payment_order_not_found' };
  if (order.razorpayPaymentId !== refund.payment_id) {
    return { action: 'review', reason: 'refund_payment_mismatch' };
  }
  if (!order.refundIdempotencyKey ||
      !Number.isSafeInteger(order.refundAmount) ||
      order.refundAmount <= 0) {
    return { action: 'review', reason: 'refund_not_requested_by_application' };
  }
  if (refund.amount !== order.refundAmount) {
    return { action: 'review', reason: 'refund_amount_mismatch' };
  }
  if (order.refundStatus === 'processed' && order.razorpayRefundId && order.razorpayRefundId !== refund.id) {
    return { action: 'review', reason: 'additional_refund_requires_manual_review' };
  }
  if (order.paymentStatus === 'refunded' && order.refundStatus === 'processed' && order.razorpayRefundId === refund.id) {
    return { action: 'already_processed', status: 'processed', refundId: refund.id };
  }

  let status;
  if (eventType === 'refund.processed') status = 'processed';
  else if (eventType === 'refund.failed') status = 'failed';
  else if (refund.status === 'processed') status = 'processed';
  else if (refund.status === 'created' || refund.status === 'pending') status = 'pending';
  else if (refund.status === 'failed') status = 'failed';
  else return { action: 'review', reason: 'unknown_refund_status' };

  return { action: 'apply', status, refundId: refund.id, amount: refund.amount };
}
