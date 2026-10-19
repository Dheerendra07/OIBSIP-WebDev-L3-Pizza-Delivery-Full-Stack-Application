export function isMailConfigured(env = process.env) { return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS); }
