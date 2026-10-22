import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { getReadiness } from '../src/utils/healthStatus.js';

test('readiness requires an established MongoDB connection', () => {
  assert.deepEqual(getReadiness(1), {
    httpStatus: 200,
    status: 'ok',
    dependencies: { database: 'connected' },
  });

  for (const state of [0, 2, 3, 99]) {
    assert.deepEqual(getReadiness(state), {
      httpStatus: 503,
      status: 'degraded',
      dependencies: { database: 'unavailable' },
    });
  }
});

test('GET /api/health returns 503 without a database connection and disables caching', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_health';
  process.env.COOKIE_SAME_SITE = 'strict';
  process.env.RENDER_GIT_COMMIT = 'test-health-commit';

  const { default: mongoose } = await import('mongoose');
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  const { default: app } = await import('../src/app.js');

  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    if (server.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.status, 'degraded');
  assert.equal(body.service, 'pizza-house-api');
  assert.equal(body.version, 'test-health-commit');
  assert.deepEqual(body.dependencies, { database: 'unavailable' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
