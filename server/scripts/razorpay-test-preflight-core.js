const configured = (value) => typeof value === 'string' && value.trim().length > 0;
const placeholder = /replace-with|change-this|your[-_ ]|<[^>]+>/i;

function safeConfigured(value) {
  return configured(value) && !placeholder.test(value.trim());
}

/**
 * Configuration checks used by the read-only Razorpay Test Mode preflight.
 * The result contains labels and help text only—never environment values.
 */
export function inspectRazorpayPreflightEnvironment(env = process.env) {
  const keyId = typeof env.RAZORPAY_KEY_ID === 'string' ? env.RAZORPAY_KEY_ID.trim() : '';
  const keySecret = typeof env.RAZORPAY_KEY_SECRET === 'string' ? env.RAZORPAY_KEY_SECRET.trim() : '';
  const webhookSecret = typeof env.RAZORPAY_WEBHOOK_SECRET === 'string' ? env.RAZORPAY_WEBHOOK_SECRET.trim() : '';

  return [
    {
      label: 'Non-production environment',
      ok: env.NODE_ENV !== 'production',
      detail: 'Run this preflight from a local/test environment, not from production.',
    },
    {
      label: 'Razorpay Test Mode key ID',
      ok: /^rzp_test_\S+$/.test(keyId),
      detail: 'Set RAZORPAY_KEY_ID to a key ID beginning with rzp_test_. Live keys are rejected.',
    },
    {
      label: 'Razorpay key secret',
      ok: safeConfigured(keySecret),
      detail: 'Set the matching Razorpay Test Mode RAZORPAY_KEY_SECRET in server/.env.',
    },
    {
      label: 'Separate webhook secret',
      ok: safeConfigured(webhookSecret) && webhookSecret !== keySecret,
      detail: 'Set the webhook secret configured in the Razorpay dashboard; it must not be the API key secret.',
    },
  ];
}

/**
 * Authenticate with one read-only API call. No provider order, payment or refund
 * is created. Response bodies and credentials are deliberately never returned.
 */
export async function checkRazorpayTestCredentials({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const checks = inspectRazorpayPreflightEnvironment(env);
  if (checks.some((check) => !check.ok)) {
    return { ok: false, checks };
  }

  const authorization = `Basic ${Buffer.from(
    `${env.RAZORPAY_KEY_ID.trim()}:${env.RAZORPAY_KEY_SECRET.trim()}`,
  ).toString('base64')}`;

  try {
    const response = await fetchImpl('https://api.razorpay.com/v1/orders?count=1', {
      method: 'GET',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    let validCollection = false;
    if (response.ok) {
      const body = await response.json().catch(() => null);
      validCollection = Boolean(body && typeof body === 'object' && Array.isArray(body.items));
    }

    checks.push({
      label: 'Razorpay Test Mode API authentication',
      ok: response.ok && validCollection,
      detail: response.ok
        ? validCollection
          ? 'The read-only Test Mode orders request succeeded.'
          : 'Razorpay returned an unexpected response shape; no response data was printed.'
        : `Razorpay rejected the read-only request (HTTP ${response.status}); verify the Test Mode key pair.`,
    });
  } catch {
    checks.push({
      label: 'Razorpay Test Mode API authentication',
      ok: false,
      detail: 'The read-only request failed or timed out. Check outbound HTTPS and provider availability.',
    });
  }

  return { ok: checks.every((check) => check.ok), checks };
}
