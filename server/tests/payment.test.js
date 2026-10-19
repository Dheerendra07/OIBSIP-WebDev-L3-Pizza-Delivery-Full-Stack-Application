import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyRazorpaySignature, verifyRazorpayWebhookSignature } from '../src/utils/paymentSignature.js';

test('Razorpay checkout signature accepts exact HMAC and rejects modified values', () => {
 const secret = 'test-secret'; const orderId = 'order_test_123'; const paymentId = 'pay_test_456';
 const signature = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
 assert.equal(verifyRazorpaySignature(orderId, paymentId, signature, secret), true);
 const modified = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
 assert.equal(verifyRazorpaySignature(orderId, paymentId, modified, secret), false);
 assert.equal(verifyRazorpaySignature('', paymentId, signature, secret), false);
});

test('Razorpay webhook signature validates the exact raw JSON body', () => {
 const secret = 'webhook-secret';
 const rawBody = Buffer.from('{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test_1"}}}}');
 const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
 assert.equal(verifyRazorpayWebhookSignature(rawBody, signature, secret), true);
 assert.equal(verifyRazorpayWebhookSignature(rawBody.toString('utf8'), signature, secret), true);
});

test('Razorpay webhook signature rejects mutated or reserialized payloads', () => {
 const secret = 'webhook-secret';
 const rawBody = Buffer.from('{ "event": "payment.captured" }');
 const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
 assert.equal(verifyRazorpayWebhookSignature(Buffer.from('{"event":"payment.captured"}'), signature, secret), false);
 assert.equal(verifyRazorpayWebhookSignature(Buffer.from('{ "event": "payment.failed" }'), signature, secret), false);
 assert.equal(verifyRazorpayWebhookSignature(rawBody, 'bad-signature', secret), false);
 assert.equal(verifyRazorpayWebhookSignature(rawBody, signature, ''), false);
 assert.equal(verifyRazorpayWebhookSignature(Buffer.alloc(0), signature, secret), false);
 assert.equal(verifyRazorpayWebhookSignature(null, signature, secret), false);
});
