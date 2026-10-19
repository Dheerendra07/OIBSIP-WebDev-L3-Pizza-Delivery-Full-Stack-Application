import mongoose from 'mongoose';

const paymentWebhookReceiptSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, immutable: true, maxlength: 255 },
  eventType: { type: String, required: true, maxlength: 100 },
  status: { type: String, enum: ['processed', 'ignored', 'review_required'], required: true, index: true },
  providerOrderId: { type: String, default: null, maxlength: 100 },
  paymentId: { type: String, default: null, maxlength: 100 },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  reason: { type: String, default: null, maxlength: 200 },
  receivedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true, strict: 'throw' });

paymentWebhookReceiptSchema.index({ status: 1, receivedAt: -1 });
export default mongoose.model('PaymentWebhookReceipt', paymentWebhookReceiptSchema);
