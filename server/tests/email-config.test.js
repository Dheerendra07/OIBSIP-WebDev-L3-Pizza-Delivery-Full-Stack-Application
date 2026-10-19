import test from 'node:test';
import assert from 'node:assert/strict';
import { isMailConfigured } from '../src/utils/emailConfig.js';
test('email transport is considered configured only when host and credentials exist', () => {
 assert.equal(isMailConfigured({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'user', SMTP_PASS: 'pass' }), true);
 assert.equal(isMailConfigured({ SMTP_HOST: 'smtp.example.test', SMTP_USER: 'user', SMTP_PASS: '' }), false);
 assert.equal(isMailConfigured({ SMTP_HOST: 'smtp.example.test', SMTP_USER: '', SMTP_PASS: 'pass' }), false);
 assert.equal(isMailConfigured({ SMTP_HOST: '', SMTP_USER: 'user', SMTP_PASS: 'pass' }), false);
 assert.equal(isMailConfigured({}), false);
});
