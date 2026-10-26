import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPaymentProvider, updateInventory, updateOrderStatus, createStaff, setStaffActive, assignOrderStaff, sendAdminTestEmail } from '../src/controllers/adminController.js';
import { setRazorpayClientFactoryForIntegrationTests } from '../src/services/payments.js';

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('inventory updates reject an absent or non-object request body without a database lookup', async () => {
  for (const body of [undefined, null, [], 'invalid']) {
    const res = responseRecorder();
    let nextError;
    await updateInventory({ params: { key: 'base:classic' }, body }, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: 'Provide stock or lowStockThreshold to update' });
  }
});

test('inventory updates reject invalid counts before a database lookup', async () => {
  const res = responseRecorder();
  let nextError;
  await updateInventory({ params: { key: 'base:classic' }, body: { stock: -1 } }, res, (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'Stock must be a whole number between 0 and 10,000,000' });
});

test('order status updates reject an absent or malformed status before a database lookup', async () => {
  for (const body of [undefined, null, [], {}, { status: ['delivered'] }, { status: '   ' }]) {
    const res = responseRecorder();
    let nextError;
    await updateOrderStatus({ params: { id: 'invalid-order-id' }, body }, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: 'A valid order status is required' });
  }
});


test('admin payment-provider check performs a read-only order lookup and never returns provider data', async () => {
  let requestOptions;
  const restore = setRazorpayClientFactoryForIntegrationTests(() => ({
    orders: {
      async all(options) {
        requestOptions = options;
        return { entity: 'collection', items: [{ id: 'order_PRIVATE_PROVIDER_DATA' }] };
      },
    },
  }));
  try {
    const res = responseRecorder();
    await checkPaymentProvider({}, res, (error) => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(requestOptions, { count: 1 });
    assert.equal(res.payload.status, 'connected');
    assert.equal(res.payload.mode, 'test');
    assert.equal(typeof res.payload.checkedAt, 'string');
    assert.equal(JSON.stringify(res.payload).includes('order_PRIVATE_PROVIDER_DATA'), false);
  } finally {
    restore();
  }
});

test('admin payment-provider check sanitizes provider failures', async () => {
  const restore = setRazorpayClientFactoryForIntegrationTests(() => ({
    orders: {
      async all() {
        throw new Error('provider response included PRIVATE_KEY_DATA');
      },
    },
  }));
  try {
    const res = responseRecorder();
    await checkPaymentProvider({}, res, (error) => { throw error; });
    assert.equal(res.statusCode, 502);
    assert.equal(res.payload.status, 'unavailable');
    assert.equal(res.payload.mode, 'test');
    assert.equal(JSON.stringify(res.payload).includes('PRIVATE_KEY_DATA'), false);
  } finally {
    restore();
  }
});


test('staff provisioning rejects malformed account details before touching user storage', async () => {
  const cases = [
    [{ name: 'A', email: 'bad', password: 'StrongPass123', role: 'kitchen' }, 400, /Staff name/],
    [{ name: 'Kitchen User', email: 'bad', password: 'StrongPass123', role: 'kitchen' }, 400, /valid staff email/],
    [{ name: 'Kitchen User', email: 'kitchen@example.test', password: 'StrongPass123', role: 'admin' }, 400, /Kitchen staff or Delivery staff/],
    [{ name: 'Kitchen User', email: 'kitchen@example.test', password: 'weak', role: 'kitchen' }, 400, /Password must be/],
  ];
  for (const [body, expectedStatus, expectedMessage] of cases) {
    const res = responseRecorder();
    let nextError;
    await createStaff({ body }, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, expectedStatus);
    assert.match(res.payload.error, expectedMessage);
  }
});

test('staff active and order assignment endpoints reject invalid identifiers or request shapes before database lookup', async () => {
  for (const [handler, req] of [
    [setStaffActive, { params: { id: 'invalid' }, body: { active: false } }],
    [setStaffActive, { params: { id: '507f1f77bcf86cd799439011' }, body: { active: 'false' } }],
    [assignOrderStaff, { params: { id: 'invalid' }, body: { kitchenStaffId: null } }],
    [assignOrderStaff, { params: { id: '507f1f77bcf86cd799439011' }, body: {} }],
  ]) {
    const res = responseRecorder();
    let nextError;
    await handler(req, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 400);
  }
});

const MAIL_ENV_KEYS = ['RESEND_API_KEY', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
async function withMailTestEnvironment(values, callback) {
  const previous = Object.fromEntries(MAIL_ENV_KEYS.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  for (const key of MAIL_ENV_KEYS) {
    if (Object.hasOwn(values, key)) process.env[key] = values[key];
    else delete process.env[key];
  }
  try {
    await callback();
  } finally {
    for (const key of MAIL_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    globalThis.fetch = originalFetch;
  }
}

test('admin test-email endpoint refuses to send when no mail provider is configured', async () => {
  await withMailTestEnvironment({}, async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; throw new Error('Must not call a provider'); };
    const res = responseRecorder();
    let nextError;
    await sendAdminTestEmail({ user: { email: 'admin@example.test' } }, res, (error) => { nextError = error; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 503);
    assert.match(res.payload.error, /not configured/i);
    assert.equal(fetchCalls, 0);
  });
});

test('admin test email goes only to the signed-in admin and describes provider acceptance honestly', async () => {
  await withMailTestEnvironment({
    RESEND_API_KEY: 're_test_admin_mail',
    MAIL_FROM: 'Pizza House <orders@example.test>',
  }, async () => {
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ id: 'email_test_admin' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const res = responseRecorder();
    await sendAdminTestEmail({ user: { email: 'ADMIN@example.test' } }, res, (error) => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.deepEqual(request.body.to, ['admin@example.test']);
    assert.equal(request.body.subject, 'Pizza House email delivery test');
    assert.match(request.body.text, /authenticated Pizza House administrator/i);
    assert.match(request.body.text, /does not confirm final inbox delivery/i);
    assert.equal(res.payload.status, 'accepted');
    assert.match(res.payload.message, /does not guarantee final inbox delivery/i);
    assert.equal(JSON.stringify(res.payload).includes('re_test_admin_mail'), false);
  });
});

test('admin test email sanitizes email-provider rejection details', async () => {
  await withMailTestEnvironment({
    RESEND_API_KEY: 're_test_admin_mail',
    MAIL_FROM: 'Pizza House <orders@example.test>',
  }, async () => {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ message: 'PRIVATE_PROVIDER_RESPONSE_BODY' }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    );

    const res = responseRecorder();
    await sendAdminTestEmail({ user: { email: 'admin@example.test' } }, res, (error) => { throw error; });
    assert.equal(res.statusCode, 502);
    assert.match(res.payload.error, /verified sender address/i);
    assert.equal(JSON.stringify(res.payload).includes('PRIVATE_PROVIDER_RESPONSE_BODY'), false);
  });
});
