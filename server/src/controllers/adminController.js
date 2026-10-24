import InventoryItem from '../models/InventoryItem.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import PaymentWebhookReceipt from '../models/PaymentWebhookReceipt.js';
import { requestFullPaymentReviewRefund } from '../services/refunds.js';
import { checkRazorpayConnection } from '../services/payments.js';
import { config } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateOrderStatusTransition } from '../utils/orderRules.js';
import { publishAdminRefresh, publishOrderUpdate } from '../services/realtime.js';

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
  const orders = await Order.find().sort({ createdAt: -1 }).limit(200).populate('user', 'name email').lean();
  res.json({ orders: orders.map((o) => ({ id: o._id, orderNumber: o.orderNumber, user: o.user, items: o.items, deliveryDetails: o.deliveryDetails, subtotal: o.subtotal, deliveryFee: o.deliveryFee, total: o.total, status: o.status, paymentStatus: o.paymentStatus, paymentReviewRequired: o.paymentReviewRequired, paymentReviewReason: o.paymentReviewReason, refundStatus: o.refundStatus, paymentMode: o.paymentMode || 'test', createdAt: o.createdAt })) });
});
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { status } = body;
  if (typeof status !== 'string' || !status.trim()) return res.status(400).json({ error: 'A valid order status is required' });
  const order = await Order.findById(req.params.id); if (!order) return res.status(404).json({ error: 'Order not found' });
  if (config.nodeEnv === 'production' && (config.paymentMode !== 'live' || (order.paymentMode || 'test') !== 'live')) {
    return res.status(409).json({ error: 'Real fulfillment is blocked unless the app and this order both use verified Live Mode payments.' });
  }
  const transition = validateOrderStatusTransition(order, status);
  if (!transition.allowed) return res.status(transition.statusCode).json({ error: transition.message });
  order.status = status; await order.save();
  publishOrderUpdate(order);
  res.json({ order: { id: order.id, orderNumber: order.orderNumber, status: order.status, paymentStatus: order.paymentStatus } });
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
