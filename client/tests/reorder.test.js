import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReorderCart } from '../src/reorder.js';

const catalog = {
  bases: [
    { id: 'classic', name: 'Classic Hand-Tossed', price: 0, available: true },
    { id: 'pan', name: 'Pan Crust', price: 50, available: true },
  ],
  sauces: [
    { id: 'tomato', name: 'Classic Tomato', price: 0, available: true },
    { id: 'bbq', name: 'Smoky BBQ', price: 20, available: true },
  ],
  cheeses: [
    { id: 'mozzarella', name: 'Mozzarella', price: 35, available: true },
    { id: 'cheddar', name: 'Cheddar', price: 45, available: true },
  ],
  vegetables: [
    { id: 'tomato', name: 'Tomato', price: 15, available: true },
    { id: 'onion', name: 'Onion', price: 10, available: true },
    { id: 'corn', name: 'Corn', price: 15, available: true },
  ],
};
const featuredPizzas = [{
  id: 'classic-pizza',
  name: 'Classic Pizza',
  price: 279,
  emoji: '🍕',
  available: true,
  ingredients: { base: 'classic', sauce: 'tomato', cheese: 'mozzarella', vegetables: ['tomato'] },
}];
const order = (items) => ({ id: 'order-123', orderNumber: 'PH-00123', items });
const featuredLine = (overrides = {}) => ({
  name: 'Classic Pizza',
  quantity: 2,
  unitPrice: 249,
  ingredients: { base: 'classic', sauce: 'tomato', cheese: 'mozzarella', vegetables: ['tomato'] },
  ...overrides,
});

test('restores featured items at the current menu price, not the historical price', () => {
  const result = buildReorderCart(order([featuredLine()]), catalog, featuredPizzas);
  assert.equal(result.ok, true);
  assert.equal(result.items[0].type, 'featured');
  assert.equal(result.items[0].pizzaId, 'classic-pizza');
  assert.equal(result.items[0].unitPrice, 279);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].cartKey, 'repeat:order-123:0');
});

test('rebuilds a custom recipe and derives its price from the current catalog', () => {
  const result = buildReorderCart(order([featuredLine({
    name: 'Custom Pan',
    unitPrice: 999,
    ingredients: { base: 'pan', sauce: 'bbq', cheese: 'cheddar', vegetables: ['onion', 'corn'] },
  })]), catalog, featuredPizzas);
  assert.equal(result.ok, true);
  assert.equal(result.items[0].type, 'custom');
  assert.equal(result.items[0].unitPrice, 199 + 50 + 20 + 45 + 10 + 15);
  assert.deepEqual(result.items[0].vegetables, ['onion', 'corn']);
});

test('keeps custom identity when its recipe happens to match a featured pizza', () => {
  const result = buildReorderCart(order([featuredLine({
    name: 'Build Your Own',
    ingredients: { base: 'classic', sauce: 'tomato', cheese: 'mozzarella', vegetables: ['tomato'] },
  })]), catalog, featuredPizzas);
  assert.equal(result.ok, true);
  assert.equal(result.items[0].type, 'custom');
  assert.equal(result.items[0].unitPrice, 199 + 0 + 0 + 35 + 15);
});

test('recognizes a renamed featured item from its saved recipe', () => {
  const renamed = featuredPizzas.map((pizza) => ({ ...pizza, name: 'New Classic Name' }));
  const result = buildReorderCart(order([featuredLine({ name: 'Classic Pizza' })]), catalog, renamed);
  assert.equal(result.ok, true);
  assert.equal(result.items[0].type, 'featured');
  assert.equal(result.items[0].name, 'New Classic Name');
});

test('refuses an unavailable ingredient without returning a partial cart', () => {
  const unavailableCatalog = {
    ...catalog,
    cheeses: catalog.cheeses.map((item) => item.id === 'cheddar' ? { ...item, available: false } : item),
  };
  const result = buildReorderCart(order([
    featuredLine(),
    featuredLine({ ingredients: { base: 'pan', sauce: 'bbq', cheese: 'cheddar', vegetables: [] } }),
  ]), unavailableCatalog, featuredPizzas);
  assert.equal(result.ok, false);
  assert.deepEqual(result.items, []);
  assert.match(result.message, /unavailable/i);
});

test('refuses an invalid quantity rather than truncating or normalizing it', () => {
  const result = buildReorderCart(order([featuredLine({ quantity: 11 })]), catalog, featuredPizzas);
  assert.equal(result.ok, false);
  assert.deepEqual(result.items, []);
  assert.match(result.message, /quantity/i);
});

test('refuses missing or malformed recipe data instead of guessing', () => {
  const result = buildReorderCart(order([featuredLine({ ingredients: null })]), catalog, featuredPizzas);
  assert.equal(result.ok, false);
  assert.deepEqual(result.items, []);
  assert.match(result.message, /recipe/i);
});

test('refuses a retired ingredient rather than silently substituting another', () => {
  const result = buildReorderCart(order([featuredLine({
    ingredients: { base: 'retired-base', sauce: 'tomato', cheese: 'mozzarella', vegetables: ['tomato'] },
  })]), catalog, featuredPizzas);
  assert.equal(result.ok, false);
  assert.deepEqual(result.items, []);
  assert.match(result.message, /no longer on the menu/i);
});

test('refuses a featured recipe currently marked sold out', () => {
  const soldOut = featuredPizzas.map((item) => ({ ...item, available: false }));
  const result = buildReorderCart(order([featuredLine()]), catalog, soldOut);
  assert.equal(result.ok, false);
  assert.deepEqual(result.items, []);
  assert.match(result.message, /unavailable/i);
});

test('refuses empty and over-limit saved orders', () => {
  assert.equal(buildReorderCart(order([]), catalog, featuredPizzas).ok, false);
  assert.equal(buildReorderCart(order(Array.from({ length: 13 }, () => featuredLine())), catalog, featuredPizzas).ok, false);
});
