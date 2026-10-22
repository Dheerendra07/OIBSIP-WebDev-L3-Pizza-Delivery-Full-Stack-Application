import test from 'node:test';
import assert from 'node:assert/strict';
import { register, login, adminLogin, forgotPassword, resetPassword } from '../src/controllers/authController.js';
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


test('password-reset delivery failures use the generic response and invalidate the token', async () => {
  const originalFindOne = User.findOne;
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const previousResendKey = process.env.RESEND_API_KEY;
  const previousMailFrom = process.env.MAIL_FROM;
  const logs = [];
  const saveSnapshots = [];
  const user = {
    passwordResetTokenHash: null,
    passwordResetExpiresAt: null,
    async save() {
      saveSnapshots.push({
        passwordResetTokenHash: this.passwordResetTokenHash,
        passwordResetExpiresAt: this.passwordResetExpiresAt,
      });
    },
  };

  process.env.RESEND_API_KEY = 're_test_example';
  process.env.MAIL_FROM = 'Pizza House <orders@example.test>';
  User.findOne = async () => user;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ message: 'sender domain is not verified' }),
    { status: 422, headers: { 'content-type': 'application/json' } },
  );
  console.error = (...args) => logs.push(args);

  try {
    const res = responseRecorder();
    let nextError;
    await forgotPassword({ body: { email: 'registered@example.test' } }, res, (error) => { nextError = error; });

    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      message: 'If an account exists for this email, reset instructions will be sent.',
    });
    assert.equal(saveSnapshots.length, 2, 'reset token should be created then invalidated');
    assert.ok(saveSnapshots[0].passwordResetTokenHash);
    assert.ok(saveSnapshots[0].passwordResetExpiresAt instanceof Date);
    assert.equal(saveSnapshots[1].passwordResetTokenHash, null);
    assert.equal(saveSnapshots[1].passwordResetExpiresAt, null);
    assert.equal(logs.length, 1, 'provider failure should be recorded without exposing account details');
    assert.doesNotMatch(JSON.stringify(logs), /registered@example\.test|sender domain is not verified/i);
  } finally {
    User.findOne = originalFindOne;
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResendKey;
    if (previousMailFrom === undefined) delete process.env.MAIL_FROM;
    else process.env.MAIL_FROM = previousMailFrom;
  }
});

test('password-reset database lookup failures use the generic response', async () => {
  const originalFindOne = User.findOne;
  const originalConsoleError = console.error;
  const logs = [];
  User.findOne = async () => {
    throw new Error('mongodb://private-connection-details');
  };
  console.error = (...args) => logs.push(args);

  try {
    const res = responseRecorder();
    let nextError;
    await forgotPassword({ body: { email: 'registered@example.test' } }, res, (error) => { nextError = error; });

    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      message: 'If an account exists for this email, reset instructions will be sent.',
    });
    assert.equal(logs.length, 1);
    assert.doesNotMatch(JSON.stringify(logs), /private-connection-details|registered@example\.test/i);
  } finally {
    User.findOne = originalFindOne;
    console.error = originalConsoleError;
  }
});

test('password-reset token persistence failures use the generic response and attempt token cleanup', async () => {
  const originalFindOne = User.findOne;
  const originalConsoleError = console.error;
  const logs = [];
  let saveCalls = 0;
  const user = {
    passwordResetTokenHash: null,
    passwordResetExpiresAt: null,
    async save() {
      saveCalls += 1;
      if (saveCalls === 1) throw new Error('mongodb://private-connection-details');
    },
  };

  User.findOne = async () => user;
  console.error = (...args) => logs.push(args);

  try {
    const res = responseRecorder();
    let nextError;
    await forgotPassword({ body: { email: 'registered@example.test' } }, res, (error) => { nextError = error; });

    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      message: 'If an account exists for this email, reset instructions will be sent.',
    });
    assert.equal(saveCalls, 2, 'the handler should attempt to invalidate a possibly persisted token');
    assert.equal(user.passwordResetTokenHash, null);
    assert.equal(user.passwordResetExpiresAt, null);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(JSON.stringify(logs), /private-connection-details|registered@example\.test/i);
  } finally {
    User.findOne = originalFindOne;
    console.error = originalConsoleError;
  }
});

