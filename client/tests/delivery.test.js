import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeliveryDetails, mergeRestoredDeliveryDetails } from '../src/delivery.js';

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

test('pending-order restore fills the form from server data without saving the address in browser storage', () => {
  const restored = mergeRestoredDeliveryDetails({}, validDetails);
  assert.equal(restored.recipientName, 'Test Customer');
  assert.equal(restored.phone, '9876543210');
  assert.equal(restored.addressLine, '12 Green Park Road');
  assert.equal(restored.postalCode, '250001');
});

test('pending-order restore preserves any field the customer started editing', () => {
  const restored = mergeRestoredDeliveryDetails({
    recipientName: 'A different recipient',
    phone: '',
    addressLine: '',
    landmark: 'New landmark',
    city: '',
    state: '',
    postalCode: '',
    instructions: '',
  }, validDetails);
  assert.equal(restored.recipientName, 'A different recipient');
  assert.equal(restored.landmark, 'New landmark');
  assert.equal(restored.phone, '9876543210');
  assert.equal(restored.addressLine, '12 Green Park Road');
});

test('pending-order restore rejects invalid server delivery details', () => {
  assert.throws(() => mergeRestoredDeliveryDetails({}, { ...validDetails, postalCode: '000000' }), /6-digit Indian PIN/);
});
