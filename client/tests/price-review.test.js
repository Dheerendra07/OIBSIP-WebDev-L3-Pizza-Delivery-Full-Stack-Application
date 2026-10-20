import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cartMatchesServerSnapshot,
  matchesCartSnapshot,
  requiresPriceConfirmation,
  sameServerQuote,
  snapshotCart,
  syncCartToServerQuote,
} from '../src/priceReview.js';

const cart = () => [{
  cartKey: 'featured:margherita',
  type: 'featured',
  pizzaId: 'margherita',
  name: 'Margherita Classic',
  unitPrice: 249,
  quantity: 2,
  ingredients: { base: 'classic', sauce: 'tomato', cheese: 'mozzarella', vegetables: [] },
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
    ingredients: { base: 'classic', sauce: 'tomato', cheese: 'mozzarella', vegetables: [] },
  }],
  ...overrides,
});

test('unchanged server quote does not require price reconfirmation', () => {
  assert.equal(requiresPriceConfirmation({
    cart: cart(),
    order: order(),
    displayedSubtotal: 498,
    displayedDeliveryFee: 29,
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
  const changedRecipe = order({
    items: [{ ...order().items[0], ingredients: { base: 'thin', sauce: 'tomato', cheese: 'mozzarella', vegetables: [] } }],
  });
  assert.equal(requiresPriceConfirmation({
    cart: cart(),
    order: changedRecipe,
    displayedSubtotal: 498,
    displayedDeliveryFee: 29,
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

test('server snapshot comparison catches a changed ingredient recipe with an unchanged price', () => {
  const server = order({ items: [{ ...order().items[0], ingredients: { base: 'thin', sauce: 'tomato', cheese: 'mozzarella', vegetables: [] } }] });
  assert.equal(cartMatchesServerSnapshot(cart(), server), false);
  assert.equal(requiresPriceConfirmation({
    cart: cart(),
    order: server,
    displayedSubtotal: 498,
    displayedDeliveryFee: 29,
  }), true);
});

test('custom-pizza snapshot comparison uses selected base, sauce, cheese and vegetables', () => {
  const customCart = [{
    cartKey: 'custom:one',
    type: 'custom',
    name: 'Custom Classic',
    unitPrice: 259,
    quantity: 1,
    base: 'classic',
    sauce: 'tomato',
    cheese: 'mozzarella',
    vegetables: ['onion'],
  }];
  const matchingOrder = order({
    subtotal: 259,
    deliveryFee: 29,
    total: 288,
    items: [{
      name: 'Build Your Own',
      quantity: 1,
      unitPrice: 259,
      lineTotal: 259,
      ingredients: { base: 'classic', sauce: 'tomato', cheese: 'mozzarella', vegetables: ['onion'] },
    }],
  });
  assert.equal(cartMatchesServerSnapshot(customCart, matchingOrder), true);
  assert.equal(cartMatchesServerSnapshot(customCart, order({
    subtotal: 259,
    deliveryFee: 29,
    total: 288,
    items: [{ ...matchingOrder.items[0], ingredients: { ...matchingOrder.items[0].ingredients, base: 'thin' } }],
  })), false);
});

test('accepted server quote updates cart prices and recipe snapshot before retrying checkout', () => {
  const oldCart = cart();
  const newerOrder = order({
    subtotal: 518,
    deliveryFee: 0,
    total: 518,
    items: [{
      name: 'Margherita Classic',
      quantity: 2,
      unitPrice: 259,
      lineTotal: 518,
      ingredients: { base: 'thin', sauce: 'tomato', cheese: 'mozzarella', vegetables: [] },
    }],
  });
  const synced = syncCartToServerQuote(oldCart, newerOrder, { bases: [] });
  assert.equal(synced[0].unitPrice, 259);
  assert.equal(synced[0].quantity, 2);
  assert.equal(synced[0].ingredients.base, 'thin');
  assert.equal(matchesCartSnapshot(snapshotCart(synced), synced), true);
});

test('accepted custom-pizza quote updates its server-selected ingredient IDs safely', () => {
  const oldCart = [{
    cartKey: 'custom:one',
    type: 'custom',
    name: 'Custom Classic',
    unitPrice: 259,
    quantity: 1,
    base: 'classic',
    sauce: 'tomato',
    cheese: 'mozzarella',
    vegetables: ['onion'],
  }];
  const savedOrder = order({
    subtotal: 289,
    deliveryFee: 29,
    total: 318,
    items: [{
      name: 'Build Your Own',
      quantity: 1,
      unitPrice: 289,
      lineTotal: 289,
      ingredients: { base: 'thin', sauce: 'pesto', cheese: 'mozzarella', vegetables: ['onion'] },
    }],
  });
  const synced = syncCartToServerQuote(oldCart, savedOrder, { bases: [{ id: 'thin', name: 'Thin & Crispy' }] });
  assert.equal(synced[0].unitPrice, 289);
  assert.equal(synced[0].name, 'Custom Thin & Crispy');
  assert.equal(synced[0].base, 'thin');
  assert.equal(synced[0].sauce, 'pesto');
});
