import mongoose from 'mongoose';
import Order from '../models/Order.js';
import InventoryItem from '../models/InventoryItem.js';
import PaymentWebhookReceipt from '../models/PaymentWebhookReceipt.js';
import { getRazorpayClient, createRazorpayRefund } from './payments.js';
import { inventoryRequirements } from '../utils/catalog.js';
import { createFullRefundIdempotencyKey, classifyRefundWebhook, classifyRefundCaptureSet } from '../utils/paymentRefund.js';
import { config } from '../config/env.js';
import { publishAdminRefresh, publishOrderUpdate } from './realtime.js';

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function persistRefundState(orderId, refund, status) {
  const session = await mongoose.startSession();
  let changed = false;
  try {
    await session.withTransaction(async () => {
      changed = false;
      const order = await Order.findById(orderId).session(session);
      if (!order) return;

      if (status === 'processed') {
        const exactFullRefund = order.refundIdempotencyKey &&
          refund?.payment_id === order.razorpayPaymentId &&
          Number.isSafeInteger(refund?.amount) &&
          refund.amount === order.refundAmount &&
          refund.currency === 'INR';

        if (!exactFullRefund) {
          if (order.status === 'payment_review') {
            order.paymentReviewRequired = true;
            order.paymentReviewReason = 'refund_details_mismatch_requires_manual_review';
            await order.save({ session });
            changed = true;
          }
          return;
        }

        if (order.paymentStatus === 'refunded' &&
            order.refundStatus === 'processed' &&
            order.razorpayRefundId === refund.id) return;

        if (order.refundStatus === 'processed' && order.razorpayRefundId && order.razorpayRefundId !== refund.id) {
          order.paymentReviewRequired = true;
          order.status = 'payment_review';
          order.paymentReviewReason = 'additional_refund_requires_manual_review';
          await order.save({ session });
          changed = true;
          return;
        }

        if (order.inventoryReserved) {
          for (const requirement of inventoryRequirements(order.items)) {
            await InventoryItem.updateOne(
              { key: requirement.key },
              { $inc: { stock: requirement.quantity } },
              { session },
            );
          }
        }

        order.refundStatus = 'processed';
        order.razorpayRefundId = refund.id;
        order.refundAmount = refund.amount;
        order.refundProcessedAt = order.refundProcessedAt || new Date();
        order.paymentStatus = 'refunded';
        if (order.status === 'payment_review' || order.paymentReviewRequired) order.status = 'cancelled';
        order.paymentReviewRequired = false;
        order.paymentReviewReason = null;
        order.inventoryReserved = false;
        order.paymentOrderCreationInProgress = false;
        order.stockReservedAt = null;
        order.stockReservationExpiresAt = null;
        await order.save({ session });
        await PaymentWebhookReceipt.updateMany(
          { order: order._id, paymentId: refund.payment_id, status: 'review_required' },
          { $set: { status: 'processed', reason: 'resolved_by_full_refund' } },
          { session },
        );
        changed = true;
        return;
      }

      // Provider events must never downgrade an already-completed full refund.
      if (order.paymentStatus === 'refunded' && order.refundStatus === 'processed') return;
      order.refundStatus = status;
      if (typeof refund?.id === 'string') order.razorpayRefundId = refund.id;
      if (Number.isSafeInteger(refund?.amount) && refund.amount > 0) order.refundAmount = refund.amount;
      if (status === 'failed') {
        order.status = 'payment_review';
        order.paymentReviewRequired = true;
        order.paymentReviewReason = 'refund_failed_requires_manual_review';
      }
      await order.save({ session });
      changed = true;
    });
  } finally {
    await session.endSession();
  }

  if (changed) {
    const updated = await Order.findById(orderId).lean();
    if (updated) {
      publishOrderUpdate(updated);
      publishAdminRefresh();
      return updated;
    }
  }
  return Order.findById(orderId).lean();
}

async function markRefundRequestRejected(orderId) {
  await Order.updateOne(
    { _id: orderId, refundStatus: 'requested', paymentStatus: 'paid' },
    { $set: { refundStatus: 'failed', paymentReviewRequired: true, status: 'payment_review', paymentReviewReason: 'refund_request_rejected_requires_manual_review' } },
  );
  const updated = await Order.findById(orderId).lean();
  if (updated) {
    publishOrderUpdate(updated);
    publishAdminRefresh();
  }
}

