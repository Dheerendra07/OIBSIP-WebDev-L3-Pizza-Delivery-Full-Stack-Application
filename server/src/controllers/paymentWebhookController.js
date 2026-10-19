import mongoose from 'mongoose';
import { config } from '../config/env.js';
import PaymentWebhookReceipt from '../models/PaymentWebhookReceipt.js';
import Order from '../models/Order.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyRazorpayWebhookSignature } from '../utils/paymentSignature.js';
import { classifyCapturedPayment } from '../utils/paymentWebhook.js';
import { reconcileRefundWebhook } from '../services/refunds.js';
import { publishAdminRefresh, publishOrderUpdate } from '../services/realtime.js';

function headerString(req, name) {
  const value = req.get(name);
  return typeof value === 'string' ? value : '';
}

function safeId(value) {
  return typeof value === 'string' && value.length <= 100 ? value : null;
}

async function reconcileCapturedPayment(payment) {
  let outcome = { status: 'review_required', reason: 'invalid_captured_payment_payload', orderId: null };
  let updatedOrderId = null;
  const providerOrderId = safeId(payment?.order_id);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      outcome = { status: 'review_required', reason: 'invalid_captured_payment_payload', orderId: null };
      updatedOrderId = null;
      const order = providerOrderId
        ? await Order.findOne({ razorpayOrderId: providerOrderId }).session(session)
        : null;
      const decision = classifyCapturedPayment(payment, order);

      if (order) outcome.orderId = order._id;
      if (decision.action === 'already_processed') {
        outcome = { status: 'processed', reason: null, orderId: order._id };
        return;
      }

      const credibleCapture = payment?.status === 'captured' &&
        typeof payment.id === 'string' && payment.id.length > 0 &&
        typeof payment.order_id === 'string' && payment.order_id.length > 0 &&
        Number.isSafeInteger(payment.amount) && payment.amount > 0 &&
        typeof payment.currency === 'string' && payment.order_id === order?.razorpayOrderId;

      if (!credibleCapture) {
        outcome = { status: 'review_required', reason: decision.reason || 'invalid_captured_payment_payload', orderId: order?._id || null };
        return;
      }

      if (decision.action === 'fulfill') {
        order.paymentStatus = 'paid';
        order.razorpayPaymentId = payment.id;
        order.paidAt = new Date();
        order.status = 'order_received';
        order.paymentReviewRequired = false;
        order.paymentReviewReason = null;
        order.inventoryReserved = false;
        order.paymentOrderCreationInProgress = false;
        order.stockReservedAt = null;
        order.stockReservationExpiresAt = null;
        await order.save({ session });
        updatedOrderId = order._id;
        outcome = { status: 'processed', reason: null, orderId: order._id };
        return;
      }

      // Money was captured for this app's provider order, but the order cannot
      // safely enter fulfillment. Keep any inventory hold and make the issue visible.
      if (order.paymentStatus !== 'paid') {
        order.paymentStatus = 'paid';
        order.razorpayPaymentId = payment.id;
        order.paidAt = new Date();
      }
      order.status = 'payment_review';
      order.paymentReviewRequired = true;
      order.paymentReviewReason = decision.reason || 'captured_payment_requires_manual_review';
      await order.save({ session });
      updatedOrderId = order._id;
      outcome = { status: 'review_required', reason: order.paymentReviewReason, orderId: order._id };
    });
  } finally {
    await session.endSession();
  }

  const updatedOrder = updatedOrderId ? await Order.findById(updatedOrderId).lean() : null;
  if (updatedOrder) {
    publishOrderUpdate(updatedOrder);
    publishAdminRefresh();
  }

  return { ...outcome, providerOrderId, paymentId: safeId(payment?.id) };
}

export const handleRazorpayWebhook = asyncHandler(async (req, res) => {
  if (!config.razorpayWebhookSecret) {
    return res.status(503).json({ error: 'Razorpay webhook secret is not configured' });
  }

  const rawBody = req.body;
  const signature = headerString(req, 'x-razorpay-signature');
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return res.status(400).json({ error: 'A raw JSON webhook body is required' });
  }
  if (!verifyRazorpayWebhookSignature(rawBody, signature, config.razorpayWebhookSecret)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const eventId = headerString(req, 'x-razorpay-event-id').trim();
  if (!eventId || eventId.length > 255) {
    return res.status(400).json({ error: 'A valid Razorpay event ID is required' });
  }

  const existing = await PaymentWebhookReceipt.findOne({ eventId }).lean();
  if (existing) return res.status(200).json({ received: true, duplicate: true, status: existing.status });

  let webhook;
  try {
    webhook = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Webhook body is not valid JSON' });
  }
  if (!webhook || typeof webhook !== 'object' || Array.isArray(webhook) || typeof webhook.event !== 'string' || !webhook.event) {
    return res.status(400).json({ error: 'Webhook event payload is invalid' });
  }

  let result = {
    status: 'ignored',
    reason: 'unsupported_event',
    providerOrderId: null,
    paymentId: null,
    orderId: null,
  };

  if (webhook.event === 'payment.captured') {
    result = await reconcileCapturedPayment(webhook.payload?.payment?.entity);
  } else if (['refund.created', 'refund.processed', 'refund.failed'].includes(webhook.event)) {
    result = await reconcileRefundWebhook(webhook.event, webhook.payload?.refund?.entity);
  } else if (webhook.event === 'payment.failed') {
    // A failed attempt is not final for an order: later attempts may still succeed.
    const payment = webhook.payload?.payment?.entity;
    result = {
      status: 'ignored',
      reason: 'failed_payment_is_nonterminal',
      providerOrderId: safeId(payment?.order_id),
      paymentId: safeId(payment?.id),
      orderId: null,
    };
  }

  try {
    await PaymentWebhookReceipt.create({
      eventId,
      eventType: webhook.event.slice(0, 100),
      status: result.status,
      providerOrderId: result.providerOrderId,
      paymentId: result.paymentId,
      order: result.orderId,
      reason: result.reason,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(200).json({ received: true, duplicate: true });
    }
    throw error;
  }

  if (result.status === 'review_required') {
    console.error('[razorpay webhook] Manual payment review required', {
      eventId,
      eventType: webhook.event,
      providerOrderId: result.providerOrderId,
      paymentId: result.paymentId,
      reason: result.reason,
    });
  }

  return res.status(200).json({ received: true, status: result.status });
});
