const requiredForProduction = ['MONGODB_URI', 'JWT_SECRET', 'CLIENT_ORIGIN', 'CLIENT_BASE_URL', 'APP_BASE_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'ADMIN_ALERT_EMAIL'];
const validSameSiteValues = new Set(['strict', 'lax', 'none']);

function isExactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isHttpsBaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value.replace(/\/$/, '') && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validateEnv(env = process.env) {
  if (env.NODE_ENV === 'production') {
    const missing = requiredForProduction.filter((key) => !env[key]);
    if (missing.length) throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
    if ((env.JWT_SECRET || '').length < 32 || /replace-with|change-this|example/i.test(env.JWT_SECRET || '')) throw new Error('JWT_SECRET must be a strong, unique value of at least 32 characters');
    const allowedOrigins = String(env.CLIENT_ORIGIN || '').split(',').map((origin) => origin.trim());
    if (allowedOrigins.some((origin) => !isExactHttpsOrigin(origin))) {
      throw new Error('Each CLIENT_ORIGIN must be an exact HTTPS origin without paths, query strings, fragments, or wildcards in production');
    }
    for (const key of ['CLIENT_BASE_URL', 'APP_BASE_URL']) {
      if (!isHttpsBaseUrl(env[key])) throw new Error(`${key} must be a valid HTTPS origin without a path, query, or fragment in production`);
    }
  }
  if (env.RAZORPAY_KEY_ID && !String(env.RAZORPAY_KEY_ID).startsWith('rzp_test_')) throw new Error('This project is configured for Razorpay test mode; RAZORPAY_KEY_ID must start with rzp_test_');
  if (env.COOKIE_SAME_SITE && !validSameSiteValues.has(String(env.COOKIE_SAME_SITE).toLowerCase())) throw new Error('COOKIE_SAME_SITE must be strict, lax, or none');
  if (String(env.COOKIE_SAME_SITE || '').toLowerCase() === 'none' && env.NODE_ENV !== 'production') throw new Error('COOKIE_SAME_SITE=none requires production HTTPS; use strict or lax for local development');
  if (env.JWT_SECRET && env.JWT_SECRET.length < 32 && env.NODE_ENV !== 'test') console.warn('Warning: JWT_SECRET should be at least 32 characters.');
}
