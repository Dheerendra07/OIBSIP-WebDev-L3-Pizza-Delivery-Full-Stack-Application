const SAFE_PROVIDER_CODE = /^[A-Za-z0-9_-]{1,80}$/;

function safeProviderCode(value) {
  return typeof value === 'string' && SAFE_PROVIDER_CODE.test(value) ? value : null;
}

/** Keep provider diagnostics to a status code and constrained provider code only. */
export function getSafeRazorpayDiagnostics(error) {
  const rawStatus = Number(error?.statusCode ?? error?.status);
  const upstreamStatus = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : null;
  const providerCode = safeProviderCode(error?.error?.code) ||
    safeProviderCode(error?.code) ||
    null;
  return { upstreamStatus, providerCode };
}

/**
 * Convert upstream Razorpay checkout-order errors to our own API contract.
 * Provider 401/403 responses are not customer-authentication failures and must
 * never be returned as HTTP 401 to the browser.
 */
export function mapRazorpayOrderCreationError(error) {
  const diagnostics = getSafeRazorpayDiagnostics(error);
  const credentialsRejected = diagnostics.upstreamStatus === 401 || diagnostics.upstreamStatus === 403;

  const providerCode = diagnostics.providerCode;


  return {
    statusCode: 502,
    safeToExpose: true,
    code: credentialsRejected ? 'RAZORPAY_TEST_CREDENTIALS_REJECTED' : 'RAZORPAY_ORDER_CREATION_FAILED',
    message: credentialsRejected
      ? 'Razorpay rejected the configured Test Mode credentials. Check that RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are the matching Test Mode pair. No payment was started.'
      : 'Razorpay could not create the checkout order. No payment was started; please retry later.',
    diagnostics,
  };
}
