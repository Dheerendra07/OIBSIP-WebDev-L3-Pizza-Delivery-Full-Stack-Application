import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, FEATURED_PIZZAS, calculateCustomPizza, inventoryRequirements } from '../src/utils/catalog.js';
test('featured menu tags match the frontend filter values', () => assert.deepEqual(FEATURED_PIZZAS.map((pizza) => pizza.tag), ['BESTSELLER', 'FRESH PICK', 'SPICY', 'PLANT-BASED', 'FRESH PICK', 'BESTSELLER', 'SPICY', 'PLANT-BASED']));
test('expanded server-owned menu has eight unique recipes backed by valid catalog options', () => {
 assert.equal(FEATURED_PIZZAS.length, 8);
 assert.equal(new Set(FEATURED_PIZZAS.map((pizza) => pizza.id)).size, FEATURED_PIZZAS.length);
 for (const pizza of FEATURED_PIZZAS) {
  assert.ok(Number.isFinite(pizza.price) && pizza.price >= 0, `invalid price for ${pizza.id}`);
  assert.ok(CATALOG.bases.some((item) => item.id === pizza.ingredients.base), `invalid base for ${pizza.id}`);
  assert.ok(CATALOG.sauces.some((item) => item.id === pizza.ingredients.sauce), `invalid sauce for ${pizza.id}`);
  assert.ok(CATALOG.cheeses.some((item) => item.id === pizza.ingredients.cheese), `invalid cheese for ${pizza.id}`);
  assert.ok(pizza.ingredients.vegetables.every((id) => CATALOG.vegetables.some((item) => item.id === id)), `invalid vegetable for ${pizza.id}`);
 }
});
test('catalog offers the requested five bases and five sauces', () => { assert.equal(CATALOG.bases.length, 5); assert.equal(CATALOG.sauces.length, 5); });
test('custom pizza price is computed on the server and duplicates are deduplicated', () => {
 const item = calculateCustomPizza({ base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['onion', 'onion', 'corn'], quantity: 2 });
 assert.equal(item.unitPrice, 259); assert.equal(item.lineTotal, 518); assert.deepEqual(item.ingredients.vegetables, ['onion', 'corn']);
});
test('invalid ingredients and out-of-range quantities are rejected', () => {
 assert.throws(() => calculateCustomPizza({ base: 'unknown', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: [] }));
 assert.throws(() => calculateCustomPizza({ base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: [], quantity: 11 }));
 assert.throws(() => calculateCustomPizza({ base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['onion', 'corn', 'olive', 'tomato', 'jalapeno', 'mushroom'] }));
});
test('inventory requirements aggregate shared ingredients by quantity', () => {
 const req = inventoryRequirements([{ quantity: 2, inventoryKeys: ['base:classic', 'cheese:mozzarella'] }, { quantity: 1, inventoryKeys: ['base:classic'] }]);
 assert.deepEqual(req, [{ key: 'base:classic', quantity: 3 }, { key: 'cheese:mozzarella', quantity: 2 }]);
});
