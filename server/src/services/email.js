import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { isMailConfigured, isResendMailConfigured, isSmtpMailConfigured } from '../utils/emailConfig.js';

let transport;
function getSmtpTransport() {
  if (transport) return transport;
  if (!isSmtpMailConfigured()) return null;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transport;
}

async function sendViaResend({ to, subject, text, html, idempotencyKey }) {
  const headers = {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  };
  // Resend replays the first successful request for this key for 24 hours.
  // Keep the key stable across retries of the same persisted outbox entry.
  if (typeof idempotencyKey === 'string' && idempotencyKey.length > 0 && idempotencyKey.length <= 256) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('Email provider could not be reached. Retry the action later.');
  }

  if (!response.ok) {
    // Keep the provider response body private; it can contain sender and request details.
    throw new Error(`Email provider rejected the request (HTTP ${response.status}). Check sender verification and email API configuration.`);
  }
  return response.json().catch(() => ({ accepted: true }));
}

export async function sendMail({ to, subject, text, html, idempotencyKey }) {
  if (isResendMailConfigured()) return sendViaResend({ to, subject, text, html, idempotencyKey });

  const mailer = getSmtpTransport();
  if (!mailer || !isMailConfigured()) {
    if (config.nodeEnv === 'development') {
      console.warn(`[email unavailable] Configure Resend HTTP API or SMTP to send: ${subject} to ${to}`);
      return { skipped: true };
    }
    throw new Error('Email delivery is not configured');
  }
  return mailer.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject,
    text,
    html,
  });
}

export function verificationEmailUrl(token) { return `${config.appBaseUrl}/api/auth/verify-email/${encodeURIComponent(token)}`; }
export function passwordResetUrl(token) { return `${config.clientBaseUrl}/?resetToken=${encodeURIComponent(token)}`; }
