import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectQaEnvironment } from '../src/utils/qaPreflight.js';

const validEnv = () => ({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/pizza_house_test',
  JWT_SECRET: 'qa-test-only-secret-with-more-than-32-characters',
  CLIENT_ORIGIN: 'http://localhost:5173',
  CLIENT_BASE_URL: 'http://localhost:5173',
  APP_BASE_URL: 'http://localhost:4000',
  ADMIN_EMAIL: 'pizza-admin@sample.test',
  ADMIN_PASSWORD: 'TestingPassword123',
  SMTP_HOST: 'smtp.sample.test',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'qa-mail-user',
  SMTP_PASS: 'qa-mail-password',
  MAIL_FROM: 'Pizza House <orders@sample.test>',
  ADMIN_ALERT_EMAIL: 'admin@sample.test',
  RAZORPAY_KEY_ID: 'rzp_test_abc123',
  RAZORPAY_KEY_SECRET: 'razorpay-test-secret',
  RAZORPAY_WEBHOOK_SECRET: 'independent-webhook-test-secret',
});

test('accepts a complete test-only E2E configuration', () => {
  const result = inspectQaEnvironment(validEnv());
  assert.equal(result.ok, true);
  assert.equal(result.passed, result.total);
  assert.equal(result.total, 16);
});

test('accepts a complete test-only configuration using Resend without SMTP', () => {
  const env = validEnv();
  delete env.SMTP_HOST;
  delete env.SMTP_USER;
  delete env.SMTP_PASS;
  env.RESEND_API_KEY = 're_test_api_key';
  const result = inspectQaEnvironment(env);
  assert.equal(result.ok, true);
  assert.equal(result.passed, result.total);
  assert.equal(result.total, 16);
});

test('reports missing mail and payment configuration without exposing values', () => {
  const env = validEnv();
  delete env.SMTP_PASS;
  delete env.RAZORPAY_KEY_SECRET;
  const result = inspectQaEnvironment(env);
  assert.equal(result.ok, false);
  const failures = result.sections.flatMap(section => section.checks).filter(check => !check.ok);
  assert.deepEqual(failures.map(check => check.label), ['Email provider credentials', 'Optional SMTP settings', 'RAZORPAY_KEY_SECRET']);
  assert.equal(JSON.stringify(result).includes('razorpay-test-secret'), false);
  assert.equal(JSON.stringify(result).includes('qa-mail-password'), false);
});

test('rejects production environment for this test preflight', () => {
  const env = validEnv();
  env.NODE_ENV = 'production';
  const result = inspectQaEnvironment(env);
  assert.equal(result.ok, false);
  assert.equal(result.sections[0].checks[0].label, 'Safe environment');
  assert.equal(result.sections[0].checks[0].ok, false);
});

test('rejects weak or placeholder session secrets and weak admin passwords', () => {
  const env = validEnv();
  env.JWT_SECRET = 'dev-only-change-this-secret-before-deployment-please';
  env.ADMIN_PASSWORD = 'weak';
  const result = inspectQaEnvironment(env);
  const failed = result.sections.flatMap(section => section.checks).filter(check => !check.ok).map(check => check.label);
  assert.ok(failed.includes('JWT_SECRET'));
  assert.ok(failed.includes('ADMIN_PASSWORD'));
});

test('rejects non-exact origins, including paths and trailing slashes', () => {
  const env = validEnv();
  env.CLIENT_ORIGIN = 'http://localhost:5173/';
  env.CLIENT_BASE_URL = 'http://localhost:5173/menu';
  const result = inspectQaEnvironment(env);
  const failed = result.sections.flatMap(section => section.checks).filter(check => !check.ok).map(check => check.label);
  assert.ok(failed.includes('CLIENT_ORIGIN'));
  assert.ok(failed.includes('CLIENT_BASE_URL'));
});

test('rejects live Razorpay credentials', () => {
  const env = validEnv();
  env.RAZORPAY_KEY_ID = 'rzp_live_abc123';
  const result = inspectQaEnvironment(env);
  const check = result.sections[3].checks.find(item => item.label === 'RAZORPAY_KEY_ID');
  assert.equal(check.ok, false);
});
