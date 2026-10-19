import mongoose from 'mongoose';

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
  status: { type: String, enum: ['pending_payment', 'order_received', 'in_kitchen', 'sent_to_delivery', 'delivered', 'cancelled'], default: 'pending_payment', index: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending', index: true },
  inventoryReserved: { type: Boolean, default: false, index: true },
  paymentOrderCreationInProgress: { type: Boolean, default: false },
  stockReservedAt: { type: Date, default: null },
  stockReservationExpiresAt: { type: Date, default: null, index: true },
  razorpayOrderId: { type: String, default: null, index: true },
  razorpayPaymentId: { type: String, default: null, index: true },
  paidAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });

orderSchema.index({ user: 1, createdAt: -1 });
export default mongoose.model('Order', orderSchema);
