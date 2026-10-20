import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesCartSnapshot,
  requiresPriceConfirmation,
  sameServerQuote,
  snapshotCart,
} from '../src/priceReview.js';

const cart = () => [{
  cartKey: 'featured:margherita',
  type: 'featured',
  pizzaId: 'margherita',
  name: 'Margherita Classic',
  unitPrice: 249,
  quantity: 2,
  ingredients: { base: 'classic' },
}];
const order = (overrides = {}) => ({
  id: '64b000000000000000000001',
  subtotal: 498,
  deliveryFee: 29,
  total: 527,
  status: 'pending_payment',
  paymentStatus: 'pending',
  items: [{
    name: 'Margherita Classic',
    quantity: 2,
    unitPrice: 249,
    lineTotal: 498,
    ingredients: { base: 'classic', vegetables: [] },
  }],
  ...overrides,
});

test('unchanged server quote does not require price reconfirmation', () => {
  assert.equal(requiresPriceConfirmation({
    cart: cart(),
    order: order(),
    displayedSubtotal: 498,
    displayedDeliveryFee: 29,
    cartMatchesServerOrder: true,
  }), false);
});

test('price, delivery-fee, subtotal and total differences require reconfirmation', () => {
  const cases = [
    { quote: order({ subtotal: 518, total: 547, items: [{ ...order().items[0], unitPrice: 259, lineTotal: 518 }] }), subtotal: 498, fee: 29 },
    { quote: order({ deliveryFee: 0, total: 498 }), subtotal: 498, fee: 29 },
    { quote: order({ total: 528 }), subtotal: 498, fee: 29 },
    { quote: order(), subtotal: 500, fee: 0 },
  ];
  for (const item of cases) {
    assert.equal(requiresPriceConfirmation({
      cart: cart(),
      order: item.quote,
      displayedSubtotal: item.subtotal,
      displayedDeliveryFee: item.fee,
      cartMatchesServerOrder: true,
    }), true);
  }
});

test('recipe/identity differences require reconfirmation even when total is unchanged', () => {
  assert.equal(requiresPriceConfirmation({
    cart: cart(),
    order: order(),
    displayedSubtotal: 498,
    displayedDeliveryFee: 29,
    cartMatchesServerOrder: false,
  }), true);
});

test('cart snapshots detect edited quantity, price, removed items and recipe changes', () => {
  const original = cart();
  const snapshot = snapshotCart(original);
  assert.equal(matchesCartSnapshot(snapshot, original), true);
  assert.equal(matchesCartSnapshot(snapshot, [{ ...original[0], quantity: 3 }]), false);
  assert.equal(matchesCartSnapshot(snapshot, [{ ...original[0], unitPrice: 259 }]), false);
  assert.equal(matchesCartSnapshot(snapshot, []), false);
  assert.equal(matchesCartSnapshot(snapshot, [{ ...original[0], sauce: 'pesto' }]), false);
});

test('server quote comparison accepts the same quote and rejects any repricing or order-state change', () => {
  assert.equal(sameServerQuote(order(), order()), true);
  assert.equal(sameServerQuote(order(), order({ total: 528 })), false);
  assert.equal(sameServerQuote(order(), order({ status: 'order_received', paymentStatus: 'paid' })), false);
  assert.equal(sameServerQuote(order(), order({ items: [{ ...order().items[0], unitPrice: 259, lineTotal: 518 }] })), false);
});

test('ingredient array ordering does not create a false quote change', () => {
  const first = order({ items: [{ ...order().items[0], ingredients: { base: 'classic', vegetables: ['onion', 'corn'] } }] });
  const second = order({ items: [{ ...order().items[0], ingredients: { vegetables: ['corn', 'onion'], base: 'classic' } }] });
  assert.equal(sameServerQuote(first, second), true);
});
