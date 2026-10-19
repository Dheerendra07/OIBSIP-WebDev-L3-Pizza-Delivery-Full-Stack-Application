import test from 'node:test';
import assert from 'node:assert/strict';
import { register, login, adminLogin, resetPassword } from '../src/controllers/authController.js';

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('registration returns a client error for a missing or non-object body', async () => {
  for (const body of [undefined, null, [], 'invalid']) {
    const res = responseRecorder();
    let nextError;
    await register({ body }, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: 'Name must be between 2 and 80 characters' });
  }
});

test('customer and admin login return a client error when credentials are absent', async () => {
  for (const handler of [login, adminLogin]) {
    const res = responseRecorder();
    let nextError;
    await handler({ body: undefined }, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: 'Enter valid sign-in details' });
  }
});

test('password reset rejects missing request bodies before looking up a token', async () => {
  const res = responseRecorder();
  let nextError;
  await resetPassword({ body: undefined, params: { token: 'unused-test-token' } }, res, (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'Password must be 10–72 characters with uppercase, lowercase and a number' });
});
