export const PENDING_PAYMENT_STORAGE_KEY = 'pizza-house.pending-verification';

export function parsePendingVerification(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.orderId !== 'string' || !/^[a-f0-9]{24}$/i.test(value.orderId)) {
    return null;
  }
  const response = value.response;
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const {
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: razorpaySignature,
  } = response;
  if (![razorpayOrderId, razorpayPaymentId, razorpaySignature].every(
    (field) => typeof field === 'string' && field.trim().length > 0 && field.length <= 255,
  )) return null;

  return {
    orderId: value.orderId,
    response: {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    },
  };
}

export function serializePendingVerification(attempt) {
  if (!attempt || typeof attempt !== 'object') return null;
  const normalized = parsePendingVerification(JSON.stringify(attempt));
  return normalized ? JSON.stringify(normalized) : null;
}
