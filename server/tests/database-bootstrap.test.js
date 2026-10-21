import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../src/utils/catalog.js';
import { ensureAdminAccount, ensureInventorySeeded } from '../src/utils/databaseBootstrap.js';

test('inventory bootstrap uses insert-only upserts and preserves existing stock', async () => {
  const operations = [];
  const count = await ensureInventorySeeded({
    InventoryItemModel: {
      async updateOne(...args) { operations.push(args); },
    },
  });

  const expectedCount = Object.values(CATALOG).reduce((sum, items) => sum + items.length, 0);
  assert.equal(count, expectedCount);
  assert.equal(operations.length, expectedCount);
  for (const [filter, update, options] of operations) {
    assert.equal(typeof filter.key, 'string');
    assert.equal(options.upsert, true);
    assert.deepEqual(Object.keys(update), ['$setOnInsert']);
    assert.equal(update.$setOnInsert.key, filter.key);
    assert.equal(update.$setOnInsert.stock, 100);
    assert.equal(update.$setOnInsert.lowStockThreshold, 20);
  }
});

test('admin bootstrap safely skips when both bootstrap credentials are absent', async () => {
  let queried = false;
  const result = await ensureAdminAccount({
    env: {},
    UserModel: { async findOne() { queried = true; } },
  });
  assert.deepEqual(result, { skipped: true });
  assert.equal(queried, false);
});

test('admin bootstrap creates a verified admin with a hash, never the raw password', async () => {
  let created;
  const env = { ADMIN_EMAIL: '  OWNER@EXAMPLE.TEST ', ADMIN_PASSWORD: 'StrongPassword123' };
  const result = await ensureAdminAccount({
    env,
    UserModel: {
      async findOne(filter) { assert.deepEqual(filter, { email: 'owner@example.test' }); return null; },
      async create(document) { created = document; },
    },
    async hashPasswordFn(password) { assert.equal(password, env.ADMIN_PASSWORD); return 'hash-of-admin-password'; },
  });
  assert.equal(result.created, true);
  assert.equal(result.email, 'owner@example.test');
  assert.equal(created.email, 'owner@example.test');
  assert.equal(created.role, 'admin');
  assert.equal(created.name, 'Pizza House Admin');
  assert.equal(created.passwordHash, 'hash-of-admin-password');
  assert.equal(Object.hasOwn(created, 'password'), false);
  assert.ok(created.emailVerifiedAt instanceof Date);
});

test('admin bootstrap does not reset an existing admin password', async () => {
  let created = false;
  const result = await ensureAdminAccount({
    env: { ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD: 'StrongPassword123' },
    UserModel: {
      async findOne() { return { role: 'admin' }; },
      async create() { created = true; },
    },
  });
  assert.equal(result.created, false);
  assert.equal(created, false);
});

test('admin bootstrap never promotes an existing customer account', async () => {
  let created = false;
  await assert.rejects(
    () => ensureAdminAccount({
      env: { ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD: 'StrongPassword123' },
      UserModel: {
        async findOne() { return { role: 'user' }; },
        async create() { created = true; },
      },
    }),
    /already belongs to a non-admin account/,
  );
  assert.equal(created, false);
});

test('admin bootstrap rejects partial or weak credentials', async () => {
  await assert.rejects(
    () => ensureAdminAccount({ env: { ADMIN_EMAIL: 'owner@example.test' }, UserModel: {} }),
    /Set both ADMIN_EMAIL and ADMIN_PASSWORD/,
  );
  await assert.rejects(
    () => ensureAdminAccount({
      env: { ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD: 'weak' },
      UserModel: {},
    }),
    /ADMIN_PASSWORD/,
  );
});

test('overlapping first-start admin creation accepts only a duplicate-key admin winner', async () => {
  let lookups = 0;
  const result = await ensureAdminAccount({
    env: { ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD: 'StrongPassword123' },
    UserModel: {
      async findOne() {
        lookups += 1;
        return lookups === 1 ? null : { role: 'admin' };
      },
      async create() { throw Object.assign(new Error('duplicate key'), { code: 11000 }); },
    },
    async hashPasswordFn() { return 'hashed'; },
  });
  assert.equal(result.created, false);
  assert.equal(lookups, 2);
});
