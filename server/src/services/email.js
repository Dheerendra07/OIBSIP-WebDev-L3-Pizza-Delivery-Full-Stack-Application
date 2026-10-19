import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { isMailConfigured } from '../utils/emailConfig.js';

let transport;
function getTransport() {
  if (transport) return transport;
  if (!isMailConfigured()) return null;
  transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE || 'false') === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  return transport;
}
export async function sendMail({ to, subject, text, html }) {
  const mailer = getTransport();
  if (!mailer) { if (config.nodeEnv === 'development') { console.warn(`[email unavailable] Configure SMTP to send: ${subject} to ${to}`); return { skipped: true }; } throw new Error('Email delivery is not configured'); }
  return mailer.sendMail({ from: process.env.MAIL_FROM || 'Pizza House <no-reply@example.com>', to, subject, text, html });
}
export function verificationEmailUrl(token) { return `${config.appBaseUrl}/api/auth/verify-email/${encodeURIComponent(token)}`; }
export function passwordResetUrl(token) { return `${config.clientBaseUrl}/?resetToken=${encodeURIComponent(token)}`; }
