import mongoose from 'mongoose';
import Order from '../models/Order.js';
import User from '../models/User.js';
import { config } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { resolveFulfillmentMode, validateOrderStatusTransition } from '../utils/orderRules.js';
import { publishAdminRefresh, publishOpsRefresh, publishOrderUpdate } from '../services/realtime.js';
import { queueOrderNotificationSafely } from '../services/orderNotifications.js';

const sameId = (left, right) => String(left?._id ?? left ?? '') === String(right?._id ?? right ?? '');

function publicOpsOrder(order) {
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    customerName: order.deliveryDetails?.recipientName || order.user?.name || 'Customer',
    items: order.items,
    deliveryDetails: order.deliveryDetails,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMode: order.paymentMode || 'test',
    paymentReviewRequired: Boolean(order.paymentReviewRequired),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt || null,
    kitchenStartedAt: order.kitchenStartedAt || null,
    dispatchedAt: order.dispatchedAt || null,
    deliveredAt: order.deliveredAt || null,
    kitchenStaff: order.kitchenStaff ? { id: String(order.kitchenStaff._id ?? order.kitchenStaff), name: order.kitchenStaff.name || '' } : null,
    deliveryStaff: order.deliveryStaff ? { id: String(order.deliveryStaff._id ?? order.deliveryStaff), name: order.deliveryStaff.name || '' } : null,
  };
}

export const listOpsOrders = asyncHandler(async (req, res) => {
  const isKitchen = req.user.role === 'kitchen';
  const assignment = isKitchen ? { kitchenStaff: req.user._id } : { deliveryStaff: req.user._id };
  const statuses = isKitchen
    ? ['order_received', 'in_kitchen']
    : ['in_kitchen', 'sent_to_delivery', 'delivered'];
  const orders = await Order.find({
    ...assignment,
    status: { $in: statuses },
    paymentStatus: 'paid',
    paymentReviewRequired: { $ne: true },
  })
    .sort({ createdAt: 1 })
    .limit(100)
    .populate('user', 'name')
    .populate('kitchenStaff', 'name')
    .populate('deliveryStaff', 'name')
    .lean();
  res.set('Cache-Control', 'no-store');
  res.json({ orders: orders.map(publicOpsOrder), role: req.user.role, paymentMode: config.paymentMode });
});

export const updateOpsOrderStatus = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ error: 'Invalid order identifier' });
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const status = body.status;
  if (typeof status !== 'string' || !status.trim()) return res.status(400).json({ error: 'A valid order status is required' });

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.paymentStatus !== 'paid' || order.paymentReviewRequired || order.status === 'payment_review') {
    return res.status(409).json({ error: 'Only verified paid orders without a payment review can enter fulfillment' });
  }
  const fulfillmentMode = resolveFulfillmentMode(config.paymentMode, order.paymentMode || 'test');
  if (!fulfillmentMode) {
    return res.status(409).json({ error: 'The order payment mode does not match the configured fulfillment mode' });
  }

  if (req.user.role === 'kitchen') {
    if (!sameId(order.kitchenStaff, req.user._id)) return res.status(403).json({ error: 'This order is not assigned to your kitchen account' });
    const allowedNext = order.status === 'order_received' ? 'in_kitchen' : 'sent_to_delivery';
    if (status !== allowedNext) return res.status(400).json({ error: 'Kitchen staff can only accept a new order or hand a prepared order to delivery' });
    if (status === 'sent_to_delivery') {
      if (!order.deliveryStaff) return res.status(409).json({ error: 'Assign an active delivery partner before handing off this order' });
      const activeDriver = await User.exists({ _id: order.deliveryStaff, role: 'delivery', active: { $ne: false } });
      if (!activeDriver) return res.status(409).json({ error: 'The assigned delivery account is no longer active. Ask the administrator to reassign this order' });
    }
  } else if (req.user.role === 'delivery') {
    if (!sameId(order.deliveryStaff, req.user._id)) return res.status(403).json({ error: 'This order is not assigned to your delivery account' });
    if (order.status !== 'sent_to_delivery' || status !== 'delivered') {
      return res.status(400).json({ error: 'Delivery staff can only confirm an order after it has been dispatched' });
    }
  } else {
    return res.status(403).json({ error: 'Kitchen or delivery staff access required' });
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
  publishOpsRefresh();
  publishAdminRefresh();

  res.json({
    order: {
      id: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMode: order.paymentMode || 'test',
      fulfillmentMode,
      kitchenStartedAt: order.kitchenStartedAt || null,
      dispatchedAt: order.dispatchedAt || null,
      deliveredAt: order.deliveredAt || null,
    },
  });
});
