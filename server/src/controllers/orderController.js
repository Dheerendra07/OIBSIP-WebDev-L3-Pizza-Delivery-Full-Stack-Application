import mongoose from 'mongoose';
import crypto from 'node:crypto';
import Order from '../models/Order.js';
import InventoryItem from '../models/InventoryItem.js';
import { inventoryRequirements } from '../utils/catalog.js';
import { buildOrderItems, calculateOrderTotals, validateDeliveryDetails } from '../utils/orderRules.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getRazorpayClient, verifyRazorpaySignature } from '../services/payments.js';
import { publishAdminRefresh, publishOrderUpdate } from '../services/realtime.js';

const isRequestObjectId = (value) => typeof value === 'string' && mongoose.isObjectIdOrHexString(value);

export const createOrder = asyncHandler(async (req, res) => {
  const items = buildOrderItems(req.body?.items);
  const deliveryDetails = validateDeliveryDetails(req.body?.deliveryDetails);
  const { subtotal, deliveryFee, total } = calculateOrderTotals(items);
  const order = await Order.create({ orderNumber: `PH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, user: req.user._id, items, deliveryDetails, subtotal, deliveryFee, total });
  publishOrderUpdate(order);
  res.status(201).json({ order: { id: order.id, orderNumber: order.orderNumber, items: order.items, deliveryDetails: order.deliveryDetails, subtotal, deliveryFee, total: order.total, status: order.status, paymentStatus: order.paymentStatus } });
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
    throw error;
  }
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { orderId, razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId, razorpay_signature: signature } = body;
  if (!razorpayOrderId || !razorpayPaymentId || !signature) return res.status(400).json({ error: 'Missing payment verification details' });
  if (![razorpayOrderId, razorpayPaymentId, signature].every((value) => typeof value === 'string' && value.trim().length > 0)) return res.status(400).json({ error: 'Missing payment verification details' });
  if (!isRequestObjectId(orderId)) return res.status(400).json({ error: 'A valid order ID is required' });
  const initial = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!initial) return res.status(404).json({ error: 'Order not found' });
  if (initial.paymentStatus === 'paid') {
    if (initial.razorpayOrderId === razorpayOrderId && initial.razorpayPaymentId === razorpayPaymentId) return res.json({ message: 'Payment already verified', order: { id: initial.id, orderNumber: initial.orderNumber, status: initial.status, paymentStatus: initial.paymentStatus } });
    return res.status(409).json({ error: 'Order already has a different successful payment' });
  }
  if (initial.razorpayOrderId !== razorpayOrderId || !verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, signature)) return res.status(400).json({ error: 'Payment signature verification failed' });
  const providerPayment = await getRazorpayClient().payments.fetch(razorpayPaymentId);
  if (providerPayment.order_id !== razorpayOrderId || providerPayment.amount !== initial.total * 100 || providerPayment.currency !== 'INR') return res.status(400).json({ error: 'Payment details do not match this order' });
  if (providerPayment.status !== 'captured') return res.status(409).json({ error: 'Payment is not captured yet. Please wait a moment and try again.' });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, user: req.user._id }).session(session);
      if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 });
      if (order.paymentStatus === 'paid') { if (order.razorpayPaymentId !== razorpayPaymentId) throw Object.assign(new Error('Order has already been paid using a different payment'), { statusCode: 409 }); return; }
      if (order.razorpayOrderId !== razorpayOrderId || order.status !== 'pending_payment') throw Object.assign(new Error('Order is not awaiting this payment'), { statusCode: 409 });
      if (!order.inventoryReserved) throw Object.assign(new Error('The ingredient reservation is missing. Contact support before attempting another payment.'), { statusCode: 409 });
      order.paymentStatus = 'paid'; order.razorpayPaymentId = razorpayPaymentId; order.paidAt = new Date(); order.status = 'order_received';
      order.inventoryReserved = false; order.paymentOrderCreationInProgress = false; order.stockReservedAt = null; order.stockReservationExpiresAt = null;
      await order.save({ session });
    });
  } finally { await session.endSession(); }
  const paid = await Order.findById(orderId);
  publishOrderUpdate(paid);
  res.json({ message: 'Payment verified', order: { id: paid.id, orderNumber: paid.orderNumber, status: paid.status, paymentStatus: paid.paymentStatus } });
});
