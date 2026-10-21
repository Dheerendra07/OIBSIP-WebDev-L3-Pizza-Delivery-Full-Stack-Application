import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBudget } from '../src/budgetGuard.js';

test('an empty optional budget never blocks checkout', () => {
  assert.deepEqual(evaluateBudget(528, ''), {
    configured: false, valid: true, withinBudget: true, remaining: null, overBy: 0, limit: null,
  });
});

test('budget includes the full displayed total and accepts an exact match', () => {
  assert.equal(evaluateBudget(499, '499').withinBudget, true);
  assert.equal(evaluateBudget(499, '499').remaining, 0);
});

test('reports remaining budget when total is below the limit', () => {
  const result = evaluateBudget(428, '500');
  assert.equal(result.withinBudget, true);
  assert.equal(result.remaining, 72);
  assert.equal(result.overBy, 0);
});

test('blocks checkout when the all-in total exceeds the limit', () => {
  const result = evaluateBudget(528, '500');
  assert.equal(result.withinBudget, false);
  assert.equal(result.overBy, 28);
  assert.equal(result.remaining, 0);
});

test('rejects zero, negative, fractional, and non-numeric budget limits', () => {
  for (const input of ['0', '-1', '10.5', 'nope']) {
    assert.equal(evaluateBudget(100, input).valid, false, String(input));
    assert.equal(evaluateBudget(100, input).withinBudget, false, String(input));
  }
});

test('invalid totals fail closed instead of being treated as within budget', () => {
  assert.equal(evaluateBudget(Number.NaN, '').withinBudget, false);
  assert.equal(evaluateBudget(-1, '100').withinBudget, false);
});
