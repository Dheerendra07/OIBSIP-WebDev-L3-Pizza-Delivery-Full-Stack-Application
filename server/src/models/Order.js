import mongoose from 'mongoose';

const deliveryDetailsSchema = new mongoose.Schema({
  recipientName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  phone: { type: String, required: true, match: /^[6-9]\d{9}$/ },
  addressLine: { type: String, required: true, trim: true, minlength: 5, maxlength: 180 },
  landmark: { type: String, trim: true, maxlength: 100, default: '' },
  city: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  state: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  postalCode: { type: String, required: true, match: /^[1-9]\d{5}$/ },
  instructions: { type: String, trim: true, maxlength: 200, default: '' },
}, { _id: false, strict: 'throw' });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: [{
    name: { type: String, required: true },
    quantity: { type: Number, min: 1, max: 10, required: true },
    unitPrice: { type: Number, min: 0, required: true },
    lineTotal: { type: Number, min: 0, required: true },
    ingredients: { base: String, sauce: String, cheese: String, vegetables: [String] },
    inventoryKeys: { type: [String], required: true },
  }],
  subtotal: { type: Number, required: true, min: 0 },
  deliveryFee: { type: Number, required: true, min: 0, default: 29 },
  total: { type: Number, required: true, min: 0 },
  // Optional at the schema root for legacy orders; new orders must pass API validation.
  deliveryDetails: { type: deliveryDetailsSchema, default: undefined },
  status: { type: String, enum: ['pending_payment', 'payment_review', 'order_received', 'in_kitchen', 'sent_to_delivery', 'delivered', 'cancelled'], default: 'pending_payment', index: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending', index: true },
  // Persist the mode used at checkout so Test Mode transactions can never become real kitchen orders later.
  paymentMode: { type: String, enum: ['test', 'live'], default: 'test', required: true, index: true },
  paymentReviewRequired: { type: Boolean, default: false, index: true },
  paymentReviewReason: { type: String, default: null },
  razorpayRefundId: { type: String, default: null, index: true },
  refundStatus: { type: String, enum: ['none', 'requested', 'pending', 'processed', 'failed'], default: 'none', index: true },
  refundIdempotencyKey: { type: String, default: null },
  refundAmount: { type: Number, default: null, min: 1 },
  refundRequestedAt: { type: Date, default: null },
  refundProcessedAt: { type: Date, default: null },
  refundRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  inventoryReserved: { type: Boolean, default: false, index: true },
  paymentOrderCreationInProgress: { type: Boolean, default: false },
  stockReservedAt: { type: Date, default: null },
  stockReservationExpiresAt: { type: Date, default: null, index: true },
  razorpayOrderId: { type: String, default: null, index: true },
  checkoutRequestId: { type: String, default: null },
  checkoutRequestFingerprint: { type: String, default: null },
  razorpayPaymentId: { type: String, default: null, index: true },
  paidAt: { type: Date, default: null },
  kitchenStartedAt: { type: Date, default: null },
  dispatchedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  deliveryConfirmationRequestedAt: { type: Date, default: null },
  deliveryConfirmedAt: { type: Date, default: null },
  deliveryConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  kitchenStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  deliveryStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
}, { timestamps: true, strict: 'throw' });

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index(
  { user: 1, checkoutRequestId: 1 },
  { unique: true, partialFilterExpression: { checkoutRequestId: { $type: 'string' } } },
);
export default mongoose.model('Order', orderSchema);
