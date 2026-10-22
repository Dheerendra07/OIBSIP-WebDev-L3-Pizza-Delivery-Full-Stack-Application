import test from 'node:test';
import assert from 'node:assert/strict';
import { register, login, adminLogin, resetPassword } from '../src/controllers/authController.js';
import User from '../src/models/User.js';
import { config } from '../src/config/env.js';

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    cookie(name, value, options) { this.cookieIssued = { name, value, options }; return this; },
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

test('registration remains usable without an SMTP verification dependency when verification is disabled', async (t) => {
  if (config.requireEmailVerification) {
    t.skip('This deployment explicitly requires email verification.');
    return;
  }

  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  let lookupCount = 0;
  let createdUser;
  User.findOne = () => {
    lookupCount += 1;
    if (lookupCount === 1) return Promise.resolve(null);
    return { select: async () => createdUser };
  };
  User.create = async (values) => {
    createdUser = { ...values, id: 'test-user-id', role: 'user', sessionVersion: 0 };
    return createdUser;
  };

  try {
    const signupRes = responseRecorder();
    let signupError;
    await register({
      body: { name: 'Test Customer', email: 'auth-flow@example.com', password: 'StrongPass123' },
    }, signupRes, (error) => { signupError = error; });

    assert.equal(signupError, undefined);
    assert.equal(signupRes.statusCode, 201);
    assert.equal(signupRes.payload.emailVerificationRequired, false);
    assert.match(signupRes.payload.message, /You can now sign in/);
    assert.ok(createdUser.emailVerifiedAt instanceof Date);
    assert.equal(createdUser.emailVerificationTokenHash, null);

    const loginRes = responseRecorder();
    let loginError;
    await login({
      body: { email: 'AUTH-FLOW@example.com', password: 'StrongPass123' },
    }, loginRes, (error) => { loginError = error; });

    assert.equal(loginError, undefined);
    assert.equal(loginRes.statusCode, 200);
    assert.equal(loginRes.payload.user.email, 'auth-flow@example.com');
    assert.ok(loginRes.cookieIssued);
    assert.equal(loginRes.cookieIssued.name, 'pizza_session');
  } finally {
    User.findOne = originalFindOne;
    User.create = originalCreate;
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
