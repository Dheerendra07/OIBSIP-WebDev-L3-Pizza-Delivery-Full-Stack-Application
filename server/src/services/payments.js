import Razorpay from 'razorpay';
import { config } from '../config/env.js';
import { verifyRazorpaySignature as verifySignature } from '../utils/paymentSignature.js';

export function verifyRazorpaySignature(orderId, paymentId, signature) { return verifySignature(orderId, paymentId, signature, config.razorpayKeySecret); }
export function getRazorpayClient() {
  if (!config.razorpayKeyId || !config.razorpayKeySecret) { const error = new Error('Razorpay test keys are not configured on the server'); error.statusCode = 503; throw error; }
  return new Razorpay({ key_id: config.razorpayKeyId, key_secret: config.razorpayKeySecret });
}
