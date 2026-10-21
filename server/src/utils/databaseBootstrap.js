import InventoryItem from '../models/InventoryItem.js';
import User from '../models/User.js';
import { CATALOG } from './catalog.js';
import { hashPassword, isStrongEnough } from './password.js';

const categoryByGroup = {
  bases: 'base',
  sauces: 'sauce',
  cheeses: 'cheese',
  vegetables: 'vegetable',
};

/**
 * Ensure the starting inventory exists without resetting stock already managed by the app.
 * Safe to call after every server start: existing records are only matched, never overwritten.
 */
export async function ensureInventorySeeded({ InventoryItemModel = InventoryItem, catalog = CATALOG } = {}) {
  const entries = Object.entries(catalog).flatMap(([group, items]) => items.map((item) => ({
    key: item.inventoryKey,
    category: categoryByGroup[group],
    name: item.name,
    stock: 100,
    lowStockThreshold: 20,
  })));

  for (const entry of entries) {
    await InventoryItemModel.updateOne({ key: entry.key }, { $setOnInsert: entry }, { upsert: true });
  }
  return entries.length;
}

/**
 * Create the configured admin only when absent. Existing admin credentials are never replaced,
 * and a customer account is never promoted merely because its email matches ADMIN_EMAIL.
 */
export async function ensureAdminAccount({ env = process.env, UserModel = User, hashPasswordFn = hashPassword } = {}) {
  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;

  if (!email && !password) return { skipped: true };
  if (!email || !password) throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD to bootstrap the admin account.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Set a valid ADMIN_EMAIL.');
  if (!isStrongEnough(password)) throw new Error('Set ADMIN_PASSWORD to 10–72 characters containing uppercase, lowercase and a number.');

  const existing = await UserModel.findOne({ email });
  if (existing) {
    if (existing.role !== 'admin') {
      throw new Error('ADMIN_EMAIL already belongs to a non-admin account. Choose a separate admin email; no role was changed.');
    }
    return { skipped: false, created: false, email };
  }

  const adminDocument = {
    name: 'Pizza House Admin',
    email,
    passwordHash: await hashPasswordFn(password),
    role: 'admin',
    emailVerifiedAt: new Date(),
  };
  try {
    await UserModel.create(adminDocument);
    return { skipped: false, created: true, email };
  } catch (error) {
    // Two overlapping startups may race on the unique email index. Accept the winner only
    // when the saved account is an admin; never convert a customer account.
    if (error?.code !== 11000) throw error;
    const raced = await UserModel.findOne({ email });
    if (raced?.role === 'admin') return { skipped: false, created: false, email };
    if (raced) {
      throw new Error('ADMIN_EMAIL already belongs to a non-admin account. Choose a separate admin email; no role was changed.');
    }
    throw error;
  }
}
