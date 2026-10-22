import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

test('production auth HTTP flow: signup, login cookie, current user, protected orders and logout', async (t) => {
  const mongod = await MongoMemoryServer.create();
  const webOrigin = 'https://pizza-house-web-n75h.onrender.com';
  const apiOrigin = 'https://pizza-house-api.onrender.com';
  const env = {
    NODE_ENV: 'production',
    MONGODB_URI: mongod.getUri('pizza_house_auth_e2e'),
    JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    JWT_EXPIRES_IN: '1d',
    CLIENT_ORIGIN: webOrigin,
    CLIENT_BASE_URL: webOrigin,
    APP_BASE_URL: apiOrigin,
    COOKIE_SAME_SITE: 'none',
    REQUIRE_EMAIL_VERIFICATION: 'false',
    MAIL_FROM: 'Pizza House <noreply@example.com>',
    RESEND_API_KEY: 'test-only-not-used',
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'StrongAdminPass123',
    ADMIN_ALERT_EMAIL: 'alerts@example.com',
    RAZORPAY_KEY_ID: 'rzp_test_auth_e2e',
    RAZORPAY_KEY_SECRET: 'test-only-not-used',
    RAZORPAY_WEBHOOK_SECRET: 'test-only-not-used',
  };
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  let server;
  t.after(async () => {
    if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.disconnect().catch(() => {});
    await mongod.stop();
  });

  // Import only after assigning test-only production settings so the real app
  // builds the exact Secure + SameSite=None cookie expected on Render.
  const { default: app } = await import('../src/app.js');
  await mongoose.connect(env.MONGODB_URI);
  server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: webOrigin, 'Content-Type': 'application/json' };

  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Automated Auth Test',
      email: 'auth-flow@example.com',
      password: 'StrongPassword123',
    }),
  });
  assert.equal(register.status, 201, 'signup should not depend on SMTP when verification is disabled');
  const registerBody = await register.json();
  assert.equal(registerBody.emailVerificationRequired, false);
  assert.match(registerBody.message, /You can now sign in/);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'AUTH-FLOW@example.com', password: 'StrongPassword123' }),
  });
  assert.equal(login.status, 200, 'new account should be able to log in immediately');
  const loginBody = await login.json();
  assert.equal(loginBody.user.email, 'auth-flow@example.com');
  assert.equal(loginBody.user.role, 'user');
  assert.equal(login.headers.get('access-control-allow-origin'), webOrigin);
  assert.equal(login.headers.get('access-control-allow-credentials'), 'true');

  const setCookies = typeof login.headers.getSetCookie === 'function'
    ? login.headers.getSetCookie()
    : [login.headers.get('set-cookie')].filter(Boolean);
  const sessionCookie = setCookies.find((value) => value.startsWith('pizza_session='));
  assert.ok(sessionCookie, 'login should issue the pizza_session cookie');
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /Secure/i);
  assert.match(sessionCookie, /SameSite=None/i);
  const cookie = sessionCookie.split(';', 1)[0];

  const me = await fetch(`${base}/api/auth/me`, { headers: { Origin: webOrigin, Cookie: cookie } });
  assert.equal(me.status, 200, 'session cookie should authenticate /me');
  assert.equal((await me.json()).user.email, 'auth-flow@example.com');

  const orders = await fetch(`${base}/api/orders/my`, { headers: { Origin: webOrigin, Cookie: cookie } });
  assert.equal(orders.status, 200, 'authenticated customer should load order history');
  assert.deepEqual((await orders.json()).orders, []);

  const logout = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: webOrigin, Cookie: cookie },
  });
  assert.equal(logout.status, 200);
  assert.equal(logout.headers.get('access-control-allow-credentials'), 'true');
  const clearedCookies = typeof logout.headers.getSetCookie === 'function'
    ? logout.headers.getSetCookie()
    : [logout.headers.get('set-cookie')].filter(Boolean);
  assert.ok(clearedCookies.some((value) => value.startsWith('pizza_session=')), 'logout should clear the session cookie');

  const afterLogout = await fetch(`${base}/api/auth/me`, { headers: { Origin: webOrigin, Cookie: cookie } });
  assert.equal(afterLogout.status, 401, 'cleared session must no longer authorize protected routes');
});
