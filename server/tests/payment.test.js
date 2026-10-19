import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyRazorpaySignature } from '../src/utils/paymentSignature.js';
test('Razorpay signature accepts exact HMAC and rejects modified values', () => {
 const secret = 'test-secret'; const orderId = 'order_test_123'; const paymentId = 'pay_test_456';
 const signature = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
 assert.equal(verifyRazorpaySignature(orderId, paymentId, signature, secret), true);
 const modified = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
 assert.equal(verifyRazorpaySignature(orderId, paymentId, modified, secret), false); assert.equal(verifyRazorpaySignature('', paymentId, signature, secret), false);
});
