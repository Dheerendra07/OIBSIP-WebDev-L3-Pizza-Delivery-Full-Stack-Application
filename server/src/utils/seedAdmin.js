import mongoose from 'mongoose';
import '../config/env.js';
import User from '../models/User.js';
import { hashPassword, isStrongEnough } from './password.js';

const run = async () => {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(); const password = process.env.ADMIN_PASSWORD;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Set a valid ADMIN_EMAIL in server/.env');
  if (!isStrongEnough(password)) throw new Error('Set ADMIN_PASSWORD to 10–72 chars containing uppercase, lowercase and a number');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pizza_delivery');
  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== 'admin') throw new Error('That email already belongs to a non-admin account. Use a separate admin email; no role was changed.');
    console.info('Admin already exists; no password or role was changed.'); return;
  }
  await User.create({ name: 'Pizza House Admin', email, passwordHash: await hashPassword(password), role: 'admin', emailVerifiedAt: new Date() });
  console.info('Admin account created. Credentials were not printed.');
};
run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
