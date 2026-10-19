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
  const matching = captured.find((payment) => payment.order_id === orderId && payment.amount === amountPaise && payment.currency === 'INR');
  if (matching) return { state: 'captured', payment: matching };
  if (captured.length) return { state: 'mismatch' };
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
