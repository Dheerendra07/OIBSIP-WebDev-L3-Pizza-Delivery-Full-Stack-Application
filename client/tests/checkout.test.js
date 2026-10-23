import test from 'node:test';
import assert from 'node:assert/strict';
import { orderMatchesCart, classifyExistingCheckout, buildPendingCheckoutCart } from '../src/checkout.js';
const featured = [{ id: 'margherita', price: 249, ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['tomato'] } }];
const cart = [{ cartKey: 'featured:margherita', type: 'featured', pizzaId: 'margherita', unitPrice: 249, quantity: 2 }];
const orderItems = [{ name: 'Margherita Classic', unitPrice: 249, quantity: 2, ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['tomato'] } }];
test('reuses an existing pending order only when its featured pizza cart matches', () => assert.equal(orderMatchesCart(orderItems, cart, featured), true));
test('rejects reuse when quantity changes', () => assert.equal(orderMatchesCart(orderItems, [{ ...cart[0], quantity: 3 }], featured), false));
test('rejects reuse when the cart ingredients change', () => assert.equal(orderMatchesCart(orderItems, [{ ...cart[0], pizzaId: 'not-in-catalog' }], featured), false));
test('rejects reuse when server price differs from visible cart price', () => assert.equal(orderMatchesCart([{ ...orderItems[0], unitPrice: 299 }], cart, featured), false));
test('rejects a line count mismatch', () => assert.equal(orderMatchesCart(orderItems, [...cart, cart[0]], featured), false));
test('matches custom pizza ingredients independent of topping order', () => {
 const customCart = [{ type: 'custom', unitPrice: 324, quantity: 1, base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['corn', 'onion'] }];
 const savedOrder = [{ unitPrice: 324, quantity: 1, ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['onion', 'corn'] } }];
 assert.equal(orderMatchesCart(savedOrder, customCart, featured), true);
});

test('checkout recovery separates manual-review captures from completed payments', () => {
  assert.equal(classifyExistingCheckout({ status: 'payment_review', paymentStatus: 'paid' }, true), 'review');
  assert.equal(classifyExistingCheckout({ status: 'order_received', paymentStatus: 'paid', paymentReviewRequired: true }, true), 'review');
  assert.equal(classifyExistingCheckout({ status: 'order_received', paymentStatus: 'paid', paymentReviewRequired: false }, true), 'already-paid');
});

test('checkout resumes only a matching pending order and replaces other states', () => {
  assert.equal(classifyExistingCheckout({ status: 'pending_payment', paymentStatus: 'pending' }, true), 'resume');
  assert.equal(classifyExistingCheckout({ status: 'pending_payment', paymentStatus: 'pending' }, false), 'new');
  assert.equal(classifyExistingCheckout({ status: 'cancelled', paymentStatus: 'pending' }, true), 'new');
  assert.equal(classifyExistingCheckout(null, false), 'new');
});


const resumeCatalog = {
  bases: [{ id: 'classic', price: 0 }],
  sauces: [{ id: 'classic-tomato', price: 0 }],
  cheeses: [{ id: 'mozzarella', price: 35 }],
  vegetables: [{ id: 'tomato', price: 15 }, { id: 'corn', price: 15 }, { id: 'onion', price: 10 }],
};
const resumeFeatured = [{
  id: 'margherita',
  name: 'Margherita Classic',
  emoji: '🍅',
  price: 299,
  ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['tomato'] },
}];
const pendingOrder = (overrides = {}) => ({
  id: '64b000000000000000000099',
  orderNumber: 'PH-RESUME99',
  status: 'pending_payment',
  paymentStatus: 'pending',
  items: [{
    name: 'Margherita Classic',
    quantity: 2,
    unitPrice: 249,
    lineTotal: 498,
    ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['tomato'] },
  }],
  subtotal: 498,
  deliveryFee: 29,
  total: 527,
  ...overrides,
});

test('pending checkout restores the server quote, not a changed current menu price', () => {
  const order = pendingOrder();
  const rebuilt = buildPendingCheckoutCart(order, resumeCatalog, resumeFeatured);
  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.items.length, 1);
  assert.equal(rebuilt.items[0].unitPrice, 249, 'saved server price must win over today’s featured price');
  assert.equal(rebuilt.items[0].quantity, 2);
  assert.equal(orderMatchesCart(order.items, rebuilt.items, resumeFeatured), true);
  assert.equal(rebuilt.items[0].cartKey, 'featured:margherita');
});

test('pending checkout restoration refuses paid, cancelled and payment-review orders', () => {
  for (const order of [
    pendingOrder({ status: 'order_received', paymentStatus: 'paid' }),
    pendingOrder({ status: 'cancelled' }),
    pendingOrder({ status: 'payment_review', paymentStatus: 'paid' }),
  ]) {
    const result = buildPendingCheckoutCart(order, resumeCatalog, resumeFeatured);
    assert.equal(result.ok, false);
    assert.equal(result.items.length, 0);
  }
});

test('pending checkout restoration refuses stale or inconsistent server totals', () => {
  const result = buildPendingCheckoutCart(pendingOrder({ total: 999 }), resumeCatalog, resumeFeatured);
  assert.equal(result.ok, false);
  assert.match(result.message, /totals do not match/);
});

test('pending checkout restoration refuses ingredients missing from the current catalog', () => {
  const catalog = { ...resumeCatalog, vegetables: [] };
  const result = buildPendingCheckoutCart(pendingOrder(), catalog, resumeFeatured);
  assert.equal(result.ok, false);
  assert.match(result.message, /no longer in the catalog/);
});

test('pending custom-pizza checkout restores each line with its saved price and unique safe cart key', () => {
  const order = pendingOrder({
    items: [
      {
        name: 'Custom Classic Hand-Tossed',
        quantity: 1,
        unitPrice: 259,
        lineTotal: 259,
        ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['corn', 'onion'] },
      },
    ],
    subtotal: 259,
    deliveryFee: 29,
    total: 288,
  });
  const result = buildPendingCheckoutCart(order, resumeCatalog, resumeFeatured);
  assert.equal(result.ok, true);
  assert.equal(result.items[0].type, 'custom');
  assert.equal(result.items[0].unitPrice, 259);
  assert.match(result.items[0].cartKey, /^custom:resume-[a-z0-9-]+$/);
});
