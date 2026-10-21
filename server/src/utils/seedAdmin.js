import mongoose from 'mongoose';
import '../config/env.js';
import { ensureAdminAccount } from './databaseBootstrap.js';
import { isStrongEnough } from './password.js';

const run = async () => {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Set a valid ADMIN_EMAIL in server/.env');
  if (!isStrongEnough(password)) throw new Error('Set ADMIN_PASSWORD to 10–72 chars containing uppercase, lowercase and a number');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pizza_delivery');
  const result = await ensureAdminAccount();
  console.info(result.created
    ? 'Admin account created. Credentials were not printed.'
    : 'Admin already exists; no password or role was changed.');
};
run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
