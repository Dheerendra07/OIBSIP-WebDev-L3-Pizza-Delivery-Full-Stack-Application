import test from 'node:test';
import assert from 'node:assert/strict';
import { PIZZA_CARD_PHOTOS, getPizzaCardPhoto } from '../src/pizzaPhoto.js';

const featuredRecipes = [
  ['Margherita Classic', 'classic'],
  ['Garden Party', 'rustic'],
  ['Firecracker', 'spicy'],
  ['White Garden', 'mushroom'],
  ['Pesto Forest', 'pestoForest'],
  ['Roasted Garden', 'roastedGarden'],
  ['Cornfire', 'cornfire'],
  ['Olive Atelier', 'oliveAtelier'],
];

test('each featured house recipe resolves to its own photo source', () => {
  const photos = featuredRecipes.map(([name]) => getPizzaCardPhoto({ name }, 0));
  assert.ok(photos.every((photo) => photo && typeof photo.src === 'string' && photo.src.length > 0));
  assert.equal(new Set(photos.map((photo) => photo.src)).size, featuredRecipes.length);
});

test('photo mapping keeps each featured recipe pinned to its intended source', () => {
  for (const [name, sourceKey] of featuredRecipes) {
    assert.equal(getPizzaCardPhoto({ name }, 7).src, PIZZA_CARD_PHOTOS[sourceKey].src, name);
  }
});

test('unmapped cart and order items always receive a valid fallback photo', () => {
  for (let index = 0; index < 12; index += 1) {
    const photo = getPizzaCardPhoto({ name: 'House special', ingredients: {} }, index);
    assert.ok(photo && typeof photo.src === 'string' && photo.src.length > 0, `index ${index}`);
  }
});

test('known ingredients provide a relevant photo for custom recipes', () => {
  assert.equal(
    getPizzaCardPhoto({ name: 'My Pizza', ingredients: { vegetables: ['mushroom'] } }, 3).src,
    PIZZA_CARD_PHOTOS.mushroom.src,
  );
});
