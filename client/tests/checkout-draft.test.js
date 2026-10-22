import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKOUT_DRAFT_STORAGE_KEY,
  parseCheckoutDraft,
  serializeCheckoutDraft,
} from '../src/checkoutDraft.js';

const orderId = '64b000000000000000000001';
const featured = {
  cartKey: 'featured:margherita',
  type: 'featured',
  pizzaId: 'margherita',
  name: 'Margherita Classic',
  emoji: '🍅',
  unitPrice: 249,
  quantity: 2,
  ingredients: {
    base: 'classic',
    sauce: 'classic-tomato',
    cheese: 'mozzarella',
    vegetables: ['tomato'],
  },
};
const custom = {
  cartKey: 'custom:1730000000000',
  type: 'custom',
  name: 'Custom Classic',
  emoji: '🍕',
  unitPrice: 289,
  quantity: 1,
  base: 'classic',
  sauce: 'pesto',
  cheese: 'mozzarella',
  vegetables: ['onion', 'corn'],
};

test('checkout draft restores basket and existing server order after a refresh', () => {
  const saved = serializeCheckoutDraft({ cart: [featured], activeOrderId: orderId });
  assert.ok(saved);
  assert.deepEqual(parseCheckoutDraft(saved), {
    version: 1,
    cart: [featured],
    activeOrderId: orderId,
  });
});

test('checkout draft restores custom recipe details without persisting delivery information', () => {
  const saved = serializeCheckoutDraft({ cart: [custom], activeOrderId: null, deliveryDetails: {
    recipientName: 'Test Person',
    addressLine: 'Private address',
    phone: '9000000000',
  } });
  assert.ok(saved);
  const restored = parseCheckoutDraft(saved);
  assert.deepEqual(restored.cart, [custom]);
  assert.equal(restored.activeOrderId, null);
  assert.equal(saved.includes('Private address'), false);
  assert.equal(saved.includes('9000000000'), false);
  assert.equal(saved.includes('recipientName'), false);
});

test('malformed or unsafe checkout drafts are rejected', () => {
  assert.equal(parseCheckoutDraft('not-json'), null);
  assert.equal(parseCheckoutDraft('{}'), null);
  assert.equal(parseCheckoutDraft(JSON.stringify({ version: 1, cart: [{ ...featured, quantity: 99 }], activeOrderId: orderId })), null);
  assert.equal(parseCheckoutDraft(JSON.stringify({ version: 1, cart: [{ ...featured, unitPrice: -1 }], activeOrderId: orderId })), null);
  assert.equal(parseCheckoutDraft(JSON.stringify({ version: 1, cart: [featured], activeOrderId: '../other-order' })), null);
  assert.equal(parseCheckoutDraft(JSON.stringify({ version: 1, cart: [{ ...featured, ingredients: { ...featured.ingredients, vegetables: ['onion', 'onion'] } }], activeOrderId: null })), null);
  assert.equal(serializeCheckoutDraft({ cart: 'not-an-array', activeOrderId: null }), null);
});

test('empty basket never keeps a stale active order ID', () => {
  const saved = serializeCheckoutDraft({ cart: [], activeOrderId: orderId });
  assert.ok(saved);
  assert.deepEqual(parseCheckoutDraft(saved), { version: 1, cart: [], activeOrderId: null });
});

test('storage key is scoped to the current browser tab', () => {
  assert.equal(CHECKOUT_DRAFT_STORAGE_KEY, 'pizza-house.checkout-draft');
});
