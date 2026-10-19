import mongoose from 'mongoose';

const inventorySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  category: { type: String, enum: ['base', 'sauce', 'cheese', 'vegetable'], required: true },
  name: { type: String, required: true, trim: true },
  stock: { type: Number, min: 0, required: true, default: 0 },
  lowStockThreshold: { type: Number, min: 0, required: true, default: 20 },
  lastLowStockNotificationAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });
export default mongoose.model('InventoryItem', inventorySchema);
