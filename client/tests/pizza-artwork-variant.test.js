import test from 'node:test';
import assert from 'node:assert/strict';
import { getPizzaArtworkVariant } from '../src/pizzaArtworkVariant.js';

test('known featured pizzas receive distinct stable artwork variants even without a tone field', () => {
  assert.equal(getPizzaArtworkVariant({ id: 'margherita', name: 'Margherita Classic' }), 'tomato');
  assert.equal(getPizzaArtworkVariant({ id: 'garden', name: 'Garden Party' }), 'green');
  assert.equal(getPizzaArtworkVariant({ id: 'firecracker', name: 'Firecracker' }), 'orange');
  assert.equal(getPizzaArtworkVariant({ id: 'white-garden', name: 'White Garden' }), 'cream');
  assert.equal(new Set([
    getPizzaArtworkVariant({ id: 'margherita' }),
    getPizzaArtworkVariant({ id: 'garden' }),
    getPizzaArtworkVariant({ id: 'firecracker' }),
    getPizzaArtworkVariant({ id: 'white-garden' }),
  ]).size, 4);
});

test('unknown pizzas use recipe ingredients to select a visual theme', () => {
  assert.equal(getPizzaArtworkVariant({ name: 'Creamy Mushroom', sauce: 'white-garlic', cheese: 'vegan', vegetables: ['mushroom'] }), 'cream');
  assert.equal(getPizzaArtworkVariant({ name: 'Volcano', sauce: 'spicy-arrabbiata', vegetables: ['jalapeno'] }), 'orange');
  assert.equal(getPizzaArtworkVariant({ name: 'Pesto Garden', sauce: 'pesto', vegetables: ['capsicum', 'olive'] }), 'green');
  assert.equal(getPizzaArtworkVariant({ name: 'Simple Tomato', sauce: 'classic-tomato' }), 'tomato');
});

test('unknown recipes have deterministic varied fallback art and ignore invalid indices safely', () => {
  assert.equal(getPizzaArtworkVariant({ name: 'Chef Special' }, 0), 'tomato');
  assert.equal(getPizzaArtworkVariant({ name: 'Chef Special' }, 1), 'green');
  assert.equal(getPizzaArtworkVariant({ name: 'Chef Special' }, 2), 'orange');
  assert.equal(getPizzaArtworkVariant({ name: 'Chef Special' }, 3), 'cream');
  assert.equal(getPizzaArtworkVariant({ name: 'Chef Special' }, Number.NaN), 'tomato');
});
