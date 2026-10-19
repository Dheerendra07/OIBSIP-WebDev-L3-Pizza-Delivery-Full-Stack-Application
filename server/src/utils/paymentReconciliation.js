/** Classify provider payments before an expired inventory reservation is released. */
export function classifyOrderPayments(items, { orderId, amountPaise }) {
  const payments = Array.isArray(items) ? items : [];
  const captured = payments.filter((payment) => payment?.status === 'captured');
  const matching = captured.find((payment) => payment.order_id === orderId && payment.amount === amountPaise && payment.currency === 'INR');
  if (matching) return { state: 'captured', payment: matching };
  if (captured.length) return { state: 'mismatch' };
  if (payments.some((payment) => ['authorized', 'created'].includes(payment?.status))) return { state: 'in_flight' };
  return { state: 'no_capture' };
}
