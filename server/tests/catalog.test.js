import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, FEATURED_PIZZAS, calculateCustomPizza, inventoryRequirements } from '../src/utils/catalog.js';
test('featured menu tags match the frontend filter values', () => assert.deepEqual(FEATURED_PIZZAS.map((pizza) => pizza.tag), ['BESTSELLER', 'FRESH PICK', 'SPICY', 'PLANT-BASED']));
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
