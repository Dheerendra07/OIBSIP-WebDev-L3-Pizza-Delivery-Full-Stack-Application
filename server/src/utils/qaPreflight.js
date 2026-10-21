const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const senderPattern = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/;
const placeholderPattern = /replace-with|change-this|your[-_ ]|<[^>]+>/i;

function isConfigured(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeConfiguredValue(value) {
  return isConfigured(value) && !placeholderPattern.test(value.trim());
}

function isExactWebOrigin(value) {
  if (!isConfigured(value)) return false;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol)
      && url.origin === value.trim()
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function isMongoUri(value) {
  return isSafeConfiguredValue(value)
    && /^(mongodb:\/\/|mongodb\+srv:\/\/)/i.test(value.trim());
}

function hasStrongPassword(value) {
  return typeof value === 'string'
    && value.length >= 10
    && value.length <= 72
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value);
}

export function inspectQaEnvironment(env = process.env) {
  const sections = [
    { name: 'Local app and database', checks: [] },
    { name: 'Admin test account', checks: [] },
    { name: 'Email verification and notifications', checks: [] },
    { name: 'Razorpay Test Mode', checks: [] },
  ];

  const add = (sectionIndex, label, ok, detail) => {
    sections[sectionIndex].checks.push({ label, ok: Boolean(ok), detail });
  };

  add(0, 'Safe environment', env.NODE_ENV !== 'production',
    'Use a dedicated local/test environment, never production secrets.');
  add(0, 'MONGODB_URI', isMongoUri(env.MONGODB_URI),
    'Set a MongoDB URI (mongodb:// or mongodb+srv://); connectivity is not tested here.');
  add(0, 'JWT_SECRET', isSafeConfiguredValue(env.JWT_SECRET) && env.JWT_SECRET.length >= 32,
    'Set a unique, non-placeholder secret of at least 32 characters.');
  const origins = isConfigured(env.CLIENT_ORIGIN)
    ? env.CLIENT_ORIGIN.split(',').map(value => value.trim())
    : [];
  add(0, 'CLIENT_ORIGIN', origins.length > 0 && origins.every(isExactWebOrigin),
    'Use comma-separated exact HTTP(S) origins without paths or trailing slashes.');
  add(0, 'CLIENT_BASE_URL', isExactWebOrigin(env.CLIENT_BASE_URL),
    'Set an exact frontend HTTP(S) origin without a path or trailing slash.');
  add(0, 'APP_BASE_URL', isExactWebOrigin(env.APP_BASE_URL),
    'Set an exact API HTTP(S) origin without a path or trailing slash.');

  add(1, 'ADMIN_EMAIL', isConfigured(env.ADMIN_EMAIL) && emailPattern.test(env.ADMIN_EMAIL.trim()),
    'Set a valid dedicated test-admin email address.');
  add(1, 'ADMIN_PASSWORD', hasStrongPassword(env.ADMIN_PASSWORD),
    'Use 10–72 characters with uppercase, lowercase and a number.');

  const hasResend = isSafeConfiguredValue(env.RESEND_API_KEY) && isConfigured(env.MAIL_FROM);
  const hasSmtp = isSafeConfiguredValue(env.SMTP_HOST)
    && isSafeConfiguredValue(env.SMTP_USER)
    && isSafeConfiguredValue(env.SMTP_PASS);
  add(2, 'Email provider credentials', hasResend || hasSmtp,
    'Configure Resend RESEND_API_KEY + MAIL_FROM, or complete SMTP_HOST + SMTP_USER + SMTP_PASS. Resend HTTP API is preferred on Render Free.');
  add(2, 'RESEND_API_KEY (when used)', !isConfigured(env.RESEND_API_KEY) || isSafeConfiguredValue(env.RESEND_API_KEY),
    'Leave empty when using SMTP, or set the Resend API key without printing it in logs.');
  const anySmtpCredentials = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].some(key => isConfigured(env[key]));
  const smtpPort = Number(env.SMTP_PORT);
  const smtpExtrasValid = (!isConfigured(env.SMTP_PORT) || (Number.isInteger(smtpPort) && smtpPort >= 1 && smtpPort <= 65535))
    && (!isConfigured(env.SMTP_SECURE) || ['true', 'false'].includes(String(env.SMTP_SECURE).trim().toLowerCase()));
  add(2, 'Optional SMTP settings', !anySmtpCredentials || (hasSmtp && smtpExtrasValid),
    'If using SMTP, configure all credentials and a valid optional port/security value; leave them empty to use Resend.');
  add(2, 'MAIL_FROM', isConfigured(env.MAIL_FROM) && senderPattern.test(env.MAIL_FROM),
    'Set a sender name/address containing a valid email address. The sender must be verified with the provider.');
  add(2, 'ADMIN_ALERT_EMAIL', isConfigured(env.ADMIN_ALERT_EMAIL) && emailPattern.test(env.ADMIN_ALERT_EMAIL.trim()),
    'Set a valid destination for low-stock alerts.');

  add(3, 'RAZORPAY_KEY_ID', isConfigured(env.RAZORPAY_KEY_ID) && /^rzp_test_[^\s]+$/.test(env.RAZORPAY_KEY_ID.trim()),
    'Use a Razorpay Test Mode key ID beginning with rzp_test_. Live keys are not accepted.');
  add(3, 'RAZORPAY_KEY_SECRET', isSafeConfiguredValue(env.RAZORPAY_KEY_SECRET),
    'Set the matching Razorpay Test Mode key secret.');
  add(3, 'RAZORPAY_WEBHOOK_SECRET', isSafeConfiguredValue(env.RAZORPAY_WEBHOOK_SECRET),
    'Set the separate webhook secret configured in the Razorpay dashboard.');

  const checks = sections.flatMap(section => section.checks);
  return {
    ok: checks.every(check => check.ok),
    sections,
    passed: checks.filter(check => check.ok).length,
    total: checks.length,
  };
}
