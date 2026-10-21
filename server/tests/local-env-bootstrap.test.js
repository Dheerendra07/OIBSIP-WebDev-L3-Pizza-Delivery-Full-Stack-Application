import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLocalEnvValues, prepareLocalEnv, readLocalEnvValue } from '../src/utils/localEnvBootstrap.js';

const strongSecret = 'local-generated-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const template = [
  '# local test only',
  'NODE_ENV=development',
  'PORT=4000',
  'MONGODB_URI=mongodb://127.0.0.1:27017/pizza_delivery',
  'JWT_SECRET=replace-with-at-least-32-random-characters',
  'ADMIN_EMAIL=',
  'ADMIN_PASSWORD=',
  'SMTP_HOST=',
  'SMTP_PASS=',
  'RAZORPAY_KEY_ID=',
  'RAZORPAY_KEY_SECRET=',
  'RAZORPAY_WEBHOOK_SECRET=',
].join('\n');

test('creates local env with a generated JWT secret and leaves provider values empty', () => {
  const result = prepareLocalEnv(template, undefined, () => strongSecret);
  assert.equal(result.created, true);
  assert.equal(result.generatedJwtSecret, true);
  assert.ok(result.content.includes(`JWT_SECRET=${strongSecret}`));
  for (const key of ['ADMIN_PASSWORD', 'SMTP_HOST', 'SMTP_PASS', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
    assert.match(result.content, new RegExp(`^${key}=$`, 'm'), `${key} should not be fabricated`);
  }
});

test('preserves a complete existing local env without rotating the JWT secret', () => {
  const existing = template.replace('JWT_SECRET=replace-with-at-least-32-random-characters', `JWT_SECRET=${strongSecret}`)
    .replace('MONGODB_URI=mongodb://127.0.0.1:27017/pizza_delivery', 'MONGODB_URI=mongodb://localhost:27017/custom_local_db');
  const result = prepareLocalEnv(template, existing, () => { throw new Error('Secret must not be regenerated'); });
  assert.equal(result.created, false);
  assert.equal(result.generatedJwtSecret, false);
  assert.ok(result.content.includes('MONGODB_URI=mongodb://localhost:27017/custom_local_db'));
  assert.ok(result.content.includes(`JWT_SECRET=${strongSecret}`));
});

test('repairs only a placeholder JWT secret in an existing local env', () => {
  const existing = 'NODE_ENV=development\nJWT_SECRET=\nCUSTOM_LOCAL_FLAG=keep-me\nSMTP_PASS=do-not-touch';
  const result = prepareLocalEnv(template, existing, () => strongSecret);
  assert.equal(result.generatedJwtSecret, true);
  assert.ok(result.content.includes(`JWT_SECRET=${strongSecret}`));
  assert.ok(result.content.includes('CUSTOM_LOCAL_FLAG=keep-me'));
  assert.ok(result.content.includes('SMTP_PASS=do-not-touch'));
});

test('refuses to modify a production env', () => {
  assert.throws(
    () => prepareLocalEnv(template, 'NODE_ENV=production\nJWT_SECRET=production-secret-value-kept-private'),
    /Refusing to modify/,
  );
});

test('does not accept a weak secret from the generator', () => {
  assert.throws(() => prepareLocalEnv(template, undefined, () => 'short'), /strong secret/);
});

test('merges explicitly entered settings, correctly quotes special characters and preserves skipped fields', () => {
  const merged = mergeLocalEnvValues(template, {
    ADMIN_EMAIL: 'admin@sample.test',
    ADMIN_PASSWORD: 'secret #= $& value with spaces',
    SMTP_PASS: '',
  });
  assert.equal(readLocalEnvValue(merged, 'ADMIN_EMAIL'), 'admin@sample.test');
  assert.equal(readLocalEnvValue(merged, 'ADMIN_PASSWORD'), 'secret #= $& value with spaces');
  assert.equal(readLocalEnvValue(merged, 'SMTP_PASS'), '');
  assert.ok(merged.includes('SMTP_HOST='));
});

test('reads quoted values without exposing or altering their contents', () => {
  const content = 'SMTP_PASS="contains # hash, equals =, and spaces"\nRAZORPAY_KEY_SECRET=plain-secret';
  assert.equal(readLocalEnvValue(content, 'SMTP_PASS'), 'contains # hash, equals =, and spaces');
  assert.equal(readLocalEnvValue(content, 'RAZORPAY_KEY_SECRET'), 'plain-secret');
});
