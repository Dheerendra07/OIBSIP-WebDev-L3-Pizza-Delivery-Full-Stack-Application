import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRazorpayTestCredentials, inspectRazorpayPreflightEnvironment } from '../scripts/razorpay-test-preflight-core.js';

const validEnv = () => ({
  NODE_ENV: 'development',
  RAZORPAY_KEY_ID: 'rzp_test_example_key',
  RAZORPAY_KEY_SECRET: 'example-test-key-secret-not-real',
  RAZORPAY_WEBHOOK_SECRET: 'separate-example-webhook-secret-not-real',
});

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return body; },
});

test('preflight validates Test Mode configuration without returning credential values', () => {
  const env = validEnv();
  const result = inspectRazorpayPreflightEnvironment(env);
  assert.equal(result.every(check => check.ok), true);
  const output = JSON.stringify(result);
  assert.equal(output.includes(env.RAZORPAY_KEY_ID), false);
  assert.equal(output.includes(env.RAZORPAY_KEY_SECRET), false);
  assert.equal(output.includes(env.RAZORPAY_WEBHOOK_SECRET), false);
});

test('preflight refuses production, live keys, missing secrets and reused webhook secret', async () => {
  const cases = [
    { ...validEnv(), NODE_ENV: 'production' },
    { ...validEnv(), RAZORPAY_KEY_ID: 'rzp_live_example_key' },
    { ...validEnv(), RAZORPAY_KEY_SECRET: '' },
    { ...validEnv(), RAZORPAY_WEBHOOK_SECRET: '' },
    { ...validEnv(), RAZORPAY_WEBHOOK_SECRET: validEnv().RAZORPAY_KEY_SECRET },
  ];

  for (const env of cases) {
    let networkCalled = false;
    const result = await checkRazorpayTestCredentials({
      env,
      fetchImpl: async () => {
        networkCalled = true;
        return response(200, { items: [] });
      },
    });
    assert.equal(result.ok, false);
    assert.equal(networkCalled, false, 'invalid configuration must block before network access');
  }
});

test('preflight performs only a read-only authenticated GET and discards provider data', async () => {
  const env = validEnv();
  let request;
  const result = await checkRazorpayTestCredentials({
    env,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response(200, { entity: 'collection', items: [{ id: 'order_PRIVATE_TEST_DATA' }] });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(request.url, 'https://api.razorpay.com/v1/orders?count=1');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Accept, 'application/json');
  assert.equal(request.options.headers.Authorization, `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`);
  assert.equal(JSON.stringify(result).includes('order_PRIVATE_TEST_DATA'), false);
  assert.equal(JSON.stringify(result).includes(env.RAZORPAY_KEY_SECRET), false);
});

test('provider authentication failures reveal only the HTTP status, not response data', async () => {
  const result = await checkRazorpayTestCredentials({
    env: validEnv(),
    fetchImpl: async () => response(400, { error: { description: 'private provider response text' } }),
  });
  assert.equal(result.ok, false);
  const output = JSON.stringify(result);
  assert.match(output, /HTTP 400/);
  assert.equal(output.includes('private provider response text'), false);
});

test('network errors do not leak provider exception text', async () => {
  const result = await checkRazorpayTestCredentials({
    env: validEnv(),
    fetchImpl: async () => { throw new Error('private secret and host details'); },
  });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('private secret and host details'), false);
});
