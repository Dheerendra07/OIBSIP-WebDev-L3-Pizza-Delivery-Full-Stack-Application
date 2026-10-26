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
import { isMailConfigured } from '../utils/emailConfig.js';
import { sendMail, passwordResetUrl } from '../services/email.js';
import { createOpaqueToken } from '../utils/tokens.js';

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
  res.json({ orders: orders.map((o) => ({ id: o._id, orderNumber: o.orderNumber, user: o.user, items: o.items, deliveryDetails: o.deliveryDetails, subtotal: o.subtotal, deliveryFee: o.deliveryFee, total: o.total, status: o.status, paymentStatus: o.paymentStatus, paymentReviewRequired: o.paymentReviewRequired, paymentReviewReason: o.paymentReviewReason, refundStatus: o.refundStatus, paymentMode: o.paymentMode || 'test', createdAt: o.createdAt, updatedAt: o.updatedAt, paidAt: o.paidAt, kitchenStartedAt: o.kitchenStartedAt, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt, deliveryConfirmationRequestedAt: o.deliveryConfirmationRequestedAt, deliveryConfirmedAt: o.deliveryConfirmedAt, kitchenStaff: o.kitchenStaff ? { id: String(o.kitchenStaff._id), name: o.kitchenStaff.name, email: o.kitchenStaff.email, role: o.kitchenStaff.role, active: o.kitchenStaff.active !== false } : null, deliveryStaff: o.deliveryStaff ? { id: String(o.deliveryStaff._id), name: o.deliveryStaff.name, email: o.deliveryStaff.email, role: o.deliveryStaff.role, active: o.deliveryStaff.active !== false } : null })) });
});
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { status } = body;
  if (typeof status !== 'string' || !status.trim()) return res.status(400).json({ error: 'A valid order status is required' });

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (status === 'delivered') return res.status(409).json({ error: 'Only the customer can confirm receipt. The assigned delivery partner must request confirmation first.' });
  const fulfillmentMode = resolveFulfillmentMode(config.paymentMode, order.paymentMode || 'test');
  if (!fulfillmentMode) {
    return res.status(409).json({
      error: config.paymentMode === 'live'
        ? 'This Test Mode order cannot enter real kitchen or delivery operations. Only verified Live Mode orders can be fulfilled for real.'
        : 'The configured payment mode and this order do not match, so no fulfillment status was changed.',
    });
  }

  const requiredStaff = status === 'in_kitchen'
    ? { id: order.kitchenStaff, role: 'kitchen', field: 'kitchenStaff', label: 'active kitchen owner' }
    : ['sent_to_delivery', 'delivered'].includes(status)
      ? { id: order.deliveryStaff, role: 'delivery', field: 'deliveryStaff', label: 'active delivery partner' }
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

  // A provider webhook/refund may put the order on payment review after the read
  // above. Compare-and-set the exact stage and payment guard in one Mongo write
  // so a stale staff/admin request cannot overwrite a newer financial hold.
  const filter = {
    _id: order._id,
    status: order.status,
    paymentStatus: 'paid',
    paymentReviewRequired: { $ne: true },
  };
  if (requiredStaff) filter[requiredStaff.field] = requiredStaff.id;

  const changedAt = new Date();
  const update = { status };
  if (status === 'in_kitchen') update.kitchenStartedAt = changedAt;
  if (status === 'sent_to_delivery') update.dispatchedAt = changedAt;
  if (status === 'delivered') update.deliveredAt = changedAt;

  const updatedOrder = await Order.findOneAndUpdate(
    filter,
    { $set: update },
    { new: true, runValidators: true },
  );
  if (!updatedOrder) {
    return res.status(409).json({
      error: 'The order or payment-review state changed while this update was being saved. Refresh the queue and review its current status.',
    });
  }

  publishOrderUpdate(updatedOrder);
  await queueOrderNotificationSafely(updatedOrder, 'status_changed');
  publishAdminRefresh();
  res.json({
    order: {
      id: String(updatedOrder._id),
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      paymentStatus: updatedOrder.paymentStatus,
      paymentMode: updatedOrder.paymentMode || 'test',
      fulfillmentMode,
      paidAt: updatedOrder.paidAt || null,
      kitchenStartedAt: updatedOrder.kitchenStartedAt || null,
      dispatchedAt: updatedOrder.dispatchedAt || null,
      deliveredAt: updatedOrder.deliveredAt || null,
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
    deliveryConfigured: isMailConfigured(),
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

export const sendAdminTestEmail = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!isMailConfigured()) {
    return res.status(503).json({ error: 'Email provider is not configured. Configure Resend or SMTP in Render before sending a test email.' });
  }

  const recipient = typeof req.user?.email === 'string' ? req.user.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return res.status(409).json({ error: 'The signed-in administrator does not have a valid email address for this test.' });
  }

  const requestedAt = new Date();
  const text = [
    'Pizza House',
    '',
    'This is a test email requested by an authenticated Pizza House administrator.',
    `Requested at: ${requestedAt.toISOString()}`,
    '',
    'The email provider accepted this request. Check the inbox and spam folder.',
    'Provider acceptance does not confirm final inbox delivery.',
  ].join('\n');
  const html = '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#223746;">' +
    '<div style="max-width:560px;margin:20px auto;padding:24px;border:1px solid #dfe6ea;border-radius:12px;">' +
    '<p style="margin:0 0 16px;color:#b84532;font-weight:700;letter-spacing:2px;font-size:12px;">PIZZA HOUSE</p>' +
    '<h1 style="font-size:23px;line-height:1.3;">Email delivery test</h1>' +
    '<p>An authenticated administrator requested this test message.</p>' +
    '<p>The email provider accepted this request. Check the inbox and spam folder; provider acceptance does not confirm final inbox delivery.</p>' +
    `<p style="font-size:12px;color:#738490;">Requested at: ${requestedAt.toISOString()}</p>` +
    '</div></body></html>';

  try {
    await sendMail({
      to: recipient,
      subject: 'Pizza House email delivery test',
      text,
      html,
    });
  } catch {
    return res.status(502).json({
      error: 'The email provider could not accept the test message. Check its credentials and verified sender address, then retry.',
    });
  }

  return res.json({
    status: 'accepted',
    acceptedAt: new Date().toISOString(),
    message: 'Email provider accepted the test message. Check your inbox and spam folder; this does not guarantee final inbox delivery.',
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
    .select('name email role active createdAt updatedAt mustChangePassword +passwordResetTokenHash +passwordResetExpiresAt')
    .sort({ role: 1, name: 1 })
    .lean();
  const now = new Date();
  res.set('Cache-Control', 'no-store');
  res.json({ staff: staff.map(person => ({
    id: String(person._id), name: person.name, email: person.email,
    role: person.role, active: person.active !== false, createdAt: person.createdAt,
    mustChangePassword: person.mustChangePassword === true,
    invitationStatus: person.mustChangePassword !== true
      ? 'complete'
      : person.passwordResetTokenHash && person.passwordResetExpiresAt > now
        ? 'pending'
        : 'setup_required',
    invitationExpiresAt: person.passwordResetExpiresAt || null,
  })) });
});

export const createStaff = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const suppliedPassword = body.password;
  const role = body.role;
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Staff name must be between 2 and 80 characters' });
  if (!validStaffEmail(email)) return res.status(400).json({ error: 'Enter a valid staff email address' });
  if (!['kitchen', 'delivery'].includes(role)) return res.status(400).json({ error: 'Choose either Kitchen staff or Delivery staff' });
  if (suppliedPassword != null && typeof suppliedPassword !== 'string') return res.status(400).json({ error: 'Initial password must be text' });
  const hasSuppliedPassword = typeof suppliedPassword === 'string' && suppliedPassword.length > 0;
  if (hasSuppliedPassword && !isStrongEnough(suppliedPassword)) return res.status(400).json({ error: 'Password must be 10–72 characters with uppercase, lowercase and a number' });
  if (!hasSuppliedPassword && !isMailConfigured()) {
    return res.status(503).json({ error: 'Staff invitations require a configured email provider. Configure Resend or SMTP in Render, then retry.' });
  }
  if (await User.exists({ email })) return res.status(409).json({ error: 'An account with that email already exists' });

  const invitation = hasSuppliedPassword ? null : createOpaqueToken();
  const expiresAt = invitation ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;
  let staff;
  try {
    staff = await User.create({
      name, email,
      // Invitation-only accounts get a high-entropy, undisclosed password hash.
      // The recipient chooses their password through the one-time setup link.
      passwordHash: await hashPassword(hasSuppliedPassword ? suppliedPassword : `InviteA9${invitation.token}`),
      role, active: true, mustChangePassword: true,
      emailVerifiedAt: new Date(),
      passwordResetTokenHash: invitation?.hash ?? null,
      passwordResetExpiresAt: expiresAt,
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'An account with that email already exists' });
    throw error;
  }

  if (invitation) {
    const setupUrl = passwordResetUrl(invitation.token);
    try {
      await sendMail({
        to: email,
        subject: 'Set up your Pizza House team account',
        text: `Hi ${name},\n\nYour Pizza House ${role === 'kitchen' ? 'kitchen' : 'delivery'} account has been created. Set a private password using this one-time link within 24 hours:\n\n${setupUrl}\n\nAfter setting your password, sign in from the Pizza House team sign-in page. If you were not expecting this invitation, contact your administrator.`,
      });
    } catch {
      await User.deleteOne({ _id: staff._id }).catch(() => {});
      return res.status(502).json({ error: 'The staff account was not kept because the invitation email could not be accepted. Check the email provider and sender, then retry.' });
    }
  }

  publishAdminRefresh();
  res.status(201).json({
    staff: { id: String(staff._id), name: staff.name, email: staff.email, role: staff.role, active: true, createdAt: staff.createdAt },
    invitationSent: Boolean(invitation),
    invitationExpiresAt: expiresAt,
  });
});

