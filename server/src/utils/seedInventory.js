import mongoose from 'mongoose';
import '../config/env.js';
import { ensureInventorySeeded } from './databaseBootstrap.js';

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pizza_delivery');
  const count = await ensureInventorySeeded();
  console.info(`Ensured ${count} inventory records (existing stock not overwritten).`);
};
run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
