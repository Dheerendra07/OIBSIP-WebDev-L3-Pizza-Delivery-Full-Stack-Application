import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const ENV_KEYS = [
  'NODE_ENV', 'MONGODB_URI', 'JWT_SECRET', 'CLIENT_ORIGIN', 'CLIENT_BASE_URL',
  'APP_BASE_URL', 'REQUIRE_EMAIL_VERIFICATION', 'RESEND_API_KEY', 'MAIL_FROM',
  'PAYMENT_MODE', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
];

test('email verification can be resent safely over HTTP; stale links stop working', async (t) => {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let server;
  const sentEmails = [];

  for (const [key, value] of Object.entries({
    NODE_ENV: 'test',
    MONGODB_URI: mongo.getUri('pizza_house_email_verification'),
    JWT_SECRET: 'test-only-jwt-secret-with-enough-entropy-1234567890',
    CLIENT_ORIGIN: 'http://127.0.0.1:5173',
    CLIENT_BASE_URL: 'http://127.0.0.1:5173',
    APP_BASE_URL: 'http://127.0.0.1:4000',
    REQUIRE_EMAIL_VERIFICATION: 'true',
    RESEND_API_KEY: 're_test_email_verification',
    MAIL_FROM: 'Pizza House <orders@example.test>',
    PAYMENT_MODE: 'test',
    RAZORPAY_KEY_ID: 'rzp_test_email_verification',
    RAZORPAY_KEY_SECRET: 'test-only-razorpay-key-secret',
    RAZORPAY_WEBHOOK_SECRET: 'test-only-webhook-secret',
  })) process.env[key] = value;

  globalThis.fetch = async (input, options = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (url === 'https://api.resend.com/emails') {
      sentEmails.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: `email_test_verification_${sentEmails.length}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(input, options);
  };

  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect().catch(() => {});
    await mongo.stop();
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  const { default: app } = await import('../src/app.js');
  await mongoose.connect(process.env.MONGODB_URI);
  const { default: User } = await import('../src/models/User.js');
  await User.init();

  server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: process.env.CLIENT_ORIGIN, 'Content-Type': 'application/json' };
  const email = 'verification-flow@example.test';
  const password = 'StrongPassword123';

  const unknown = await fetch(`${base}/api/auth/resend-verification`, {
    method: 'POST', headers, body: JSON.stringify({ email: 'unknown@example.test' }),
  });
  assert.equal(unknown.status, 200);
  const genericMessage = (await unknown.json()).message;
  assert.equal(sentEmails.length, 0, 'unknown addresses must not trigger email');
  
  const registration = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Verification Test', email, password }),
  });
  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).emailVerificationRequired, true);
  assert.equal(sentEmails.length, 1);
  assert.deepEqual(sentEmails[0].to, [email]);

  const extractToken = (message) => {
    const match = String(message).match(/\/api\/auth\/verify-email\/([a-f0-9]{64})/i);
    assert.ok(match, 'verification email must contain a tokenized verification URL');
    return match[1];
  };
  const firstToken = extractToken(sentEmails[0].text);

  const blockedLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers, body: JSON.stringify({ email, password }),
  });
  assert.equal(blockedLogin.status, 403, 'unverified accounts cannot create sessions');

  const resend = await fetch(`${base}/api/auth/resend-verification`, {
    method: 'POST', headers, body: JSON.stringify({ email: email.toUpperCase() }),
  });
  assert.equal(resend.status, 200, `resend endpoint response: ${await resend.clone().text()}`);
  assert.equal((await resend.json()).message, genericMessage, 'resend responses are generic');
  assert.equal(sentEmails.length, 2);
  const secondToken = extractToken(sentEmails[1].text);
  assert.notEqual(secondToken, firstToken, 'resend must rotate the one-time verification token');

  const staleLink = await fetch(`${base}/api/auth/verify-email/${firstToken}`, { headers, redirect: 'manual' });
  assert.equal(staleLink.status, 400, 'the previous link must be invalid after a resend');

  const validLink = await fetch(`${base}/api/auth/verify-email/${secondToken}`, { headers, redirect: 'manual' });
  assert.equal(validLink.status, 302);
  assert.equal(validLink.headers.get('location'), `${process.env.CLIENT_BASE_URL}/?verified=1`);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers, body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, 'the customer can sign in after verification');
  assert.equal((await login.json()).user.email, email);

  const verifiedResend = await fetch(`${base}/api/auth/resend-verification`, {
    method: 'POST', headers, body: JSON.stringify({ email }),
  });
  assert.equal(verifiedResend.status, 200);
  assert.equal((await verifiedResend.json()).message, genericMessage);
  assert.equal(sentEmails.length, 2, 'verified accounts must not receive new verification mail');
});
