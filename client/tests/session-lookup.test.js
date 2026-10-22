import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySessionLookupFailure } from '../src/sessionLookup.js';

test('only an explicit unauthenticated response confirms the visitor is signed out', () => {
  assert.equal(classifySessionLookupFailure({ status: 401 }), 'unauthenticated');
});

test('server errors and network failures keep the session state unknown', () => {
  assert.equal(classifySessionLookupFailure({ status: 500 }), 'unavailable');
  assert.equal(classifySessionLookupFailure({ status: 503 }), 'unavailable');
  assert.equal(classifySessionLookupFailure(new TypeError('fetch failed')), 'unavailable');
  assert.equal(classifySessionLookupFailure(undefined), 'unavailable');
});
