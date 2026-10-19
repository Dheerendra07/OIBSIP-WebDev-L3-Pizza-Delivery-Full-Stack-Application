import test from 'node:test';
import assert from 'node:assert/strict';
import { isSessionVersionCurrent } from '../src/utils/sessionVersion.js';
test('accepts sessions from the current credential generation', () => { assert.equal(isSessionVersionCurrent(0, 0), true); assert.equal(isSessionVersionCurrent(4, 4), true); });
test('invalidates all earlier sessions after password reset increments the version', () => { assert.equal(isSessionVersionCurrent(0, 1), false); assert.equal(isSessionVersionCurrent(3, 4), false); });
test('treats legacy sessions and existing users without a version as version zero', () => { assert.equal(isSessionVersionCurrent(undefined, undefined), true); assert.equal(isSessionVersionCurrent(undefined, 1), false); });
test('rejects malformed or negative version values safely', () => { assert.equal(isSessionVersionCurrent(-1, 0), false); assert.equal(isSessionVersionCurrent(1.5, 1), false); assert.equal(isSessionVersionCurrent(1, 2), false); });
