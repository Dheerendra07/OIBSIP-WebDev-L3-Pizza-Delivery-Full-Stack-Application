import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  dedupeKey: { type: String, required: true, unique: true, immutable: true, maxlength: 240 },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  eventType: { type: String, enum: ['payment_confirmed', 'payment_review', 'status_changed', 'refund_processed', 'delivery_confirmation_requested'], required: true, index: true },
  recipientEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  deliveryStatus: { type: String, enum: ['queued', 'sending', 'sent', 'dead'], default: 'queued', required: true, index: true },
  attempts: { type: Number, min: 0, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, required: true, index: true },
  leaseUntil: { type: Date, default: null, index: true },
  lastAttemptAt: { type: Date, default: null },
  sentAt: { type: Date, default: null, index: true },
  providerMessageId: { type: String, default: null, maxlength: 120 },
  lastError: { type: String, default: null, maxlength: 240 },
}, { timestamps: true, strict: 'throw' });

schema.index({ deliveryStatus: 1, nextAttemptAt: 1, createdAt: 1 });
schema.index({ order: 1, createdAt: -1 });
export default mongoose.model('OrderNotification', schema);
