import mongoose from 'mongoose';
import crypto from 'node:crypto';
import Order from '../models/Order.js';
import PaymentWebhookReceipt from '../models/PaymentWebhookReceipt.js';
import InventoryItem from '../models/InventoryItem.js';
import { inventoryRequirements } from '../utils/catalog.js';
import { buildOrderItems, calculateOrderTotals, validateDeliveryDetails } from '../utils/orderRules.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getRazorpayClient, verifyRazorpaySignature } from '../services/payments.js';
import { publishAdminRefresh, publishOrderUpdate } from '../services/realtime.js';
import { mapRazorpayOrderCreationError } from '../utils/paymentProviderErrors.js';

const isRequestObjectId = (value) => typeof value === 'string' && mongoose.isObjectIdOrHexString(value);

function publicOrder(order) {
  return {
    id: String(order.id || order._id),
    orderNumber: order.orderNumber,
    items: order.items,
    deliveryDetails: order.deliveryDetails,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    status: order.status,
    paymentStatus: order.paymentStatus,
  };
}

function checkoutRequestFingerprint(items, deliveryDetails) {
  // Hash only canonical recipe choices, quantity and delivery fields—not prices.
  // If menu prices move after a lost response, the existing quote is returned
  // and the client’s normal price-review step protects the customer.
  const stableItems = items.map(({ name, quantity, ingredients }) => ({ name, quantity, ingredients }));
  return crypto.createHash('sha256').update(JSON.stringify({ items: stableItems, deliveryDetails })).digest('hex');
}

function idempotencyConflict(res) {
  return res.status(409).json({
    error: 'This checkout request was already used with different details. Tap checkout again to start a fresh order.',
    code: 'CHECKOUT_IDEMPOTENCY_CONFLICT',
  });
}

