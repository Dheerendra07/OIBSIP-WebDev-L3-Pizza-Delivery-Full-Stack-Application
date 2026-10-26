import test from 'node:test';
import assert from 'node:assert/strict';
import OrderIssue from '../src/models/OrderIssue.js';

test('issue schema limits issue categories, case states and customer-visible message', () => {
  const schema = OrderIssue.schema;
  assert.deepEqual(schema.path('category').enumValues, [
    'missing_item', 'wrong_item', 'damaged_item', 'quality_issue', 'delivery_delay', 'payment_refund', 'other',
  ]);
  assert.deepEqual(schema.path('status').enumValues, ['open', 'under_review', 'resolved']);
  assert.equal(schema.path('description').options.minlength, 10);
  assert.equal(schema.path('description').options.maxlength, 600);
  assert.equal(schema.path('customerUpdate').options.maxlength, 600);
  assert.equal(schema.options.strict, 'throw');
});

test('issue reference has a unique index', () => {
  const indexes = OrderIssue.schema.indexes();
  assert.ok(indexes.some(([fields, options]) =>
    fields.reference === 1 && options.unique === true
  ));
});

test('schema enforces at most one active case per order and customer, while allowing resolved history', () => {
  const indexes = OrderIssue.schema.indexes();
  assert.ok(indexes.some(([fields, options]) =>
    fields.order === 1 &&
    fields.user === 1 &&
    options.unique === true &&
    options.partialFilterExpression?.active === true &&
    options.name === 'one_active_issue_per_order'
  ));
});
