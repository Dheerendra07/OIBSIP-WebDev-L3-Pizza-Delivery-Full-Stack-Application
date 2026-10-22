import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import app from '../src/app.js';

async function startAppServer() {
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine test server address');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

test('Express trusts the single Render proxy used for forwarded client IPs', () => {
  assert.equal(app.get('trust proxy'), 1);
});

test('customer issue and admin issue queue endpoints require authentication', async (t) => {
  const { server, origin } = await startAppServer();
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const requests = [
    fetch(`${origin}/api/issues/my`),
    fetch(`${origin}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: '64b000000000000000000001',
        category: 'missing_item',
        description: 'A required item was missing from this order.',
      }),
    }),
    fetch(`${origin}/api/admin/issues`),
    fetch(`${origin}/api/admin/issues/64b000000000000000000001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    }),
  ];

  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401]);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  assert.ok(payloads.every((payload) => payload.error === 'Sign in to continue'));
});

test('HTTP app reports disconnected health and structured not-found responses with security headers', async (t) => {
  const { server, origin } = await startAppServer();
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 503);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  const payload = await health.json();
  assert.equal(payload.status, 'degraded');
  assert.equal(payload.service, 'pizza-house-api');
  assert.deepEqual(payload.dependencies, { database: 'unavailable' });
  assert.equal(typeof payload.timestamp, 'string');
  assert.ok(Number.isFinite(Date.parse(payload.timestamp)));

  const missing = await fetch(`${origin}/api/not-a-real-route`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Route not found: GET /api/not-a-real-route' });
});
