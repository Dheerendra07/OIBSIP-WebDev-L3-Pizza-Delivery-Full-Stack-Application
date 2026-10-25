import OrderNotification from '../models/OrderNotification.js';
import User from '../models/User.js';
import { sendMail } from './email.js';
import { isMailConfigured } from '../utils/emailConfig.js';

const MAX_ATTEMPTS = 8;
const CLAIM_MS = 60_000;
const RETRY_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000];
const STAGES = new Set(['in_kitchen', 'sent_to_delivery', 'delivered', 'cancelled']);
const STAGE_LABELS = { in_kitchen: 'in preparation', sent_to_delivery: 'handed off for delivery', delivered: 'marked delivered', cancelled: 'cancelled' };
const idString = (value) => {
  const id = value && typeof value === 'object' ? value._id || value.id : value;
  return id == null ? '' : String(id);
};
const money = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 'amount unavailable';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
};
const rupeesFromPaise = (value) => Number.isSafeInteger(value) && value >= 0 ? money(value / 100) : 'amount awaiting confirmation';
const htmlEscape = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function eventAllowed(order, type) {
  if (type === 'payment_confirmed') return order.paymentStatus === 'paid' && order.status === 'order_received';
  if (type === 'payment_review') return order.paymentStatus === 'paid' && order.status === 'payment_review';
  if (type === 'status_changed') return order.paymentStatus === 'paid' && STAGES.has(order.status);
  if (type === 'refund_processed') return order.paymentStatus === 'refunded' && order.refundStatus === 'processed';
  return false;
}
function dedupeKey(id, order, type) {
  if (type === 'payment_confirmed') return 'order:' + id + ':payment-confirmed';
  if (type === 'payment_review') return 'order:' + id + ':payment-review:' + String(order.razorpayPaymentId || order.paymentReviewReason || 'review');
  if (type === 'status_changed') return 'order:' + id + ':status:' + String(order.status);
  if (type === 'refund_processed') return 'order:' + id + ':refund-processed:' + String(order.razorpayRefundId || 'confirmed');
  throw new Error('Unsupported order notification type');
}