export async function requestFullPaymentReviewRefund(orderId, paymentId, adminUserId) {
  if (!mongoose.isObjectIdOrHexString(orderId)) throw httpError(400, 'Invalid order identifier');
  if (typeof paymentId !== 'string' || !paymentId.trim() || paymentId.length > 100) {
    throw httpError(400, 'A valid payment ID is required');
  }

  let order = await Order.findById(orderId).lean();
  if (!order) throw httpError(404, 'Order not found');
  if ((order.paymentMode || 'test') !== config.paymentMode) {
    throw httpError(409, `This order belongs to ${order.paymentMode || 'test'} mode. Do not issue a refund using ${config.paymentMode} mode credentials.`);
  }
  if (order.status !== 'payment_review' || !order.paymentReviewRequired || order.paymentStatus !== 'paid') {
    throw httpError(409, 'Only a captured payment held for manual review can be refunded here');
  }
  if (!order.razorpayPaymentId || order.razorpayPaymentId !== paymentId) {
    throw httpError(409, 'This review event does not match the order’s recorded payment. Use manual provider reconciliation instead.');
  }

  if (order.paymentReviewReason === 'multiple_captured_payments_for_order') {
    throw httpError(409, 'This order has multiple captured payments. Automatic refund is blocked until each payment is reconciled separately.');
  }

  const duplicateCaptureReview = await PaymentWebhookReceipt.exists({
    order: order._id,
    status: 'review_required',
    reason: 'multiple_captured_payments_for_order',
    paymentId: { $ne: paymentId },
  });
  if (duplicateCaptureReview) {
    throw httpError(409, 'This order has multiple captured payments. Automatic refund is blocked until each payment is reconciled separately.');
  }

  const existingRefundStatus = order.refundStatus || 'none';
  if (existingRefundStatus === 'processed' || order.paymentStatus === 'refunded') {
    throw httpError(409, 'A refund has already been recorded for this order');
  }
  if (existingRefundStatus === 'pending') {
    throw httpError(409, 'The refund is pending with Razorpay. Wait for the provider update before taking another action.');
  }
  if (existingRefundStatus === 'failed') {
    throw httpError(409, 'The previous refund failed or was rejected. Manual Razorpay review is required.');
  }
  if (!['none', 'requested'].includes(existingRefundStatus)) {
    throw httpError(409, 'The current refund state cannot be retried automatically');
  }

  let razorpay;
  let providerPayment;
  let providerOrderPayments;
  try {
    razorpay = getRazorpayClient();
    [providerPayment, providerOrderPayments] = await Promise.all([
      razorpay.payments.fetch(paymentId),
      razorpay.orders.fetchPayments(order.razorpayOrderId),
    ]);
  } catch {
    throw httpError(502, 'Could not verify the payment and order capture history with Razorpay. No new refund was submitted.');
  }

  const isSafeRetry = existingRefundStatus === 'requested' && Boolean(order.refundIdempotencyKey);
  const validPayment = providerPayment?.id === paymentId &&
    providerPayment.order_id === order.razorpayOrderId &&
    providerPayment.status === 'captured' &&
    providerPayment.currency === 'INR' &&
    Number.isSafeInteger(providerPayment.amount) && providerPayment.amount > 0 &&
    Number.isSafeInteger(providerPayment.amount_refunded) &&
    (isSafeRetry
      ? providerPayment.amount_refunded >= 0 && providerPayment.amount_refunded <= providerPayment.amount
      : providerPayment.amount_refunded === 0);
  if (!validPayment) {
    throw httpError(409, 'The provider payment does not match a refundable captured payment, or an earlier refund may already exist. Manual review is required.');
  }

  const captureSet = classifyRefundCaptureSet(providerOrderPayments?.items, {
    orderId: order.razorpayOrderId,
    paymentId,
    amountPaise: providerPayment.amount,
  });
  if (!captureSet.allowed && captureSet.reason === 'multiple_captured_payments_for_order') {
    throw httpError(409, 'Razorpay reports multiple captured payments for this order. Automatic refund is blocked until each payment is reconciled separately.');
  }
  if (!captureSet.allowed) {
    throw httpError(409, 'Razorpay order capture history could not confirm this as the only captured payment. Manual review is required.');
  }

  const deterministicKey = createFullRefundIdempotencyKey(String(order._id));
  if (!deterministicKey) throw httpError(409, 'Could not establish a safe refund idempotency key');

  if (existingRefundStatus === 'none') {
    const reserved = await Order.findOneAndUpdate(
      {
        _id: order._id,
        status: 'payment_review',
        paymentReviewRequired: true,
        paymentStatus: 'paid',
        razorpayPaymentId: paymentId,
        $or: [{ refundStatus: 'none' }, { refundStatus: { $exists: false } }],
      },
      {
        $set: {
          refundStatus: 'requested',
          refundIdempotencyKey: deterministicKey,
          refundAmount: providerPayment.amount,
          refundRequestedAt: new Date(),
          refundRequestedBy: adminUserId,
        },
      },
      { new: true },
    ).lean();

    order = reserved || await Order.findById(orderId).lean();
    if (!order || order.refundStatus !== 'requested' ||
        !order.refundIdempotencyKey ||
        order.refundAmount !== providerPayment.amount) {
      throw httpError(409, 'The order review state changed while preparing the refund. Refresh before retrying.');
    }
  } else if (order.refundAmount !== providerPayment.amount ||
             order.refundIdempotencyKey !== deterministicKey) {
    throw httpError(409, 'The saved refund request no longer matches the provider amount. Manual review is required.');
  }

  let providerRefund;
  try {
    providerRefund = await createRazorpayRefund(paymentId, providerPayment.amount, order.refundIdempotencyKey, {
      order_number: order.orderNumber,
      reason: 'payment_review_recovery',
    });
  } catch (error) {
    if (error?.statusCode === 400) await markRefundRequestRejected(order._id);
    throw error;
  }

  const current = await Order.findById(order._id).lean();
  const decision = classifyRefundWebhook('refund.created', {
    ...providerRefund,
    payment_id: providerRefund?.payment_id || paymentId,
    currency: providerRefund?.currency || 'INR',
  }, current);
  // A signed refund webhook can win the race against this synchronous request.
  // If it already reconciled this exact refund, return the provider-confirmed
  // state instead of reporting a false 502 to the admin.
  if (decision.action === 'already_processed') {
    return {
      orderId: String(current._id),
      refundId: providerRefund.id,
      refundStatus: current.refundStatus,
      paymentStatus: current.paymentStatus,
    };
  }
  if (decision.action !== 'apply') {
    throw httpError(502, 'Razorpay returned a refund response that could not be safely reconciled. The order remains on hold; retry only through this same admin action.');
  }

  const updated = await persistRefundState(order._id, {
    ...providerRefund,
    payment_id: providerRefund?.payment_id || paymentId,
    currency: providerRefund?.currency || 'INR',
  }, decision.status);
  return {
    orderId: String(order._id),
    refundId: providerRefund.id,
    refundStatus: updated?.refundStatus || decision.status,
    paymentStatus: updated?.paymentStatus || order.paymentStatus,
  };
}

export async function reconcileRefundWebhook(eventType, refund) {
  const paymentId = typeof refund?.payment_id === 'string' && refund.payment_id.length <= 100
    ? refund.payment_id
    : null;
  const order = paymentId ? await Order.findOne({ razorpayPaymentId: paymentId }).lean() : null;
  const decision = classifyRefundWebhook(eventType, refund, order);

  if (decision.action === 'already_processed') {
    return { status: 'processed', reason: null, providerOrderId: order?.razorpayOrderId || null, paymentId, orderId: order?._id || null };
  }
  if (decision.action !== 'apply') {
    return {
      status: 'review_required',
      reason: decision.reason || 'refund_requires_manual_review',
      providerOrderId: order?.razorpayOrderId || null,
      paymentId,
      orderId: order?._id || null,
    };
  }

  const updated = await persistRefundState(order._id, refund, decision.status);
  if (decision.status === 'failed') {
    return {
      status: 'review_required',
      reason: 'refund_failed_requires_manual_review',
      providerOrderId: updated?.razorpayOrderId || null,
      paymentId,
      orderId: order._id,
    };
  }
  return {
    status: 'processed',
    reason: null,
    providerOrderId: updated?.razorpayOrderId || null,
    paymentId,
    orderId: order._id,
  };
}
