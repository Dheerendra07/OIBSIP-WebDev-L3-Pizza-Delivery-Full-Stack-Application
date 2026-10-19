import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv } from '../src/utils/envValidation.js';
const productionEnv = () => ({ NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://example.invalid/app', JWT_SECRET: 'a'.repeat(48), CLIENT_ORIGIN: 'https://pizza.example.com', CLIENT_BASE_URL: 'https://pizza.example.com', APP_BASE_URL: 'https://api.example.com', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'mailer', SMTP_PASS: 'secret', MAIL_FROM: 'Pizza House <orders@example.com>', RAZORPAY_KEY_ID: 'rzp_test_example', RAZORPAY_KEY_SECRET: 'test_secret', ADMIN_ALERT_EMAIL: 'admin@example.com' });
test('accepts a complete production config with HTTPS URLs and Razorpay test keys', () => assert.doesNotThrow(() => validateEnv(productionEnv())));
test('rejects an insecure frontend or API URL in production', () => { const env = productionEnv(); env.APP_BASE_URL = 'http://api.example.com'; assert.throws(() => validateEnv(env), /APP_BASE_URL must be a valid HTTPS origin/); });
test('rejects Razorpay live-mode credentials for this test-mode project', () => { const env = productionEnv(); env.RAZORPAY_KEY_ID = 'rzp_live_example'; assert.throws(() => validateEnv(env), /must start with rzp_test_/); });
test('requires a real MAIL_FROM sender in production', () => { const env = productionEnv(); env.MAIL_FROM = ''; assert.throws(() => validateEnv(env), /MAIL_FROM/); });
test('rejects unsupported cookie SameSite settings', () => assert.throws(() => validateEnv({ COOKIE_SAME_SITE: 'sometimes' }), /COOKIE_SAME_SITE must be strict, lax, or none/));
test('rejects cross-site cookies in non-production HTTP development', () => assert.throws(() => validateEnv({ NODE_ENV: 'development', COOKIE_SAME_SITE: 'none' }), /requires production HTTPS/));
test('rejects live Razorpay credentials even in development', () => assert.throws(() => validateEnv({ NODE_ENV: 'development', RAZORPAY_KEY_ID: 'rzp_live_example' }), /must start with rzp_test_/));


test('rejects wildcard and path-based CORS origins in production', () => {
  const env = productionEnv(); env.CLIENT_ORIGIN = '*';
  assert.throws(() => validateEnv(env), /exact HTTPS origin/);
  env.CLIENT_ORIGIN = 'https://pizza.example.com/menu';
  assert.throws(() => validateEnv(env), /exact HTTPS origin/);
});

test('accepts a comma-separated allowlist of exact HTTPS frontend origins', () => {
  const env = productionEnv(); env.CLIENT_ORIGIN = 'https://pizza.example.com,https://www.pizza.example.com';
  assert.doesNotThrow(() => validateEnv(env));
});

test('rejects application base URLs with a path or query in production', () => {
  const env = productionEnv(); env.CLIENT_BASE_URL = 'https://pizza.example.com/app';
  assert.throws(() => validateEnv(env), /CLIENT_BASE_URL must be a valid HTTPS origin/);
  env.CLIENT_BASE_URL = 'https://pizza.example.com?redirect=1';
  assert.throws(() => validateEnv(env), /CLIENT_BASE_URL must be a valid HTTPS origin/);
});
