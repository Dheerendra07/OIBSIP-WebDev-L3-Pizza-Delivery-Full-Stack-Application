import crypto from 'node:crypto';

export function safeEqualHex(actual, expected) {
  if (!/^[a-f0-9]+$/i.test(actual || '') || !/^[a-f0-9]+$/i.test(expected || '') || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

export function verifyRazorpaySignature(orderId, paymentId, signature, secret) {
  if (!orderId || !paymentId || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Verify the exact raw HTTP body with Razorpay's webhook-specific secret. */
export function verifyRazorpayWebhookSignature(rawBody, signature, secret) {
  if ((!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') || !signature || !secret) return false;
  if (Buffer.isBuffer(rawBody) ? rawBody.length === 0 : rawBody.length === 0) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(signature, expected);
}
