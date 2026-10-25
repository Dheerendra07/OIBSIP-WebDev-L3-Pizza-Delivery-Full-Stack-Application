import mongoose from 'mongoose';
import InventoryItem from '../models/InventoryItem.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import PaymentWebhookReceipt from '../models/PaymentWebhookReceipt.js';
import { requestFullPaymentReviewRefund } from '../services/refunds.js';
import { checkRazorpayConnection } from '../services/payments.js';
import { config } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { hashPassword, isStrongEnough } from '../utils/password.js';
import { disconnectUserSockets, publishOpsRefresh } from '../services/realtime.js';
import { resolveFulfillmentMode, validateOrderStatusTransition } from '../utils/orderRules.js';
import { publishAdminRefresh, publishOrderUpdate } from '../services/realtime.js';
import OrderNotification from '../models/OrderNotification.js';
import { queueOrderNotificationSafely } from '../services/orderNotifications.js';

export const summary = asyncHandler(async (_req, res) => {
  const [ordersTotal, paidOrders, revenue, pendingOrders, usersTotal, lowStock] = await Promise.all([
    Order.countDocuments(), Order.countDocuments({ paymentStatus: 'paid', paymentMode: 'live' }),
    Order.aggregate([{ $match: { paymentStatus: 'paid', paymentMode: 'live' } }, { $group: { _id: null, amount: { $sum: '$total' } } }]),
    Order.countDocuments({ paymentMode: 'live', status: { $in: ['order_received', 'in_kitchen', 'sent_to_delivery'] } }),
    User.countDocuments({ role: 'user' }), InventoryItem.countDocuments({ $expr: { $lte: ['$stock', '$lowStockThreshold'] } }),
  ]);
  res.json({ summary: { ordersTotal, paidOrders, revenue: revenue[0]?.amount || 0, pendingOrders, usersTotal, lowStock } });
});
export const listInventory = asyncHandler(async (_req, res) => { const items = await InventoryItem.find().sort({ category: 1, name: 1 }).lean(); res.json({ items }); });
export const updateInventory = asyncHandler(async (req, res) => {
  const { key } = req.params; const updates = {};
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  if (body.stock !== undefined) { const stock = Number(body.stock); if (!Number.isInteger(stock) || stock < 0 || stock > 10000000) return res.status(400).json({ error: 'Stock must be a whole number between 0 and 10,000,000' }); updates.stock = stock; }
  if (body.lowStockThreshold !== undefined) { const threshold = Number(body.lowStockThreshold); if (!Number.isInteger(threshold) || threshold < 0 || threshold > 1000000) return res.status(400).json({ error: 'Threshold must be a non-negative whole number' }); updates.lowStockThreshold = threshold; }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Provide stock or lowStockThreshold to update' });
  const item = await InventoryItem.findOneAndUpdate({ key }, { $set: updates }, { new: true, runValidators: true });
  if (!item) return res.status(404).json({ error: 'Inventory item not found' });
  publishAdminRefresh();
  res.json({ item });
});
export const listOrders = asyncHandler(async (_req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 }).limit(200)
    .populate('user', 'name email')
    .populate('kitchenStaff', 'name email role active')
    .populate('deliveryStaff', 'name email role active')
    .lean();
  res.json({ orders: orders.map((o) => ({ id: o._id, orderNumber: o.orderNumber, user: o.user, items: o.items, deliveryDetails: o.deliveryDetails, subtotal: o.subtotal, deliveryFee: o.deliveryFee, total: o.total, status: o.status, paymentStatus: o.paymentStatus, paymentReviewRequired: o.paymentReviewRequired, paymentReviewReason: o.paymentReviewReason, refundStatus: o.refundStatus, paymentMode: o.paymentMode || 'test', createdAt: o.createdAt, updatedAt: o.updatedAt, paidAt: o.paidAt, kitchenStartedAt: o.kitchenStartedAt, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt })) });
});
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { status } = body;
  if (typeof status !== 'string' || !status.trim()) return res.status(400).json({ error: 'A valid order status is required' });
  const order = await Order.findById(req.params.id); if (!order) return res.status(404).json({ error: 'Order not found' });
  const fulfillmentMode = resolveFulfillmentMode(config.paymentMode, order.paymentMode || 'test');
  if (!fulfillmentMode) {
    return res.status(409).json({
      error: config.paymentMode === 'live'
        ? 'This Test Mode order cannot enter real kitchen or delivery operations. Only verified Live Mode orders can be fulfilled for real.'
        : 'The configured payment mode and this order do not match, so no fulfillment status was changed.',
    });
  }
  const requiredStaff = status === 'in_kitchen'
    ? { id: order.kitchenStaff, role: 'kitchen', label: 'active kitchen owner' }
    : ['sent_to_delivery', 'delivered'].includes(status)
      ? { id: order.deliveryStaff, role: 'delivery', label: 'active delivery partner' }
      : null;
  if (requiredStaff && (!requiredStaff.id || !await User.exists({
    _id: requiredStaff.id,
    role: requiredStaff.role,
    active: { $ne: false },
  }))) {
    return res.status(409).json({
      error: `Assign an ${requiredStaff.label} before moving this order to ${status.replaceAll('_', ' ')}.`,
    });
  }
  const transition = validateOrderStatusTransition(order, status);
  if (!transition.allowed) return res.status(transition.statusCode).json({ error: transition.message });

  const changedAt = new Date();
  order.status = status;
  if (status === 'in_kitchen') order.kitchenStartedAt = changedAt;
  if (status === 'sent_to_delivery') order.dispatchedAt = changedAt;
  if (status === 'delivered') order.deliveredAt = changedAt;
  await order.save();
  publishOrderUpdate(order);
  await queueOrderNotificationSafely(order, 'status_changed');
  publishAdminRefresh();
  res.json({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMode: order.paymentMode || 'test',
      fulfillmentMode,
      paidAt: order.paidAt || null,
      kitchenStartedAt: order.kitchenStartedAt || null,
      dispatchedAt: order.dispatchedAt || null,
      deliveredAt: order.deliveredAt || null,
    },
  });
});


