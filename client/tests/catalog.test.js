import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalogResponse } from '../src/catalog.js';

const option = (id, price = 10) => ({ id, name: id, price, available: true });
const validResponse = () => ({
  catalog: {
    bases: [option('classic')],
    sauces: [option('tomato')],
    cheeses: [option('mozzarella')],
    vegetables: [option('onion')],
  },
  featuredPizzas: [{
    id: 'margherita',
    name: 'Margherita',
    description: 'Tomato and cheese',
    price: 249,
    tag: 'BESTSELLER',
    ingredients: { base: 'classic', sauce: 'tomato', cheese: 'mozzarella', vegetables: ['onion'] },
  }],
});

test('catalog response accepts a complete server-sourced menu', () => {
  const response = validResponse();
  assert.deepEqual(normalizeCatalogResponse(response), response);
});

test('catalog response rejects missing groups and empty live menus', () => {
  assert.throws(() => normalizeCatalogResponse(null), /incomplete/);
  assert.throws(() => normalizeCatalogResponse({ catalog: {}, featuredPizzas: [] }), /incomplete/);
  const response = validResponse();
  delete response.catalog.cheeses;
  assert.throws(() => normalizeCatalogResponse(response), /missing valid cheeses/);
});

test('catalog response rejects missing or invalid prices instead of displaying defaults', () => {
  const response = validResponse();
  response.catalog.bases[0].price = Number.NaN;
  assert.throws(() => normalizeCatalogResponse(response), /missing valid bases/);

  const malformed = validResponse();
  delete malformed.featuredPizzas[0].price;
  assert.throws(() => normalizeCatalogResponse(malformed), /invalid featured pizza/);
});

test('catalog response rejects invalid IDs and negative prices', () => {
  const badId = validResponse();
  badId.catalog.sauces[0].id = '';
  assert.throws(() => normalizeCatalogResponse(badId), /missing valid sauces/);

  const negativePrice = validResponse();
  negativePrice.catalog.vegetables[0].price = -1;
  assert.throws(() => normalizeCatalogResponse(negativePrice), /missing valid vegetables/);
});
