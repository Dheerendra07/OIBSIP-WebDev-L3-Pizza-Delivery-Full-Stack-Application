import test from 'node:test';
import assert from 'node:assert/strict';
import { orderMatchesCart, classifyExistingCheckout } from '../src/checkout.js';
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