export const orderNotificationHealth = asyncHandler(async (_req, res) => {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [queued, sending, sentLast24Hours, dead, oldestQueued, deadLetters] = await Promise.all([
    OrderNotification.countDocuments({ deliveryStatus: 'queued' }),
    OrderNotification.countDocuments({ deliveryStatus: 'sending' }),
    OrderNotification.countDocuments({ deliveryStatus: 'sent', sentAt: { $gte: dayAgo } }),
    OrderNotification.countDocuments({ deliveryStatus: 'dead' }),
    OrderNotification.findOne({ deliveryStatus: 'queued' }).sort({ createdAt: 1 }).select('createdAt').lean(),
    OrderNotification.find({ deliveryStatus: 'dead' }).sort({ updatedAt: -1 }).limit(10)
      .select('order attempts lastError updatedAt').populate('order', 'orderNumber').lean(),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({
    checkedAt: now.toISOString(),
    counts: { queued, sending, sentLast24Hours, dead },
    oldestQueuedAt: oldestQueued?.createdAt || null,
    deadLetters: deadLetters.map((item) => ({
      orderNumber: item.order?.orderNumber || null,
      attempts: item.attempts,
      lastError: item.lastError || null,
      updatedAt: item.updatedAt,
    })),
  });
});


export const listPaymentReviews = asyncHandler(async (_req, res) => {
  const receipts = await PaymentWebhookReceipt.find({ status: 'review_required' })
    .sort({ receivedAt: -1 }).limit(100)
    .populate('order', 'orderNumber status total paymentStatus paymentReviewRequired paymentReviewReason razorpayPaymentId refundStatus')
    .lean();
  res.json({ events: receipts.map((event) => ({
    eventId: event.eventId,
    eventType: event.eventType,
    status: event.status,
    providerOrderId: event.providerOrderId,
    paymentId: event.paymentId,
    reason: event.reason,
    receivedAt: event.receivedAt,
    order: event.order ? {
      id: event.order._id,
      orderNumber: event.order.orderNumber,
      status: event.order.status,
      total: event.order.total,
      paymentStatus: event.order.paymentStatus,
      paymentReviewRequired: event.order.paymentReviewRequired,
      paymentReviewReason: event.order.paymentReviewReason,
      razorpayPaymentId: event.order.razorpayPaymentId,
      refundStatus: event.order.refundStatus,
    } : null,
  })) });
});


export const refundPaymentReview = asyncHandler(async (req, res) => {
  const result = await requestFullPaymentReviewRefund(req.params.id, req.body?.paymentId, req.user._id);
  const message = result.refundStatus === 'processed'
    ? 'Full refund confirmed by Razorpay'
    : result.refundStatus === 'pending'
      ? 'Refund submitted and awaiting Razorpay confirmation'
      : result.refundStatus === 'failed'
        ? 'Refund failed; manual provider review is required'
        : 'Refund request saved for safe reconciliation';
  res.json({ message, ...result });
});

export const checkPaymentProvider = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const result = await checkRazorpayConnection();
    return res.json({
      status: 'connected',
      mode: result.mode,
      checkedAt: result.checkedAt,
      message: `Razorpay ${result.mode === 'live' ? 'Live' : 'Test'} Mode API access verified with a read-only request.`,
    });
  } catch (error) {
    const notConfigured = error?.statusCode === 503;
    return res.status(notConfigured ? 503 : 502).json({
      status: 'unavailable',
      mode: config.paymentMode,
      error: notConfigured
        ? 'Razorpay API credentials are not configured on the server.'
        : `Razorpay ${config.paymentMode === 'live' ? 'Live' : 'Test'} Mode connection could not be confirmed. Check the key pair or provider availability.`,
    });
  }
});


const validStaffEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const listStaff = asyncHandler(async (_req, res) => {
  const staff = await User.find({ role: { $in: ['kitchen', 'delivery'] } })
    .select('name email role active createdAt updatedAt')
    .sort({ role: 1, name: 1 })
    .lean();
  res.set('Cache-Control', 'no-store');
  res.json({ staff: staff.map(person => ({
    id: String(person._id), name: person.name, email: person.email,
    role: person.role, active: person.active !== false, createdAt: person.createdAt,
  })) });
});

export const createStaff = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body.password;
  const role = body.role;
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Staff name must be between 2 and 80 characters' });
  if (!validStaffEmail(email)) return res.status(400).json({ error: 'Enter a valid staff email address' });
  if (!['kitchen', 'delivery'].includes(role)) return res.status(400).json({ error: 'Choose either Kitchen staff or Delivery staff' });
  if (!isStrongEnough(password)) return res.status(400).json({ error: 'Password must be 10–72 characters with uppercase, lowercase and a number' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'An account with that email already exists' });

  let staff;
  try {
    staff = await User.create({
      name, email, passwordHash: await hashPassword(password), role, active: true, mustChangePassword: true,
      // Admin-provisioned accounts can sign in immediately. A staff invitation/
      // password-rotation flow remains a separate deployment step.
      emailVerifiedAt: new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'An account with that email already exists' });
    throw error;
  }
  publishAdminRefresh();
  res.status(201).json({ staff: { id: String(staff._id), name: staff.name, email: staff.email, role: staff.role, active: true, createdAt: staff.createdAt } });
});

