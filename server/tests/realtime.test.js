import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderUpdatePayload,
  disconnectUserSockets,
  isAllowedRealtimeOrigin,
  publishOrderUpdate,
  readSessionToken,
} from '../src/services/realtime.js';

test('reads only the pizza session cookie and URL-decodes it', () => {
  assert.equal(readSessionToken('theme=dark; pizza_session=abc%2E123; other=value'), 'abc.123');
  assert.equal(readSessionToken('theme=dark; other=value'), null);
  assert.equal(readSessionToken('pizza_session=%ZZ'), null);
});

test('realtime origin check requires an exact allow-listed origin', () => {
  const allowed = ['http://localhost:5173', 'https://pizza.example.test'];
  assert.equal(isAllowedRealtimeOrigin('http://localhost:5173', allowed), true);
  assert.equal(isAllowedRealtimeOrigin('https://pizza.example.test', allowed), true);
  assert.equal(isAllowedRealtimeOrigin('https://evil.example.test', allowed), false);
  assert.equal(isAllowedRealtimeOrigin(undefined, allowed), false);
});

test('order update payload contains only safe fields needed by the UI', () => {
  const payload = buildOrderUpdatePayload({
    _id: 'order-1',
    user: { _id: 'user-1', email: 'private@example.test' },
    orderNumber: 'PH-1234',
    status: 'in_kitchen',
    paymentStatus: 'paid',
    updatedAt: new Date('2026-10-19T10:00:00.000Z'),
    total: 999,
    razorpayPaymentId: 'payment-secret',
  });
  assert.deepEqual(payload, {
    id: 'order-1',
    orderNumber: 'PH-1234',
    status: 'in_kitchen',
    paymentStatus: 'paid',
    updatedAt: '2026-10-19T10:00:00.000Z',
  });
  assert.equal(JSON.stringify(payload).includes('private@example.test'), false);
  assert.equal(JSON.stringify(payload).includes('payment-secret'), false);
});

test('publishes a persisted order update only to its owner room and admin room', () => {
  const emitted = [];
  const fakeIo = {
    to(room) {
      return { emit(event, payload) { emitted.push({ room, event, payload }); } };
    },
  };
  const order = {
    _id: 'order-2',
    user: { _id: 'user-2' },
    orderNumber: 'PH-5678',
    status: 'sent_to_delivery',
    paymentStatus: 'paid',
  };
  assert.equal(publishOrderUpdate(order, fakeIo), true);
  assert.deepEqual(emitted.map(({ room, event }) => ({ room, event })), [
    { room: 'user:user-2', event: 'order:update' },
    { room: 'role:admin', event: 'order:update' },
  ]);
  assert.deepEqual(emitted[0].payload, emitted[1].payload);
});

test('does not emit malformed order updates or updates without a realtime server', () => {
  const emitted = [];
  const fakeIo = { to(room) { return { emit(event, payload) { emitted.push({ room, event, payload }); } }; } };
  assert.equal(publishOrderUpdate(null, fakeIo), false);
  assert.equal(publishOrderUpdate({ _id: 'order-3', status: 'paid', paymentStatus: 'paid' }, fakeIo), false);
  assert.equal(publishOrderUpdate({ _id: 'order-3', user: 'user-3', status: 'paid', paymentStatus: 'paid' }, null), false);
  assert.equal(emitted.length, 0);
});

test('disconnects every socket in the authenticated user room', async () => {
  const rooms = [];
  const sockets = [
    { disconnected: false, disconnect(force) { this.disconnected = force; } },
    { disconnected: false, disconnect(force) { this.disconnected = force; } },
  ];
  const fakeIo = {
    in(room) {
      rooms.push(room);
      return { fetchSockets: async () => sockets };
    },
  };
  assert.equal(await disconnectUserSockets('user-9', fakeIo), 2);
  assert.deepEqual(rooms, ['user:user-9']);
  assert.deepEqual(sockets.map((socket) => socket.disconnected), [true, true]);
  assert.equal(await disconnectUserSockets('user-9', null), 0);
});
