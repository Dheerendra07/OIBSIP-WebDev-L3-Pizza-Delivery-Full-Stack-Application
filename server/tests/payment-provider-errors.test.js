import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRazorpayOrderCreationError } from '../src/utils/paymentProviderErrors.js';

test('provider HTTP 401 becomes a safe 502 credential diagnostic, not a customer-auth 401', () => {
  const mapped = mapRazorpayOrderCreationError({
    statusCode: 401,
    error: {
      code: 'BAD_REQUEST_ERROR',
      description: 'Authentication failed; private credential must not be logged',
    },
  });

  assert.equal(mapped.statusCode, 502);
  assert.equal(mapped.code, 'RAZORPAY_TEST_CREDENTIALS_REJECTED');
  assert.match(mapped.message, /matching Test Mode pair/);
  assert.match(mapped.message, /No payment was started/);
  assert.deepEqual(mapped.diagnostics, {
    upstreamStatus: 401,
    providerCode: 'BAD_REQUEST_ERROR',
  });
  assert.equal(JSON.stringify(mapped).includes('private credential'), false);
});

test('provider HTTP 403 receives the same safe credential diagnosis', () => {
  const mapped = mapRazorpayOrderCreationError({ status: 403, code: 'FORBIDDEN' });
  assert.equal(mapped.statusCode, 502);
  assert.equal(mapped.code, 'RAZORPAY_TEST_CREDENTIALS_REJECTED');
  assert.equal(mapped.diagnostics.upstreamStatus, 403);
});

test('other provider and network failures map to a generic 502 without raw provider text', () => {
  const cases = [
    { statusCode: 429, error: { code: 'RATE_LIMIT', description: 'sensitive upstream body' } },
    new Error('request host and credential details'),
    { statusCode: 500, code: 'UPSTREAM_FAILURE' },
  ];

  for (const error of cases) {
    const mapped = mapRazorpayOrderCreationError(error);
    assert.equal(mapped.statusCode, 502);
    assert.equal(mapped.code, 'RAZORPAY_ORDER_CREATION_FAILED');
    assert.match(mapped.message, /No payment was started/);
    assert.equal(JSON.stringify(mapped).includes('sensitive upstream body'), false);
    assert.equal(JSON.stringify(mapped).includes('credential details'), false);
  }
});

test('provider diagnostic codes are constrained to safe characters', () => {
  const mapped = mapRazorpayOrderCreationError({
    statusCode: 401,
    error: { code: 'BAD\nPRIVATE-DATA' },
  });
  assert.equal(mapped.diagnostics.providerCode, null);
});
