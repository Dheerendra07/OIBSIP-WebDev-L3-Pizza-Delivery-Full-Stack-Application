import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURED_PIZZAS, CATALOG } from '../src/utils/catalog.js';
import { buildOrderItem, buildOrderItems, calculateOrderTotals, resolveFulfillmentMode, validateOrderStatusTransition, validateDeliveryDetails } from '../src/utils/orderRules.js';

test('featured pizza uses the server-owned price, recipe and stock requirements', () => {
  const item = buildOrderItem({ type: 'featured', pizzaId: 'margherita', quantity: 2, unitPrice: 1, lineTotal: 2, inventoryKeys: ['attacker:controlled'] });
  const pizza = FEATURED_PIZZAS.find((entry) => entry.id === 'margherita');
  assert.equal(item.unitPrice, pizza.price);
  assert.equal(item.lineTotal, pizza.price * 2);
  assert.deepEqual(item.ingredients, pizza.ingredients);
  assert.ok(item.inventoryKeys.includes(CATALOG.bases[0].inventoryKey));
  assert.ok(item.inventoryKeys.every((key) => !key.startsWith('attacker:')));
});

test('custom order line ignores client prices and computes totals from allowed ingredients', () => {
  const item = buildOrderItem({ type: 'custom', base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['onion', 'corn'], quantity: 2, unitPrice: 0, lineTotal: 0, inventoryKeys: [] });
  assert.equal(item.unitPrice, 259);
  assert.equal(item.lineTotal, item.unitPrice * 2);
  assert.ok(item.inventoryKeys.length > 0);
});

test('malformed order collections return a client error and have explicit line limits', () => {
  assert.throws(() => buildOrderItems(undefined), { message: 'An order must contain 1–12 pizza lines', statusCode: 400 });
  assert.throws(() => buildOrderItems([]), { statusCode: 400 });
  assert.throws(() => buildOrderItems(Array.from({ length: 13 }, () => ({ type: 'featured', pizzaId: 'margherita' }))), { statusCode: 400 });
  assert.throws(() => buildOrderItem(null), { statusCode: 400 });
});

test('invalid custom-pizza choices map to a client validation error instead of HTTP 500', () => {
  const base = { type: 'custom', base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['onion'], quantity: 1 };
  for (const invalid of [
    { ...base, base: 'not-a-base' },
    { ...base, sauce: 'not-a-sauce' },
    { ...base, cheese: 'not-a-cheese' },
    { ...base, vegetables: ['not-a-vegetable'] },
    { ...base, quantity: 11 },
    { ...base, vegetables: ['onion', 'corn', 'olive', 'tomato', 'jalapeno', 'mushroom'] },
  ]) {
    assert.throws(() => buildOrderItem(invalid), { statusCode: 400 });
  }
});

test('order totals calculate free delivery from server-computed subtotal', () => {
  assert.deepEqual(calculateOrderTotals([buildOrderItem({ type: 'featured', pizzaId: 'margherita' }), buildOrderItem({ type: 'featured', pizzaId: 'margherita' })]), { subtotal: 498, deliveryFee: 29, total: 527 });
  assert.deepEqual(calculateOrderTotals([buildOrderItem({ type: 'featured', pizzaId: 'margherita' }), buildOrderItem({ type: 'featured', pizzaId: 'garden' })]), { subtotal: 578, deliveryFee: 0, total: 578 });
});

test('test orders use a clearly simulated workflow and cannot enter live fulfillment', () => {
  assert.equal(resolveFulfillmentMode('test', 'test'), 'simulated');
  assert.equal(resolveFulfillmentMode('live', 'live'), 'live');
  assert.equal(resolveFulfillmentMode('live', 'test'), null);
  assert.equal(resolveFulfillmentMode('test', 'live'), null);
  assert.equal(resolveFulfillmentMode('unknown', 'test'), null);
});

test('fulfillment allows only the next status for paid orders', () => {
  assert.deepEqual(validateOrderStatusTransition({ status: 'order_received', paymentStatus: 'paid' }, 'in_kitchen'), { allowed: true });
  assert.equal(validateOrderStatusTransition({ status: 'order_received', paymentStatus: 'paid' }, 'delivered').statusCode, 400);
  assert.equal(validateOrderStatusTransition({ status: 'delivered', paymentStatus: 'paid' }, 'in_kitchen').allowed, false);
  assert.equal(validateOrderStatusTransition({ status: 'order_received', paymentStatus: 'pending' }, 'in_kitchen').statusCode, 409);
});

const validDeliveryDetails = {
  recipientName: 'Dheerendra Singh',
  phone: '98765 43210',
  addressLine: '12 Green Park Road',
  landmark: 'Near central market',
  city: 'Meerut',
  state: 'Uttar Pradesh',
  postalCode: '250001',
  instructions: 'Call on arrival',
};

test('delivery details are normalized and validated before checkout', () => {
  assert.deepEqual(validateDeliveryDetails(validDeliveryDetails), {
    recipientName: 'Dheerendra Singh',
    phone: '9876543210',
    addressLine: '12 Green Park Road',
    landmark: 'Near central market',
    city: 'Meerut',
    state: 'Uttar Pradesh',
    postalCode: '250001',
    instructions: 'Call on arrival',
  });
});

test('delivery details reject missing addresses, invalid mobile numbers and invalid PIN codes', () => {
  assert.throws(() => validateDeliveryDetails(null), { statusCode: 400 });
  assert.throws(() => validateDeliveryDetails({ ...validDeliveryDetails, addressLine: '  ' }), { statusCode: 400 });
  assert.throws(() => validateDeliveryDetails({ ...validDeliveryDetails, phone: '1234567890' }), { statusCode: 400 });
  assert.throws(() => validateDeliveryDetails({ ...validDeliveryDetails, postalCode: '000000' }), { statusCode: 400 });
  assert.throws(() => validateDeliveryDetails({ ...validDeliveryDetails, instructions: 'x'.repeat(201) }), { statusCode: 400 });
});