export const resendStaffInvitation = asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(400).json({ error: 'Invalid staff identifier' });
  if (!isMailConfigured()) return res.status(503).json({ error: 'Staff invitations require a configured email provider. Configure Resend or SMTP in Render, then retry.' });

  const staff = await User.findOne({
    _id: req.params.id,
    role: { $in: ['kitchen', 'delivery'] },
    active: { $ne: false },
    mustChangePassword: true,
  }).select('name email role active mustChangePassword');
  if (!staff) return res.status(409).json({ error: 'Only active staff who have not finished password setup can receive a new invitation.' });

  const invitation = createOpaqueToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const saved = await User.updateOne(
    { _id: staff._id, role: staff.role, active: { $ne: false }, mustChangePassword: true },
    { $set: { passwordResetTokenHash: invitation.hash, passwordResetExpiresAt: expiresAt } },
  );
  if (saved.modifiedCount !== 1) return res.status(409).json({ error: 'This staff account changed while the invitation was being prepared. Refresh and retry.' });

  try {
    await sendMail({
      to: staff.email,
      subject: 'Your Pizza House team setup link',
      text: `Hi ${staff.name},\n\nHere is a fresh one-time link to set up your Pizza House team account. It expires in 24 hours:\n\n${passwordResetUrl(invitation.token)}\n\nIf you have already set your password, you can ignore this email.`,
    });
  } catch {
    await User.updateOne(
      { _id: staff._id, passwordResetTokenHash: invitation.hash },
      { $set: { passwordResetTokenHash: null, passwordResetExpiresAt: null } },
    ).catch(() => {});
    return res.status(502).json({ error: 'The invitation email could not be accepted. Check the provider and sender configuration, then retry.' });
  }

  publishAdminRefresh();
  res.json({ invitationSent: true, invitationExpiresAt: expiresAt, message: 'A fresh team setup link was accepted by the email provider.' });
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
