import test from 'node:test';
import assert from 'node:assert/strict';
import { isMailConfigured, isResendMailConfigured, isSmtpMailConfigured } from '../src/utils/emailConfig.js';
import { validateEnv } from '../src/utils/envValidation.js';
import { inspectQaEnvironment } from '../src/utils/qaPreflight.js';

const productionEnv = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://user:password@example.invalid/pizza',
  JWT_SECRET: 's'.repeat(48),
  CLIENT_ORIGIN: 'https://pizza-house-web-n75h.onrender.com',
  CLIENT_BASE_URL: 'https://pizza-house-web-n75h.onrender.com',
  APP_BASE_URL: 'https://pizza-house-api.onrender.com',
  MAIL_FROM: 'Pizza House <orders@example.test>',
  ADMIN_EMAIL: 'admin@example.test',
  ADMIN_PASSWORD: 'StrongPassword123',
  RAZORPAY_KEY_ID: 'rzp_test_example',
  RAZORPAY_KEY_SECRET: 'test-secret-value',
  RAZORPAY_WEBHOOK_SECRET: 'test-webhook-value',
  ADMIN_ALERT_EMAIL: 'admin@example.test',
};

test('recognizes Resend HTTP API credentials without SMTP', () => {
  const env = { RESEND_API_KEY: 're_test_example', MAIL_FROM: 'Pizza House <orders@example.test>' };
  assert.equal(isResendMailConfigured(env), true);
  assert.equal(isSmtpMailConfigured(env), false);
  assert.equal(isMailConfigured(env), true);
});

test('SMTP readiness requires credentials and an explicit sender identity', () => {
  const credentials = { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'user', SMTP_PASS: 'secret' };
  const env = { ...credentials, MAIL_FROM: 'Pizza House <orders@example.test>' };
  assert.equal(isSmtpMailConfigured(env), true);
  assert.equal(isResendMailConfigured(env), false);
  assert.equal(isMailConfigured(env), true);
  assert.equal(isSmtpMailConfigured(credentials), false);
  assert.equal(isMailConfigured(credentials), false);
  assert.equal(isMailConfigured({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'user', MAIL_FROM: env.MAIL_FROM }), false);
});
test('production configuration accepts Resend without SMTP fields', () => {
  assert.doesNotThrow(() => validateEnv({ ...productionEnv, RESEND_API_KEY: 're_test_example' }));
});

test('production configuration still accepts complete SMTP fallback', () => {
  assert.doesNotThrow(() => validateEnv({
    ...productionEnv,
    SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'user',
    SMTP_PASS: 'secret',
  }));
});

test('production configuration rejects missing email transport', () => {
  assert.throws(
    () => validateEnv({ ...productionEnv }),
    /Production email requires RESEND_API_KEY with MAIL_FROM, or SMTP_HOST, SMTP_USER and SMTP_PASS with MAIL_FROM/,
  );
});

test('QA preflight accepts Resend API config without SMTP credentials', () => {
  const result = inspectQaEnvironment({
    NODE_ENV: 'development',
    MONGODB_URI: 'mongodb+srv://user:password@example.invalid/pizza',
    JWT_SECRET: 's'.repeat(48),
    CLIENT_ORIGIN: 'http://localhost:5173',
    CLIENT_BASE_URL: 'http://localhost:5173',
    APP_BASE_URL: 'http://localhost:4000',
    ADMIN_EMAIL: 'admin@example.test',
    ADMIN_PASSWORD: 'Password12345',
    RESEND_API_KEY: 're_test_example',
    MAIL_FROM: 'Pizza House <orders@example.test>',
    ADMIN_ALERT_EMAIL: 'admin@example.test',
    RAZORPAY_KEY_ID: 'rzp_test_example',
    RAZORPAY_KEY_SECRET: 'test-secret-value',
    RAZORPAY_WEBHOOK_SECRET: 'test-webhook-value',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
  });
  const checks = result.sections.flatMap(section => section.checks);
  assert.equal(checks.find(check => check.label === 'Email provider credentials').ok, true);
  assert.equal(checks.find(check => check.label === 'Optional SMTP settings').ok, true);
  assert.equal(checks.find(check => check.label === 'MAIL_FROM').ok, true);
});

test('QA preflight blocks missing email provider credentials', () => {
  const result = inspectQaEnvironment({ NODE_ENV: 'development' });
  const check = result.sections.flatMap(section => section.checks)
    .find(item => item.label === 'Email provider credentials');
  assert.equal(check.ok, false);
});
