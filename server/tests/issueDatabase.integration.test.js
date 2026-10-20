import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { config } from '../src/config/env.js';
import User from '../src/models/User.js';
import Order from '../src/models/Order.js';
import OrderIssue from '../src/models/OrderIssue.js';

// The normal local unit suite stays lightweight. GitHub Actions runs this test
// automatically via CI=true; developers can opt in with RUN_MONGODB_INTEGRATION=1.
const enabled = process.env.CI === 'true' || process.env.RUN_MONGODB_INTEGRATION === '1';

test('MongoDB issue lifecycle, ownership, active-case uniqueness and concurrent submissions', {
  skip: !enabled && 'Set RUN_MONGODB_INTEGRATION=1 to run the disposable MongoDB integration test.',
}, async () => {
  const mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  let server;
  const databaseName = 'pizza_house_issue_integration';
  const mongoUri = mongo.getUri(databaseName);

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
    await Promise.all([User.syncIndexes(), Order.syncIndexes(), OrderIssue.syncIndexes()]);

    const [customer, otherCustomer, admin] = await User.create([
      { name: 'Customer One', email: 'one@example.test', passwordHash: 'integration-test-hash-one', role: 'user', emailVerifiedAt: new Date(), sessionVersion: 0 },
      { name: 'Customer Two', email: 'two@example.test', passwordHash: 'integration-test-hash-two', role: 'user', emailVerifiedAt: new Date(), sessionVersion: 0 },
      { name: 'Admin One', email: 'admin@example.test', passwordHash: 'integration-test-hash-admin', role: 'admin', emailVerifiedAt: new Date(), sessionVersion: 0 },
    ]);

    const makeOrder = (user, orderNumber, overrides = {}) => Order.create({
      orderNumber,
      user: user._id,
      items: [{
        name: 'Margherita Classic', quantity: 1, unitPrice: 249, lineTotal: 249,
        ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['tomato'] },
        inventoryKeys: ['base:classic'],
      }],
      subtotal: 249, deliveryFee: 29, total: 278,
      status: 'delivered', paymentStatus: 'paid', paymentReviewRequired: false, refundStatus: 'none',
      ...overrides,
    });

    const tokenFor = (user) => jwt.sign(
      { sub: user.id, role: user.role, sv: user.sessionVersion || 0 },
      config.jwtSecret,
      { expiresIn: '1h', issuer: 'pizza-house-api', audience: 'pizza-house-client' },
    );
    const cookieFor = (user) => `pizza_session=${tokenFor(user)}`;

    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = (path, { method = 'GET', user = customer, body } = {}) => fetch(`${origin}${path}`, {
      method,
      headers: {
        cookie: cookieFor(user),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const firstOrder = await makeOrder(customer, 'PH-DB-0001');
    let response = await request('/api/issues', {
      method: 'POST',
      body: { orderId: String(firstOrder._id), category: 'missing_item', description: 'The side item was missing from the delivery.' },
    });
    assert.equal(response.status, 201, await response.clone().text());
    let payload = await response.json();
    const firstIssueId = payload.issue.id;
    const firstReference = payload.issue.reference;
    assert.match(firstReference, /^PH-ISS-[A-F0-9]+$/);

    response = await request('/api/issues/my');
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.issues.length, 1);
    assert.equal(payload.issues[0].reference, firstReference);

    response = await request('/api/issues', {
      method: 'POST',
      body: { orderId: String(firstOrder._id), category: 'wrong_item', description: 'A second active case should be rejected.' },
    });
    assert.equal(response.status, 409);

    response = await request('/api/issues', {
      method: 'POST', user: otherCustomer,
      body: { orderId: String(firstOrder._id), category: 'missing_item', description: 'Trying to report another customer order.' },
    });
    assert.equal(response.status, 404);

    response = await request('/api/admin/issues', { user: customer });
    assert.equal(response.status, 403);
    response = await request('/api/admin/issues', { user: admin });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.issues.length, 1);
    assert.equal(payload.issues[0].user.email, customer.email);

    response = await request(`/api/admin/issues/${firstIssueId}`, {
      method: 'PATCH', user: admin,
      body: { status: 'under_review', customerUpdate: 'We are reviewing your report and will follow up.' },
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.issue.status, 'under_review');

    response = await request('/api/issues/my');
    payload = await response.json();
    assert.equal(payload.issues[0].customerUpdate, 'We are reviewing your report and will follow up.');

    response = await request(`/api/admin/issues/${firstIssueId}`, {
      method: 'PATCH', user: admin,
      body: { status: 'resolved', customerUpdate: 'The support case has been reviewed.' },
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.issue.active, false);
    assert.ok(payload.issue.resolvedAt);

    response = await request('/api/issues', {
      method: 'POST',
      body: { orderId: String(firstOrder._id), category: 'quality_issue', description: 'A separate issue after the first case was resolved.' },
    });
    assert.equal(response.status, 201, await response.clone().text());

    const raceOrder = await makeOrder(customer, 'PH-DB-0002');
    const concurrentResponses = await Promise.all([
      request('/api/issues', { method: 'POST', body: { orderId: String(raceOrder._id), category: 'delivery_delay', description: 'Parallel request one with a delivery delay.' } }),
      request('/api/issues', { method: 'POST', body: { orderId: String(raceOrder._id), category: 'delivery_delay', description: 'Parallel request two with a delivery delay.' } }),
    ]);
    const concurrentPayloads = await Promise.all(concurrentResponses.map(async (item) => ({ status: item.status, body: await item.json() })));
    assert.deepEqual(concurrentPayloads.map((item) => item.status).sort((a, b) => a - b), [201, 409]);
    assert.equal(await OrderIssue.countDocuments({ order: raceOrder._id, user: customer._id, active: true }), 1);

    // Confirm the guarantee comes from the actual partial unique index as well,
    // not only the controller's pre-insert check.
    const directRaceOrder = await makeOrder(customer, 'PH-DB-0003');
    const directRace = await Promise.allSettled([
      OrderIssue.create({ reference: 'PH-ISS-DBRACE1', order: directRaceOrder._id, user: customer._id, category: 'other', description: 'Direct index race request one.', active: true }),
      OrderIssue.create({ reference: 'PH-ISS-DBRACE2', order: directRaceOrder._id, user: customer._id, category: 'other', description: 'Direct index race request two.', active: true }),
    ]);
    assert.equal(directRace.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(directRace.filter((item) => item.status === 'rejected' && item.reason?.code === 11000).length, 1);

    const indexes = await OrderIssue.collection.indexes();
    assert.ok(indexes.some((index) => index.name === 'one_active_issue_per_order' && index.unique === true && index.partialFilterExpression?.active === true));

    // Reconnect to the same temporary DB to prove case history is stored in MongoDB.
    await mongoose.disconnect();
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
    assert.equal(await OrderIssue.countDocuments({ order: firstOrder._id, user: customer._id }), 2);
    assert.equal(await OrderIssue.countDocuments({ order: raceOrder._id, user: customer._id, active: true }), 1);
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongo.stop();
  }
});
