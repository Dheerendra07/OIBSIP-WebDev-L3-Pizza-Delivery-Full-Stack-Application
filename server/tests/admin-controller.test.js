import test from 'node:test';
import assert from 'node:assert/strict';
import { updateInventory, updateOrderStatus } from '../src/controllers/adminController.js';

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('inventory updates reject an absent or non-object request body without a database lookup', async () => {
  for (const body of [undefined, null, [], 'invalid']) {
    const res = responseRecorder();
    let nextError;
    await updateInventory({ params: { key: 'base:classic' }, body }, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: 'Provide stock or lowStockThreshold to update' });
  }
});

test('inventory updates reject invalid counts before a database lookup', async () => {
  const res = responseRecorder();
  let nextError;
  await updateInventory({ params: { key: 'base:classic' }, body: { stock: -1 } }, res, (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'Stock must be a whole number between 0 and 10,000,000' });
});

test('order status updates reject an absent or malformed status before a database lookup', async () => {
  for (const body of [undefined, null, [], {}, { status: ['delivered'] }, { status: '   ' }]) {
    const res = responseRecorder();
    let nextError;
    await updateOrderStatus({ params: { id: 'invalid-order-id' }, body }, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: 'A valid order status is required' });
  }
});
