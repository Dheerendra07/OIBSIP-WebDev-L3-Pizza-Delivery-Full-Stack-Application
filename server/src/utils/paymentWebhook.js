import { validateDeliveryDetails } from './orderRules.js';

/**
 * Decide whether a verified provider capture can fulfill the order or must be
 * quarantined for manual reconciliation. This function never trusts client data.
 */
/**
 * A capture is safe for fulfillment only when the provider confirms that no
 * amount has already been refunded. Missing/invalid refund state is ambiguous,
 * so callers must hold the order for review rather than infer zero.
 */
export function capturedPaymentRefundReviewReason(payment) {
  if (!payment || !Number.isSafeInteger(payment.amount_refunded) || payment.amount_refunded < 0) {
    return 'captured_refund_state_unavailable';
  }
  if (payment.amount_refunded > 0) return 'captured_payment_has_prior_refund';
  return null;
}

export function classifyCapturedPayment(payment, order) {
  if (!payment || payment.status !== 'captured' ||
      typeof payment.id !== 'string' || !payment.id ||
      typeof payment.order_id !== 'string' || !payment.order_id ||
      !Number.isSafeInteger(payment.amount) || payment.amount <= 0 ||
      typeof payment.currency !== 'string') {
    return { action: 'review', reason: 'invalid_captured_payment_payload' };
  }

  if (!order) return { action: 'review', reason: 'provider_order_not_found' };

  // A duplicate capture event for an already-refunded order is historical; do
  // not reopen it simply because the provider now reports amount_refunded > 0.
  if (order.paymentStatus === 'refunded' && order.refundStatus === 'processed' &&
      order.razorpayPaymentId === payment.id) {
    return { action: 'already_processed' };
  }

  const refundStateReason = capturedPaymentRefundReviewReason(payment);
  if (refundStateReason) return { action: 'review', reason: refundStateReason };

  if (order.paymentStatus === 'paid') {
    if (order.razorpayPaymentId === payment.id) {
      return order.paymentReviewRequired
        ? { action: 'review', reason: order.paymentReviewReason || 'existing_payment_review' }
        : { action: 'already_processed' };
    }
    return { action: 'review', reason: 'multiple_captured_payments_for_order' };
  }

  if (payment.order_id !== order.razorpayOrderId) {
    return { action: 'review', reason: 'provider_order_mismatch' };
  }
  if (payment.amount !== order.total * 100) {
    return { action: 'review', reason: 'captured_amount_mismatch' };
  }
  if (payment.currency !== 'INR') {
    return { action: 'review', reason: 'captured_currency_mismatch' };
  }
  if (order.paymentStatus !== 'pending' || order.status !== 'pending_payment') {
    return { action: 'review', reason: 'order_not_awaiting_payment' };
  }
  if (!order.inventoryReserved) {
    return { action: 'review', reason: 'inventory_reservation_missing' };
  }
  try {
    validateDeliveryDetails(order.deliveryDetails);
  } catch {
    return { action: 'review', reason: 'delivery_details_missing_or_invalid' };
  }

  return { action: 'fulfill' };
}