export async function enqueueOrderNotification(order, eventType) {
  if (!order || typeof order !== 'object') throw new Error('A persisted order is required');
  const orderId = idString(order);
  const userId = idString(order.user);
  if (!orderId || !userId || !eventAllowed(order, eventType)) return false;
  const key = dedupeKey(orderId, order, eventType);
  const customer = await User.findById(userId).select('email name').lean();
  if (!customer || typeof customer.email !== 'string' || !customer.email.trim()) throw new Error('Customer email is missing');
  const payload = {
    orderNumber: String(order.orderNumber || '').slice(0, 40),
    customerName: String(order.deliveryDetails?.recipientName || customer.name || 'Customer').slice(0, 80),
    eventType,
    status: String(order.status || ''),
    paymentMode: order.paymentMode === 'live' ? 'live' : 'test',
    total: Number(order.total) || 0,
    refundAmount: Number.isSafeInteger(order.refundAmount) ? order.refundAmount : null,
    items: (Array.isArray(order.items) ? order.items : []).slice(0, 12).map(item => ({
      name: String(item.name || 'Pizza').slice(0, 100),
      quantity: Math.max(0, Number(item.quantity) || 0),
      lineTotal: Number.isFinite(Number(item.lineTotal)) ? Number(item.lineTotal) : 0,
    })),
  };
  try {
    const result = await OrderNotification.updateOne({ dedupeKey: key }, { $setOnInsert: {
      dedupeKey: key, order: orderId, user: userId, eventType,
      recipientEmail: customer.email.trim().toLowerCase(), payload,
      deliveryStatus: 'queued', attempts: 0, nextAttemptAt: new Date(),
      leaseUntil: null, lastAttemptAt: null, sentAt: null, providerMessageId: null, lastError: null,
    } }, { upsert: true });
    return Boolean(result.upsertedCount);
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

export async function queueOrderNotificationSafely(order, eventType) {
  try {
    return await enqueueOrderNotification(order, eventType);
  } catch (error) {
    console.error('[order notification] enqueue failed', {
      eventType, orderNumber: String(order?.orderNumber || '').slice(0, 40),
      errorName: String(error?.name || 'Error').slice(0, 60),
    });
    return false;
  }
}

function formatContent(p) {
  const number = p.orderNumber || 'your order';
  const test = p.paymentMode !== 'live';
  const prefix = test ? '[TEST MODE] ' : '';
  const disclaimer = test ? 'TEST MODE NOTICE: This is a sandbox-only status. It does not represent a live-money transaction or confirm physical kitchen preparation or driver delivery.' : '';
  let title, subject, message;
  if (p.eventType === 'payment_confirmed') {
    title = 'Order received'; subject = 'payment verified';
    message = 'Payment verification completed. This order is now recorded as received in Pizza House.';
  } else if (p.eventType === 'payment_review') {
    title = 'Payment received — review required'; subject = 'payment needs review';
    message = 'The payment provider reported a captured payment, but this order needs manual review before fulfillment. Do not pay again.';
  } else if (p.eventType === 'refund_processed') {
    title = 'Refund confirmed'; subject = 'refund confirmed';
    message = 'The application recorded a provider-confirmed refund of ' + rupeesFromPaise(p.refundAmount) + '.';
    if (test) message += ' This is sandbox refund evidence only.';
  } else {
    title = 'Order status updated'; subject = 'order status update';
    const stage = STAGE_LABELS[p.status] || 'updated';
    message = test
      ? 'The Test Mode workflow status is now ' + stage + '. This is simulated; no real kitchen or delivery partner is contacted.'
      : 'Your order status is now ' + stage + ' in Pizza House.';
  }
  const items = (Array.isArray(p.items) ? p.items : []).map(item => String(item.quantity) + ' x ' + item.name + ' — ' + money(item.lineTotal));
  const text = ['Pizza House', '', title, 'Order: ' + number, '', message, '', 'Order total: ' + money(p.total),
    'Items:', ...(items.length ? items.map(i => '- ' + i) : ['- Sign in to view the order details.']), '',
    disclaimer, '', 'Sign in to your Pizza House account for the current order record.'].filter(line => line !== '').join('\n');
  const itemRows = (Array.isArray(p.items) ? p.items : []).map(item =>
    '<tr><td style="padding:8px 0;border-bottom:1px solid #e6ebef;color:#233746;">' +
    htmlEscape(item.quantity + ' x ' + item.name) +
    '</td><td style="padding:8px 0;border-bottom:1px solid #e6ebef;text-align:right;color:#233746;white-space:nowrap;">' +
    htmlEscape(money(item.lineTotal)) + '</td></tr>').join('');
  const html = '<!doctype html><html><body style="margin:0;background:#f4f6f7;font-family:Arial,Helvetica,sans-serif;color:#223746;">' +
    '<div style="max-width:580px;margin:24px auto;padding:28px 24px;background:#fff;border:1px solid #dfe6ea;border-radius:12px;">' +
    '<p style="margin:0 0 18px;color:#b84532;font-weight:700;letter-spacing:2px;font-size:12px;">PIZZA HOUSE</p>' +
    '<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#1d3645;">' + htmlEscape(title) + '</h1>' +
    '<p style="margin:0 0 20px;color:#536977;line-height:1.6;">' + htmlEscape(message) + '</p>' +
    '<div style="padding:12px 14px;background:#f7f9fa;border:1px solid #e6ebef;border-radius:8px;"><p style="margin:0 0 12px;font-size:12px;color:#738490;">ORDER REFERENCE</p>' +
    '<p style="margin:0;font-size:16px;font-weight:700;color:#1d3645;">' + htmlEscape(number) + '</p></div>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;"><tbody>' + itemRows +
    '</tbody></table><p style="margin:18px 0 0;padding-top:14px;border-top:1px solid #dfe6ea;font-size:16px;font-weight:700;">Order total <span style="float:right;">' +
    htmlEscape(money(p.total)) + '</span></p>' +
    (disclaimer ? '<p role="note" style="margin:22px 0 0;padding:12px;border-left:3px solid #bc8731;background:#fff7e8;color:#72541f;font-size:12px;line-height:1.6;">' + htmlEscape(disclaimer) + '</p>' : '') +
    '<p style="margin:22px 0 0;color:#71838f;font-size:12px;line-height:1.6;">Sign in to your Pizza House account for the current order record.</p></div></body></html>';
  return { subject: prefix + 'Pizza House order ' + number + ': ' + subject, text, html };
}
export function formatOrderNotification(payload) { return formatContent(payload || {}); }

export async function processOrderNotificationQueue({ now = new Date(), batchSize = 10 } = {}) {
  if (!isMailConfigured()) return { processed: 0, failed: 0, dead: 0, skipped: true };
  const currentTime = now instanceof Date ? now : new Date(now);
  const limit = Number.isInteger(batchSize) ? Math.max(1, Math.min(batchSize, 50)) : 10;
  const result = { processed: 0, failed: 0, dead: 0, skipped: false };
  for (let i = 0; i < limit; i += 1) {
    const entry = await OrderNotification.findOneAndUpdate({ $or: [
      { deliveryStatus: 'queued', nextAttemptAt: { $lte: currentTime } },
      { deliveryStatus: 'sending', leaseUntil: { $lte: currentTime } },
    ] }, {
      $set: { deliveryStatus: 'sending', leaseUntil: new Date(currentTime.getTime() + CLAIM_MS), lastAttemptAt: currentTime },
      $inc: { attempts: 1 },
    }, { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } });
    if (!entry) break;
    try {
      const content = formatContent(entry.payload || {});
      const receipt = await sendMail({ to: entry.recipientEmail, subject: content.subject, text: content.text, html: content.html });
      if (receipt?.skipped) throw new Error('Email provider unavailable; notification remains retryable');
      await OrderNotification.updateOne({ _id: entry._id, deliveryStatus: 'sending' }, { $set: {
        deliveryStatus: 'sent', sentAt: new Date(),
        providerMessageId: String(receipt?.id || receipt?.messageId || '').slice(0, 120) || null,
        leaseUntil: null, lastError: null,
      } });
      result.processed += 1;
    } catch (error) {
      const at = new Date();
      const attempts = entry.attempts;
      const dead = attempts >= MAX_ATTEMPTS;
      const delay = RETRY_MS[Math.min(Math.max(attempts - 1, 0), RETRY_MS.length - 1)];
      const safeError = String(error?.message || 'Email delivery failed').replace(/[\r\n\t]+/g, ' ').slice(0, 240);
      await OrderNotification.updateOne({ _id: entry._id, deliveryStatus: 'sending' }, { $set: {
        deliveryStatus: dead ? 'dead' : 'queued',
        nextAttemptAt: dead ? at : new Date(at.getTime() + delay),
        leaseUntil: null,
        lastError: safeError,
      } });
      if (dead) result.dead += 1;
      else result.failed += 1;
    }
  }
  return result;
}
