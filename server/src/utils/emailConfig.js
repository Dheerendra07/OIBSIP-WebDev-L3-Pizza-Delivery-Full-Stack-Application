export function isResendMailConfigured(env = process.env) {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

export function isSmtpMailConfigured(env = process.env) {
  // A transport without a configured sender can authenticate successfully but
  // still be rejected by the mail provider. Do not report it as ready.
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM);
}

export function isMailConfigured(env = process.env) {
  return isResendMailConfigured(env) || isSmtpMailConfigured(env);
}
