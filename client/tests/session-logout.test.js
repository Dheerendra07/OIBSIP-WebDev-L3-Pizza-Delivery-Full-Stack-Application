import test from 'node:test';
import assert from 'node:assert/strict';
import { completeSignOut } from '../src/sessionLogout.js';

test('confirmed logout clears local session state', async () => {
  const calls = [];
  const result = await completeSignOut({
    request: async (...args) => { calls.push(args); return { message: 'Signed out' }; },
    clearLocalSession: () => calls.push(['clear-local-session']),
    onError: (error) => calls.push(['unexpected-error', error]),
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [
    ['/auth/logout', { method: 'POST' }],
    ['clear-local-session'],
  ]);
});

test('failed logout preserves local session state and surfaces the failure', async () => {
  const calls = [];
  const failure = new TypeError('network unavailable');
  const result = await completeSignOut({
    request: async (...args) => {
      calls.push(args);
      throw failure;
    },
    clearLocalSession: () => calls.push(['clear-local-session']),
    onError: (error) => calls.push(['show-error', error]),
  });

  assert.equal(result, false);
  assert.deepEqual(calls, [
    ['/auth/logout', { method: 'POST' }],
    ['show-error', failure],
  ]);
});
