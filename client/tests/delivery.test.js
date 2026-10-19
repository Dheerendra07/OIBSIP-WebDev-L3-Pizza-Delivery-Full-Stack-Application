import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeliveryDetails } from '../src/delivery.js';

const validDetails = {
  recipientName: '  Test   Customer ',
  phone: '98765 43210',
  addressLine: ' 12   Green Park Road ',
  landmark: ' Near Central Market ',
  city: 'Meerut',
  state: 'Uttar Pradesh',
  postalCode: '250001',
  instructions: ' Call on arrival ',
};

test('delivery form normalizes text and Indian mobile formatting', () => {
  assert.deepEqual(normalizeDeliveryDetails(validDetails), {
    recipientName: 'Test Customer',
    phone: '9876543210',
    addressLine: '12 Green Park Road',
    landmark: 'Near Central Market',
    city: 'Meerut',
    state: 'Uttar Pradesh',
    postalCode: '250001',
    instructions: 'Call on arrival',
  });
});

test('delivery form rejects malformed and incomplete destination details', () => {
  assert.throws(() => normalizeDeliveryDetails(null), /complete delivery address/);
  assert.throws(() => normalizeDeliveryDetails({ ...validDetails, phone: '1234567890' }), /10-digit Indian mobile/);
  assert.throws(() => normalizeDeliveryDetails({ ...validDetails, addressLine: 'road' }), /complete street address/);
  assert.throws(() => normalizeDeliveryDetails({ ...validDetails, postalCode: '000000' }), /6-digit Indian PIN/);
  assert.throws(() => normalizeDeliveryDetails({ ...validDetails, city: 'X' }), /valid city/);
  assert.throws(() => normalizeDeliveryDetails({ ...validDetails, instructions: 'x'.repeat(201) }), /at most 200/);
});
