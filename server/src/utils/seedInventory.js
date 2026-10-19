import mongoose from 'mongoose';
import '../config/env.js';
import InventoryItem from '../models/InventoryItem.js';
import { CATALOG } from './catalog.js';

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pizza_delivery');
  const entries = Object.entries(CATALOG).flatMap(([group, items]) => items.map((item) => ({ key: item.inventoryKey, category: ({ bases: 'base', sauces: 'sauce', cheeses: 'cheese', vegetables: 'vegetable' })[group], name: item.name, stock: 100, lowStockThreshold: 20 })));
  for (const entry of entries) await InventoryItem.updateOne({ key: entry.key }, { $setOnInsert: entry }, { upsert: true });
  console.info(`Ensured ${entries.length} inventory records (existing stock not overwritten).`);
};
run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
