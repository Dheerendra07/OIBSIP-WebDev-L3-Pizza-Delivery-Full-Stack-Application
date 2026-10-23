import test from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../src/middleware/errors.js';

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('production 5xx logs omit raw exception text and tokenized URL paths', () => {
  const priorNodeEnv = process.env.NODE_ENV;
  const originalConsoleError = console.error;
  const emitted = [];
  const privateErrorText = 'provider response contains private-secret-value';
  const privatePathToken = 'email-reset-token-should-never-be-logged';

  process.env.NODE_ENV = 'production';
  console.error = (...args) => emitted.push(args);
  try {
    const error = Object.assign(new Error(privateErrorText), {
      statusCode: 500,
      code: 'UPSTREAM_ERROR',
    });
    const req = {
      method: 'POST',
      baseUrl: '/api/auth',
      path: `/api/auth/reset-password/${privatePathToken}`,
      route: { path: '/reset-password/:token' },
    };
    const res = responseRecorder();

    errorHandler(error, req, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'An unexpected server error occurred' });
    const serializedLogs = JSON.stringify(emitted);
    assert.equal(serializedLogs.includes(privateErrorText), false);
    assert.equal(serializedLogs.includes(privatePathToken), false);
    assert.equal(serializedLogs.includes('/api/auth/reset-password/'), false);
    assert.equal(serializedLogs.includes('/api/auth/reset-password/:token'), true);
    assert.equal(serializedLogs.includes('UPSTREAM_ERROR'), true);
    assert.equal(serializedLogs.includes('500'), true);
  } finally {
    console.error = originalConsoleError;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
  }
});

test('production may expose only explicitly approved short safe 5xx messages', () => {
  const priorNodeEnv = process.env.NODE_ENV;
  const originalConsoleError = console.error;
  process.env.NODE_ENV = 'production';
  console.error = () => {};
  try {
    const res = responseRecorder();
    errorHandler(
      Object.assign(new Error('No payment was started; retry safely.'), {
        statusCode: 502,
        safeToExpose: true,
      }),
      { method: 'POST', baseUrl: '/api/payments', route: { path: '/create-order' }, path: '/api/payments/create-order' },
      res,
      () => {},
    );
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { error: 'No payment was started; retry safely.' });
  } finally {
    console.error = originalConsoleError;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
  }
});
