/**
 * Razorpay documents that a failed payment can later become captured and that
 * late-authorization checks may continue for up to 3 days. Keep inventory held
 * for that provider window plus a small delivery margin before releasing stock.
 * Docs: https://github.com/razorpay/markdown-docs/blob/master/webhooks/payments.md
 * Docs: https://github.com/razorpay/markdown-docs/blob/master/payments/payments/capture-settings.md
 */
export const LATE_CAPTURE_GRACE_MS = 73 * 60 * 60 * 1000;

/** Classify provider payments before an expired inventory reservation is released. */
export function classifyOrderPayments(items, { orderId, amountPaise, now = Date.now(), lateCaptureGraceMs = LATE_CAPTURE_GRACE_MS }) {
  const payments = Array.isArray(items) ? items : [];
  const captured = payments.filter((payment) => payment?.status === 'captured');

  // Never fulfill an order if more than one capture exists, even when one
  // individually matches the expected amount. Each captured payment must be
  // reconciled so duplicate charges are not hidden by the matching one.
  if (captured.length > 1) {
    const preferred = captured.find((payment) =>
      payment.order_id === orderId && payment.amount === amountPaise && payment.currency === 'INR',
    ) || captured[0];
    return { state: 'mismatch', reason: 'multiple_captured_payments_for_order', payment: preferred, payments: captured };
  }

  if (captured.length === 1) {
    const payment = captured[0];
    if (payment.order_id !== orderId) return { state: 'mismatch', reason: 'provider_order_mismatch', payment };
    if (payment.amount !== amountPaise) return { state: 'mismatch', reason: 'captured_amount_mismatch', payment };
    if (payment.currency !== 'INR') return { state: 'mismatch', reason: 'captured_currency_mismatch', payment };
    return { state: 'captured', payment };
  }

  if (payments.some((payment) => ['authorized', 'created'].includes(payment?.status))) return { state: 'in_flight' };

  const failed = payments.filter((payment) => payment?.status === 'failed');
  if (failed.length) {
    // Fail closed if a provider timestamp is absent or malformed: without it we
    // cannot safely establish that the late-capture window has elapsed.
    if (failed.some((payment) => !Number.isSafeInteger(payment.created_at) || payment.created_at <= 0)) {
      return { state: 'in_flight', reason: 'unknown_failed_payment_timestamp' };
    }
    const retryAtMs = Math.max(...failed.map((payment) => payment.created_at * 1000 + lateCaptureGraceMs));
    if (now < retryAtMs) return { state: 'in_flight', reason: 'late_capture_window', retryAt: new Date(retryAtMs) };
  }

  return { state: 'no_capture' };
}
