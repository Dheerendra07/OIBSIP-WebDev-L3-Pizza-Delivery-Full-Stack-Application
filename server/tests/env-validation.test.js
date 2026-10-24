import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv } from '../src/utils/envValidation.js';
const productionEnv = () => ({ NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://example.invalid/app', JWT_SECRET: 'a'.repeat(48), CLIENT_ORIGIN: 'https://pizza.example.com', CLIENT_BASE_URL: 'https://pizza.example.com', APP_BASE_URL: 'https://api.example.com', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'mailer', SMTP_PASS: 'secret', MAIL_FROM: 'Pizza House <orders@example.com>', ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'SecureAdminPass123', RAZORPAY_KEY_ID: 'rzp_test_example', RAZORPAY_KEY_SECRET: 'test_secret', RAZORPAY_WEBHOOK_SECRET: 'webhook-secret', ADMIN_ALERT_EMAIL: 'admin@example.com' });
test('accepts a complete production config with HTTPS URLs, Razorpay test keys and webhook secret', () => assert.doesNotThrow(() => validateEnv(productionEnv())));
test('requires the Razorpay webhook secret in production', () => { const env = productionEnv(); env.RAZORPAY_WEBHOOK_SECRET = ''; assert.throws(() => validateEnv(env), /RAZORPAY_WEBHOOK_SECRET/); });
test('rejects an insecure frontend or API URL in production', () => { const env = productionEnv(); env.APP_BASE_URL = 'http://api.example.com'; assert.throws(() => validateEnv(env), /APP_BASE_URL must be a valid HTTPS origin/); });
test('rejects live credentials unless Live Mode is explicitly selected', () => { const env = productionEnv(); env.RAZORPAY_KEY_ID = 'rzp_live_example'; assert.throws(() => validateEnv(env), /must start with rzp_test_/); });
test('allows explicit Live Mode only in production with live keys and an allowlisted delivery area', () => { const env = productionEnv(); env.PAYMENT_MODE = 'live'; env.RAZORPAY_KEY_ID = 'rzp_live_example'; env.DELIVERY_PIN_CODES = '250001,250002'; assert.doesNotThrow(() => validateEnv(env)); });
test('Live Mode requires delivery PIN codes and valid supported PIN formats', () => { const env = productionEnv(); env.PAYMENT_MODE = 'live'; env.RAZORPAY_KEY_ID = 'rzp_live_example'; assert.throws(() => validateEnv(env), /DELIVERY_PIN_CODES/); env.DELIVERY_PIN_CODES = '25ABCD'; assert.throws(() => validateEnv(env), /DELIVERY_PIN_CODES/); });
test('Live Mode cannot be enabled in development or staging', () => assert.throws(() => validateEnv({ NODE_ENV: 'development', PAYMENT_MODE: 'live', RAZORPAY_KEY_ID: 'rzp_live_example' }), /only allowed in production/));
test('Razorpay webhook secret must be separate from the API key secret', () => { const env = productionEnv(); env.RAZORPAY_WEBHOOK_SECRET = env.RAZORPAY_KEY_SECRET; assert.throws(() => validateEnv(env), /different from RAZORPAY_KEY_SECRET/); });
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

test('requires valid production admin credentials for automatic bootstrap', () => {
  const missingEmail = productionEnv();
  missingEmail.ADMIN_EMAIL = '';
  assert.throws(() => validateEnv(missingEmail), /ADMIN_EMAIL/);

  const invalidEmail = productionEnv();
  invalidEmail.ADMIN_EMAIL = 'not-an-email';
  assert.throws(() => validateEnv(invalidEmail), /ADMIN_EMAIL must be a valid email address/);

  const weakPassword = productionEnv();
  weakPassword.ADMIN_PASSWORD = 'weak';
  assert.throws(() => validateEnv(weakPassword), /ADMIN_PASSWORD must be 10–72 characters/);
});
