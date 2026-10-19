import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderUpdatePayload,
  disconnectUserSockets,
  getSessionExpiry,
  isAllowedRealtimeOrigin,
  publishAdminRefresh,
  publishOrderUpdate,
  readSessionToken,
  scheduleSocketExpiry,
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

test('socket authentication requires a valid, future JWT expiration', () => {
  assert.equal(getSessionExpiry({ exp: 2 }, 1000), 2000);
  assert.equal(getSessionExpiry({}, 1000), null);
  assert.equal(getSessionExpiry({ exp: 1 }, 1000), null);
  assert.equal(getSessionExpiry({ exp: 1.5 }, 1000), null);
  assert.equal(getSessionExpiry({ exp: Number.MAX_SAFE_INTEGER }, 1000), null);
});

test('schedules socket disconnection at expiry and clears the timer on manual disconnect', () => {
  const listeners = new Map();
  const socket = {
    disconnected: false,
    once(event, handler) { listeners.set(event, handler); },
    disconnect(force) {
      this.disconnected = force;
      listeners.get('disconnect')?.();
    },
  };
  let scheduled = null;
  let cancelled = null;
  let unrefCalled = false;
  const timer = { unref() { unrefCalled = true; } };

  assert.equal(scheduleSocketExpiry(socket, 20_000, {
    now: () => 10_000,
    setTimer(callback, delay) { scheduled = { callback, delay }; return timer; },
    clearTimer(handle) { cancelled = handle; },
  }), true);
  assert.equal(scheduled.delay, 10_000);
  assert.equal(unrefCalled, true);

  socket.disconnect(true);
  assert.equal(socket.disconnected, true);
  assert.equal(cancelled, timer);
  scheduled.callback();
  assert.equal(scheduled.delay, 10_000);
});

test('disconnects immediately for an invalid or already-expired session timestamp', () => {
  const socket = { disconnected: false, disconnect(force) { this.disconnected = force; }, once() { throw new Error('must not schedule an expired session'); } };
  assert.equal(scheduleSocketExpiry(socket, 9_999, { now: () => 10_000 }), false);
  assert.equal(socket.disconnected, true);
});

test('long socket sessions use timer-safe chunks and still disconnect at actual expiry', () => {
  const listeners = new Map();
  const socket = {
    disconnected: false,
    once(event, handler) { listeners.set(event, handler); },
    disconnect(force) {
      this.disconnected = force;
      listeners.get('disconnect')?.();
    },
  };
  let now = 1_000;
  const scheduled = [];
  const timerHandles = [];
  const timerAPI = {
    setTimer(callback, delay) {
      const handle = { callback, delay, unref() {} };
      scheduled.push({ callback, delay });
      timerHandles.push(handle);
      return handle;
    },
    clearTimer() {},
  };
  const maxTimerDelay = 2_147_483_647;
  const expiresAt = now + maxTimerDelay + 5_000;

  assert.equal(scheduleSocketExpiry(socket, expiresAt, {
    now: () => now,
    setTimer: timerAPI.setTimer,
    clearTimer: timerAPI.clearTimer,
  }), true);
  assert.equal(scheduled[0].delay, maxTimerDelay);

  now += maxTimerDelay;
  scheduled[0].callback();
  assert.equal(scheduled[1].delay, 5_000);
  now += 5_000;
  scheduled[1].callback();
  assert.equal(socket.disconnected, true);
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
  const fakeIo = { to(room) { return { emit(event, payload) { emitted.push({ room, event, payload }); } } } };
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

test('publishes admin-only refresh events without exposing user data', () => {
  const emitted = [];
  const fakeIo = { to(room) { return { emit(event, payload) { emitted.push({ room, event, payload }); } } } };
  assert.equal(publishAdminRefresh(fakeIo), true);
  assert.deepEqual(emitted, [{ room: 'role:admin', event: 'admin:refresh', payload: {} }]);
  assert.equal(publishAdminRefresh(null), false);
});