export const createOrder = asyncHandler(async (req, res) => {
  const items = buildOrderItems(req.body?.items);
  const deliveryDetails = validateDeliveryDetails(req.body?.deliveryDetails);
  const { subtotal, deliveryFee, total } = calculateOrderTotals(items);
  const rawKey = req.get('Idempotency-Key');
  let checkoutRequestId = null;
  let requestFingerprint = null;

  if (rawKey !== undefined) {
    if (typeof rawKey !== 'string' || rawKey.length < 16 || rawKey.length > 128 ||
        !/^[A-Za-z0-9._:-]+$/.test(rawKey)) {
      return res.status(400).json({ error: 'A valid checkout idempotency key is required' });
    }
    checkoutRequestId = rawKey;
    requestFingerprint = checkoutRequestFingerprint(items, deliveryDetails);

    const existing = await Order.findOne({ user: req.user._id, checkoutRequestId });
    if (existing) {
      if (existing.checkoutRequestFingerprint !== requestFingerprint) return idempotencyConflict(res);
      return res.status(200).json({ order: publicOrder(existing), reused: true });
    }
  }

  let order;
  try {
    order = await Order.create({
      orderNumber: `PH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      user: req.user._id,
      items,
      deliveryDetails,
      subtotal,
      deliveryFee,
      total,
      ...(checkoutRequestId ? {
        checkoutRequestId,
        checkoutRequestFingerprint: requestFingerprint,
      } : {}),
    });
  } catch (error) {
    // A concurrent retry can pass the lookup above at the same time. The unique
    // (user, checkoutRequestId) index lets only one create win; the other reuses it.
    if (checkoutRequestId && error?.code === 11000) {
      const existing = await Order.findOne({ user: req.user._id, checkoutRequestId });
      if (existing) {
        if (existing.checkoutRequestFingerprint !== requestFingerprint) return idempotencyConflict(res);
        return res.status(200).json({ order: publicOrder(existing), reused: true });
      }
    }
    throw error;
  }

  publishOrderUpdate(order);
  res.status(201).json({ order: publicOrder(order), reused: false });
});
export const myOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ orders: orders.map((o) => ({ id: o._id, orderNumber: o.orderNumber, items: o.items, subtotal: o.subtotal, deliveryFee: o.deliveryFee, total: o.total, status: o.status, paymentStatus: o.paymentStatus, paymentReviewRequired: o.paymentReviewRequired, deliveryDetails: o.deliveryDetails, createdAt: o.createdAt, updatedAt: o.updatedAt })) });
});
export const getOrder = asyncHandler(async (req, res) => {
  if (!isRequestObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order identifier' });
  const filter = { _id: req.params.id }; if (req.user.role !== 'admin') filter.user = req.user._id;
  const order = await Order.findOne(filter).lean(); if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order: { id: order._id, orderNumber: order.orderNumber, items: order.items, subtotal: order.subtotal, deliveryFee: order.deliveryFee, total: order.total, status: order.status, paymentStatus: order.paymentStatus, paymentReviewRequired: order.paymentReviewRequired, deliveryDetails: order.deliveryDetails, createdAt: order.createdAt, updatedAt: order.updatedAt } });
});


export const updateDeliveryDetails = asyncHandler(async (req, res) => {
  if (!isRequestObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid order identifier' });
  const deliveryDetails = validateDeliveryDetails(req.body?.deliveryDetails);
  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, status: 'pending_payment', paymentStatus: 'pending' },
    { $set: { deliveryDetails } },
    { new: true, runValidators: true },
  ).lean();
  if (!order) {
    const ownedOrder = await Order.exists({ _id: req.params.id, user: req.user._id });
    if (!ownedOrder) return res.status(404).json({ error: 'Order not found' });
    return res.status(409).json({ error: 'Delivery details can only be changed while payment is pending' });
  }
  publishOrderUpdate(order);
  res.json({ deliveryDetails: order.deliveryDetails });
});

export const createPaymentOrder = asyncHandler(async (req, res) => {
  if (!isRequestObjectId(req.body?.orderId)) return res.status(400).json({ error: 'A valid order ID is required' });
  const order = await Order.findOne({ _id: req.body.orderId, user: req.user._id });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.paymentStatus === 'paid') return res.status(409).json({ error: 'This order is already paid' });
  if (order.status !== 'pending_payment') return res.status(409).json({ error: 'This order is not awaiting payment' });
  try {
    validateDeliveryDetails(order.deliveryDetails);
  } catch {
    return res.status(409).json({ error: 'Add valid delivery details before creating a payment.' });
  }
  const razorpay = getRazorpayClient();
  const now = new Date();
  if (order.inventoryReserved && order.stockReservationExpiresAt && order.stockReservationExpiresAt <= now) return res.status(409).json({ error: 'The ingredient reservation expired. Please restart checkout with a new order.' });
  if (order.inventoryReserved && order.razorpayOrderId) {
    publishAdminRefresh();
    publishOrderUpdate(order);
    return res.json({ keyId: process.env.RAZORPAY_KEY_ID, paymentOrderId: order.razorpayOrderId, amount: order.total * 100, currency: 'INR', orderId: order.id, orderNumber: order.orderNumber, customer: { name: req.user.name, email: req.user.email } });
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await Order.findOne({ _id: order._id, user: req.user._id }).session(session);
      if (!current || current.paymentStatus !== 'pending' || current.status !== 'pending_payment') throw Object.assign(new Error('Order is no longer awaiting payment'), { statusCode: 409 });
      if (current.inventoryReserved && current.razorpayOrderId && current.stockReservationExpiresAt > new Date()) return;
      if (current.inventoryReserved && current.paymentOrderCreationInProgress) throw Object.assign(new Error('Checkout is already being prepared. Please try again in a moment.'), { statusCode: 409 });
      if (current.inventoryReserved && current.stockReservationExpiresAt <= new Date()) throw Object.assign(new Error('The ingredient reservation expired. Please restart checkout with a new order.'), { statusCode: 409 });
      if (!current.inventoryReserved) {
        for (const requirement of inventoryRequirements(current.items)) {
          const item = await InventoryItem.findOneAndUpdate({ key: requirement.key, stock: { $gte: requirement.quantity } }, { $inc: { stock: -requirement.quantity } }, { new: true, session });
          if (!item) throw Object.assign(new Error(`Not enough stock for ${requirement.key}. Please adjust your pizza and try again.`), { statusCode: 409 });
        }
        current.inventoryReserved = true; current.stockReservedAt = new Date(); current.stockReservationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      }
      current.paymentOrderCreationInProgress = true; await current.save({ session });
    });
  } finally { await session.endSession(); }
  const reserved = await Order.findOne({ _id: order._id, user: req.user._id });
  if (!reserved) return res.status(404).json({ error: 'Order not found' });
  if (reserved.razorpayOrderId) {
    publishAdminRefresh();
    publishOrderUpdate(reserved);
    return res.json({ keyId: process.env.RAZORPAY_KEY_ID, paymentOrderId: reserved.razorpayOrderId, amount: reserved.total * 100, currency: 'INR', orderId: reserved.id, orderNumber: reserved.orderNumber, customer: { name: req.user.name, email: req.user.email } });
  }
  try {
    const paymentOrder = await razorpay.orders.create({ amount: reserved.total * 100, currency: 'INR', receipt: reserved.orderNumber, notes: { internalOrderId: reserved.id } });
    reserved.razorpayOrderId = paymentOrder.id; reserved.paymentOrderCreationInProgress = false; await reserved.save();
    publishAdminRefresh();
    publishOrderUpdate(reserved);
    res.json({ keyId: process.env.RAZORPAY_KEY_ID, paymentOrderId: paymentOrder.id, amount: paymentOrder.amount, currency: paymentOrder.currency, orderId: reserved.id, orderNumber: reserved.orderNumber, customer: { name: req.user.name, email: req.user.email } });
  } catch (error) {
    const releaseSession = await mongoose.startSession();
    try {
      await releaseSession.withTransaction(async () => {
        const current = await Order.findById(reserved._id).session(releaseSession);
        if (!current || !current.inventoryReserved || current.paymentStatus === 'paid') return;
        for (const requirement of inventoryRequirements(current.items)) await InventoryItem.updateOne({ key: requirement.key }, { $inc: { stock: requirement.quantity } }, { session: releaseSession });
        current.inventoryReserved = false; current.paymentOrderCreationInProgress = false; current.stockReservedAt = null; current.stockReservationExpiresAt = null; current.razorpayOrderId = null; await current.save({ session: releaseSession });
      });
    } finally { await releaseSession.endSession(); }
    publishAdminRefresh();
    const mappedError = mapRazorpayOrderCreationError(error);
    console.error('[razorpay create-order failed]', mappedError.diagnostics);
    throw Object.assign(new Error(mappedError.message), {
      statusCode: mappedError.statusCode,
      code: mappedError.code,
      safeToExpose: mappedError.safeToExpose,
    });
  }
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const {
    orderId,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: signature,
  } = body;

  if (![razorpayOrderId, razorpayPaymentId, signature].every((value) => typeof value === 'string' && value.trim().length > 0)) {
    return res.status(400).json({ error: 'Missing payment verification details' });
  }
  if (!isRequestObjectId(orderId)) return res.status(400).json({ error: 'A valid order ID is required' });

  const initial = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!initial) return res.status(404).json({ error: 'Order not found' });
  if (initial.razorpayOrderId !== razorpayOrderId ||
      !verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, signature)) {
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }

  // Idempotent confirmation of the exact payment already applied to this order.
  if (initial.paymentStatus === 'paid' && initial.razorpayPaymentId === razorpayPaymentId) {
    return res.json({
      message: initial.paymentReviewRequired ? 'Payment received; order requires manual review' : 'Payment already verified',
      order: {
        id: initial.id,
        orderNumber: initial.orderNumber,
        status: initial.status,
        paymentStatus: initial.paymentStatus,
        paymentReviewRequired: initial.paymentReviewRequired,
      },
    });
  }

  let providerPayment;
  try {
    providerPayment = await getRazorpayClient().payments.fetch(razorpayPaymentId);
  } catch {
    return res.status(502).json({ error: 'Could not confirm payment status with Razorpay. Do not pay again; retry confirmation.' });
  }

  if (providerPayment?.id !== razorpayPaymentId || providerPayment?.order_id !== razorpayOrderId) {
    return res.status(400).json({ error: 'Payment details do not match this checkout' });
  }
  if (providerPayment.status !== 'captured') {
    if (initial.paymentStatus === 'paid') {
      return res.status(409).json({ error: 'Order already has a different successful payment' });
    }
    return res.status(409).json({ error: 'Payment is not captured yet. Please wait a moment and try again.' });
  }

  const providerAmountMismatch = !Number.isSafeInteger(providerPayment.amount) ||
    providerPayment.amount <= 0 || providerPayment.amount !== initial.total * 100;
  const providerCurrencyMismatch = providerPayment.currency !== 'INR';
  const providerReviewReason = providerAmountMismatch
    ? 'captured_amount_mismatch'
    : providerCurrencyMismatch
      ? 'captured_currency_mismatch'
      : null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      let reviewReason = providerReviewReason;
      const order = await Order.findOne({ _id: orderId, user: req.user._id }).session(session);
      if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 });

      if (order.paymentStatus === 'paid') {
        if (order.razorpayPaymentId === razorpayPaymentId) return;
        reviewReason = 'multiple_captured_payments_for_order';
      } else if (!reviewReason && order.razorpayOrderId !== razorpayOrderId) {
        reviewReason = 'provider_order_mismatch';
      } else if (!reviewReason && order.status !== 'pending_payment') {
        reviewReason = 'order_not_awaiting_payment';
      } else if (!reviewReason && !order.inventoryReserved) {
        reviewReason = 'inventory_reservation_missing';
      }

      if (!reviewReason) {
        try {
          validateDeliveryDetails(order.deliveryDetails);
        } catch {
          reviewReason = 'delivery_details_missing_or_invalid';
        }
      }

      if (reviewReason) {
        // Provider confirms money was captured, but this order cannot safely
        // enter fulfillment. Preserve inventory holds and create an admin-visible
        // review receipt instead of returning an error that hides the capture.
        if (order.paymentStatus !== 'paid') {
          order.paymentStatus = 'paid';
          order.razorpayPaymentId = razorpayPaymentId;
          order.paidAt = order.paidAt || new Date();
        }
        order.status = 'payment_review';
        order.paymentReviewRequired = true;
        order.paymentReviewReason = reviewReason;
        await order.save({ session });

        await PaymentWebhookReceipt.updateOne(
          { eventId: `verification-${razorpayPaymentId}` },
          {
            $setOnInsert: {
              eventId: `verification-${razorpayPaymentId}`,
              eventType: 'payment.verify.review',
              status: 'review_required',
              providerOrderId: razorpayOrderId,
              paymentId: razorpayPaymentId,
              order: order._id,
              reason: reviewReason,
            },
          },
          { upsert: true, session },
        );
        return;
      }

      order.paymentStatus = 'paid';
      order.razorpayPaymentId = razorpayPaymentId;
      order.paidAt = new Date();
      order.status = 'order_received';
      order.paymentReviewRequired = false;
      order.paymentReviewReason = null;
      order.inventoryReserved = false;
      order.paymentOrderCreationInProgress = false;
      order.stockReservedAt = null;
      order.stockReservationExpiresAt = null;
      await order.save({ session });
    });
  } finally {
    await session.endSession();
  }

  const updated = await Order.findById(orderId).lean();
  if (!updated) throw Object.assign(new Error('Order not found after payment verification'), { statusCode: 404 });
  publishOrderUpdate(updated);
  publishAdminRefresh();

  const needsReview = Boolean(updated.paymentReviewRequired) || updated.status === 'payment_review';
  res.json({
    message: needsReview ? 'Payment received; order requires manual review. Do not pay again.' : 'Payment verified',
    order: {
      id: String(updated._id),
      orderNumber: updated.orderNumber,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
      paymentReviewRequired: updated.paymentReviewRequired,
    },
  });
});
