import mongoose from 'mongoose';

const issueSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  category: { type: String, enum: ['missing_item', 'wrong_item', 'damaged_item', 'quality_issue', 'delivery_delay', 'payment_refund', 'other'], required: true },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 600 },
  status: { type: String, enum: ['open', 'under_review', 'resolved'], default: 'open', index: true },
  active: { type: Boolean, default: true, index: true },
  customerUpdate: { type: String, trim: true, maxlength: 600, default: '' },
  statusChangedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });

// One active support case per order/customer; a new case is allowed after resolution.
issueSchema.index({ order: 1, user: 1 }, {
  unique: true,
  partialFilterExpression: { active: true },
  name: 'one_active_issue_per_order',
});
issueSchema.index({ user: 1, updatedAt: -1 });
issueSchema.index({ status: 1, updatedAt: -1 });

export default mongoose.model('OrderIssue', issueSchema);
