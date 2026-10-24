import Razorpay from 'razorpay';
import { config } from '../config/env.js';
import { verifyRazorpaySignature as verifySignature } from '../utils/paymentSignature.js';

export function verifyRazorpaySignature(orderId, paymentId, signature) { return verifySignature(orderId, paymentId, signature, config.razorpayKeySecret); }
let integrationTestClientFactory = null;

/**
 * Allow isolated integration tests to replace Razorpay's network client.
 * The override is process-local and restored by the test; production uses the SDK.
 */
export function setRazorpayClientFactoryForIntegrationTests(factory) {
  if (typeof factory !== 'function') throw new TypeError('Razorpay test client factory must be a function');
  const previous = integrationTestClientFactory;
  integrationTestClientFactory = factory;
  return () => {
    if (integrationTestClientFactory === factory) integrationTestClientFactory = previous;
  };
}

export function getRazorpayClient() {
  if (integrationTestClientFactory) return integrationTestClientFactory();
  if (!config.razorpayKeyId || !config.razorpayKeySecret) { const error = new Error('Razorpay API credentials are not configured on the server'); error.statusCode = 503; throw error; }
  return new Razorpay({ key_id: config.razorpayKeyId, key_secret: config.razorpayKeySecret });
}

/**
 * Verify the configured Razorpay payment mode with a read-only provider call.
 * The result never exposes provider order data or credential values.
 */
export async function checkRazorpayConnection() {
  const client = getRazorpayClient();
  let response;
  try {
    response = await client.orders.all({ count: 1 });
  } catch {
    throw Object.assign(new Error('Razorpay Test Mode API request failed'), { statusCode: 502 });
  }
  if (!response || !Array.isArray(response.items)) {
    throw Object.assign(new Error('Razorpay returned an unexpected response'), { statusCode: 502 });
  }
  return { checkedAt: new Date().toISOString(), mode: config.paymentMode };
}


/**
 * Submit a full refund using Razorpay's native idempotency header.
 * Repeated requests with the same key and amount cannot create duplicate refunds.
 */
export async function createRazorpayRefund(paymentId, amount, idempotencyKey, notes = {}) {
  getRazorpayClient();
  if (typeof paymentId !== 'string' || !paymentId ||
      !Number.isSafeInteger(amount) || amount <= 0 ||
      typeof idempotencyKey !== 'string' || idempotencyKey.length < 10) {
    throw Object.assign(new Error('A valid payment, amount and refund idempotency key are required'), { statusCode: 400 });
  }

  let response;
  try {
    response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'X-Refund-Idempotency': idempotencyKey,
      },
      body: JSON.stringify({ amount, notes }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw Object.assign(new Error('Razorpay did not confirm the refund request. The saved idempotency key is retained for a safe retry.'), { statusCode: 502 });
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409) {
      throw Object.assign(new Error('Razorpay is processing this idempotent refund request. Refresh the review queue before retrying.'), { statusCode: 409 });
    }
    if (response.status >= 500) {
      throw Object.assign(new Error('Razorpay is temporarily unavailable. The refund request remains recoverable using the same idempotency key.'), { statusCode: 502 });
    }
    throw Object.assign(new Error('Razorpay rejected the refund request. Manual provider review is required before another action.'), { statusCode: 400 });
  }
  return body;
}