export const setStaffActive = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ error: 'Invalid staff identifier' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  if (typeof body.active !== 'boolean') return res.status(400).json({ error: 'Provide active as true or false' });
  const staff = await User.findOne({ _id: req.params.id, role: { $in: ['kitchen', 'delivery'] } });
  if (!staff) return res.status(404).json({ error: 'Kitchen or delivery staff account not found' });
  if ((staff.active !== false) === body.active) {
    return res.json({ staff: { id: String(staff._id), name: staff.name, email: staff.email, role: staff.role, active: body.active } });
  }
  const updateResult = await User.updateOne(
    { _id: staff._id, role: staff.role, active: { $ne: body.active } },
    { $set: { active: body.active }, $inc: { sessionVersion: 1 } },
  );
  if (updateResult.modifiedCount !== 1) {
    return res.status(409).json({ error: 'Staff access changed in another request. Refresh the team list and retry.' });
  }
  if (!body.active) await disconnectUserSockets(staff._id);
  publishOpsRefresh();
  publishAdminRefresh();
  res.json({ staff: { id: String(staff._id), name: staff.name, email: staff.email, role: staff.role, active: body.active } });
});

export const assignOrderStaff = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ error: 'Invalid order identifier' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const hasKitchen = Object.hasOwn(body, 'kitchenStaffId');
  const hasDelivery = Object.hasOwn(body, 'deliveryStaffId');
  if (!hasKitchen && !hasDelivery) return res.status(400).json({ error: 'Provide kitchenStaffId or deliveryStaffId to assign the order' });

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.paymentStatus !== 'paid' || order.paymentReviewRequired || order.status === 'payment_review' ||
      ['cancelled', 'delivered'].includes(order.status) || order.paymentStatus === 'refunded') {
    return res.status(409).json({ error: 'Only paid, active orders without a payment review can be assigned' });
  }
  const fulfillmentMode = resolveFulfillmentMode(config.paymentMode, order.paymentMode || 'test');
  if (!fulfillmentMode) return res.status(409).json({ error: 'Order payment mode does not match the configured fulfillment mode' });

  const resolveStaff = async (id, role, label) => {
    if (id === null || id === '') return null;
    if (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id)) {
      throw Object.assign(new Error(`Choose a valid ${label} account`), { statusCode: 400 });
    }
    const found = await User.findOne({ _id: id, role, active: { $ne: false } }).select('name email role active');
    if (!found) throw Object.assign(new Error(`That ${label} account is unavailable or disabled`), { statusCode: 409 });
    return found;
  };

  if (hasKitchen) {
    if (!['order_received', 'in_kitchen'].includes(order.status)) return res.status(409).json({ error: 'Kitchen assignment can only change before dispatch' });
    const assigned = await resolveStaff(body.kitchenStaffId, 'kitchen', 'kitchen staff');
    order.kitchenStaff = assigned?._id || null;
  }
  if (hasDelivery) {
    if (!['order_received', 'in_kitchen', 'sent_to_delivery'].includes(order.status)) return res.status(409).json({ error: 'Delivery assignment can only change before delivery is completed' });
    const assigned = await resolveStaff(body.deliveryStaffId, 'delivery', 'delivery staff');
    order.deliveryStaff = assigned?._id || null;
  }
  await order.save();
  await order.populate([
    { path: 'kitchenStaff', select: 'name email role active' },
    { path: 'deliveryStaff', select: 'name email role active' },
  ]);
  publishOrderUpdate(order);
  publishOpsRefresh();
  publishAdminRefresh();
  res.json({ order: {
    id: String(order._id), orderNumber: order.orderNumber, status: order.status, fulfillmentMode,
    kitchenStaff: order.kitchenStaff ? { id: String(order.kitchenStaff._id), name: order.kitchenStaff.name, email: order.kitchenStaff.email, active: order.kitchenStaff.active !== false } : null,
    deliveryStaff: order.deliveryStaff ? { id: String(order.deliveryStaff._id), name: order.deliveryStaff.name, email: order.deliveryStaff.email, active: order.deliveryStaff.active !== false } : null,
  } });
});
