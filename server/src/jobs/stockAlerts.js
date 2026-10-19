import cron from 'node-cron';
import mongoose from 'mongoose';
import InventoryItem from '../models/InventoryItem.js';
import Order from '../models/Order.js';
import { config } from '../config/env.js';
import { sendMail } from '../services/email.js';
import { getRazorpayClient } from '../services/payments.js';
import { inventoryRequirements } from '../utils/catalog.js';
import { classifyOrderPayments } from '../utils/paymentReconciliation.js';
import { publishAdminRefresh, publishOrderUpdate } from '../services/realtime.js';

export async function scanLowStock() {
  if (!config.adminAlertEmail) return { skipped: true, reason: 'ADMIN_ALERT_EMAIL is not configured' };
  const now = new Date();
  const cooldownMs = Math.max(1, config.stockAlertCooldownHours) * 60 * 60 * 1000;
  const lowItems = await InventoryItem.find({ $expr: { $lte: ['$stock', '$lowStockThreshold'] } }).lean();
  const due = lowItems.filter((item) => !item.lastLowStockNotificationAt || now - item.lastLowStockNotificationAt >= cooldownMs);
  if (!due.length) return { sent: 0 };
  const lines = due.map((item) => `${item.name} (${item.key}): ${item.stock} left; alert threshold ${item.lowStockThreshold}`);
  const delivery = await sendMail({ to: config.adminAlertEmail, subject: `[Pizza House] ${due.length} low-stock alert(s)`, text: `Please review inventory:\n\n${lines.join('\n')}` });
  if (delivery?.skipped) return { sent: 0, skipped: true, reason: 'SMTP is not fully configured; cooldown was not started' };
  await InventoryItem.updateMany({ key: { $in: due.map((item) => item.key) } }, { $set: { lastLowStockNotificationAt: now } });
  return { sent: due.length };
}

export async function releaseExpiredReservations(now = new Date()) {
  const expired = await Order.find({ inventoryReserved: true, paymentStatus: 'pending', status: 'pending_payment', stockReservationExpiresAt: { $lte: now } }).limit(100);
  let released = 0; let reconciled = 0; let deferred = 0; let razorpay;
  for (const candidate of expired) {
    if (!candidate.razorpayOrderId && candidate.paymentOrderCreationInProgress && candidate.stockReservedAt && now - candidate.stockReservedAt < 30 * 60 * 1000) { deferred += 1; continue; }
    let captured = null;
    if (candidate.razorpayOrderId) {
      if (!razorpay) { try { razorpay = getRazorpayClient(); } catch { deferred += 1; continue; } }
      let payments;
      try { payments = await razorpay.orders.fetchPayments(candidate.razorpayOrderId); }
      catch (error) { console.warn('[reservation scan] Could not verify provider status; hold preserved:', error.message); deferred += 1; continue; }
      const assessment = classifyOrderPayments(payments?.items, { orderId: candidate.razorpayOrderId, amountPaise: candidate.total * 100 });
      if (assessment.state === 'captured') captured = assessment.payment;
      else if (assessment.state === 'mismatch') { console.error(`[reservation job] Captured payment mismatch for ${candidate.orderNumber}; reservation preserved for manual review.`); deferred += 1; continue; }
      else if (assessment.state === 'in_flight') { deferred += 1; continue; }
    }
    const session = await mongoose.startSession();
    let reconciledOrderId = null;
    let inventoryWasReleased = false;
    try {
      await session.withTransaction(async () => {
        inventoryWasReleased = false;
        const order = await Order.findOne({ _id: candidate._id, inventoryReserved: true, paymentStatus: 'pending', stockReservationExpiresAt: { $lte: now } }).session(session);
        if (!order) return;
        if (captured) {
          order.paymentStatus = 'paid'; order.razorpayPaymentId = captured.id; order.paidAt = new Date(); order.status = 'order_received';
          order.inventoryReserved = false; order.paymentOrderCreationInProgress = false; order.stockReservedAt = null; order.stockReservationExpiresAt = null;
          await order.save({ session }); reconciledOrderId = order._id; reconciled += 1; return;
        }
        for (const requirement of inventoryRequirements(order.items)) await InventoryItem.updateOne({ key: requirement.key }, { $inc: { stock: requirement.quantity } }, { session });
        order.inventoryReserved = false; order.paymentOrderCreationInProgress = false; order.stockReservedAt = null; order.stockReservationExpiresAt = null; // Keep razorpayOrderId so a very late capture can still be reconciled to this order.
        // An unpaid reservation that expires is no longer an active order.
        // Mark it cancelled so customers can distinguish it from a payable order.
        order.status = 'cancelled';
        await order.save({ session }); released += 1; inventoryWasReleased = true; reconciledOrderId = order._id;
      });
    } finally { await session.endSession(); }
    if (reconciledOrderId) publishOrderUpdate(await Order.findById(reconciledOrderId).lean());
    if (inventoryWasReleased) publishAdminRefresh();
  }
  return { released, reconciled, deferred };
}

export function startStockAlertJob() {
  const stockSchedule = process.env.LOW_STOCK_SCAN_CRON || '*/15 * * * *';
  if (!cron.validate(stockSchedule)) throw new Error('LOW_STOCK_SCAN_CRON is invalid');
  const stockJob = cron.schedule(stockSchedule, () => scanLowStock().catch((error) => console.error('[low-stock job]', error.message)));
  const reservationJob = cron.schedule('*/2 * * * *', () => releaseExpiredReservations().catch((error) => console.error('[reservation job]', error.message)));
  console.info(`Low-stock scan scheduled: ${stockSchedule}; reservation reconciliation: */2 * * * *`);
  return { stop() { stockJob.stop(); reservationJob.stop(); } };
}
