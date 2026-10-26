import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMail } from '../src/services/email.js';

const keys = ['RESEND_API_KEY', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
async function withEnvironment(values, callback) {
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  for (const key of keys) {
    if (Object.hasOwn(values, key)) process.env[key] = values[key];
    else delete process.env[key];
  }
  try {
    await callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    globalThis.fetch = originalFetch;
  }
}

test('sendMail uses Resend HTTPS API and returns its receipt', async () => {
  await withEnvironment({
    RESEND_API_KEY: 're_test_example',
    MAIL_FROM: 'Pizza House <orders@example.test>',
  }, async () => {
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: 'email_test_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await sendMail({
      to: 'customer@example.test',
      subject: 'Verify your Pizza House email',
      text: 'Use the link to verify your account.',
      html: '<p>Use the link to verify your account.</p>',
      idempotencyKey: 'pizza-house:test:email-service:once',
    });

    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer re_test_example');
    assert.equal(request.options.headers['Idempotency-Key'], 'pizza-house:test:email-service:once');
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.from, 'Pizza House <orders@example.test>');
    assert.deepEqual(payload.to, ['customer@example.test']);
    assert.equal(payload.subject, 'Verify your Pizza House email');
    assert.equal(result.id, 'email_test_123');
  });
});

test('sendMail surfaces an HTTP status without leaking provider response details', async () => {
  await withEnvironment({
    RESEND_API_KEY: 're_test_example',
    MAIL_FROM: 'Pizza House <orders@example.test>',
  }, async () => {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ message: 'sensitive provider detail', name: 'validation_error' }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    );

    await assert.rejects(
      () => sendMail({ to: 'customer@example.test', subject: 'Test', text: 'Test' }),
      error => {
        assert.match(error.message, /HTTP 422/);
        assert.doesNotMatch(error.message, /sensitive provider detail/);
        return true;
      },
    );
  });
});
