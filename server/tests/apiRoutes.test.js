import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

// Keep this route smoke test isolated from production settings and databases.
process.env.NODE_ENV = 'test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'unit-test-only-webhook-secret';

const { default: app } = await import('../src/app.js');

let server;
let baseUrl;

before(async () => {
  server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('API root returns service information instead of Route not found', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'pizza-house-api');
  assert.equal(body.health, '/api/health');
  assert.equal(typeof body.website, 'string');
});

test('payment provider diagnostic rejects visitors without an admin session', async () => {
  const response = await fetch(`${baseUrl}/api/admin/payment-provider-check`);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, 'Sign in to continue');
});

test('API base path returns a helpful JSON response', async () => {
  const response = await fetch(`${baseUrl}/api`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'pizza-house-api');
  assert.equal(body.health, '/api/health');
});

test('health endpoint reports degraded when MongoDB is disconnected', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.service, 'pizza-house-api');
  assert.deepEqual(body.dependencies, { database: 'unavailable' });
  assert.equal(Number.isNaN(Date.parse(body.timestamp)), false);
});

test('frontend origin is allowed for credentialed CORS requests', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('opening the webhook endpoint in a browser explains that POST is required', async () => {
  const response = await fetch(`${baseUrl}/api/payments/webhook`);
  assert.equal(response.status, 405);
  const body = await response.json();
  assert.match(body.error, /POST requests only/i);
});

test('Razorpay webhook route rejects an invalid signature without processing it', async () => {
  const response = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': 'invalid-signature',
      'X-Razorpay-Event-Id': 'unit-test-invalid-signature',
    },
    body: JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: {} } } }),
  });
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, 'Invalid webhook signature');
});
