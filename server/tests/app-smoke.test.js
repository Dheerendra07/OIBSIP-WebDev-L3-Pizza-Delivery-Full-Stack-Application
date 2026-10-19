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

test('HTTP app exposes health and structured not-found responses with security headers', async (t) => {
  const { server, origin } = await startAppServer();
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await health.json(), {
    status: 'ok',
    service: 'pizza-house-api',
    timestamp: assert.match.string,
  });
});
