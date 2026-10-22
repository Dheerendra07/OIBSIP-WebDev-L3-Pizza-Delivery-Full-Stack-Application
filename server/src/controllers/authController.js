import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createOpaqueToken, hashToken } from '../utils/tokens.js';
import { hashPassword, isStrongEnough, verifyPassword } from '../utils/password.js';
import { issueSession, clearSession } from '../middleware/auth.js';
import { sendMail, verificationEmailUrl, passwordResetUrl } from '../services/email.js';
import { isMailConfigured } from '../utils/emailConfig.js';
import { config } from '../config/env.js';
import { disconnectCurrentSessionSockets, disconnectUserSockets } from '../services/realtime.js';

const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role });

export const register = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const name = String(body.name || '').trim(); const email = String(body.email || '').trim().toLowerCase(); const password = body.password;
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Name must be between 2 and 80 characters' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!isStrongEnough(password)) return res.status(400).json({ error: 'Password must be 10–72 characters with uppercase, lowercase and a number' });
  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });
  const tokenData = config.requireEmailVerification ? createOpaqueToken() : null;
  const user = await User.create({
    name,
    email,
    passwordHash: await hashPassword(password),
    role: 'user',
    emailVerifiedAt: config.requireEmailVerification ? null : new Date(),
    emailVerificationTokenHash: tokenData?.hash ?? null,
    emailVerificationExpiresAt: tokenData ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
  });

  if (tokenData) {
    const url = verificationEmailUrl(tokenData.token);
    try {
      await sendMail({ to: email, subject: 'Verify your Pizza House account', text: `Hi ${name}, verify your email within 24 hours: ${url}` });
    } catch (error) {
      await User.deleteOne({ _id: user._id });
      throw error;
    }
    if (config.nodeEnv === 'development' && !isMailConfigured()) console.info(`[DEV ONLY] Email verification URL: ${url}`);
  }

  const message = config.requireEmailVerification
    ? 'Account created. Check your email for a verification link.'
    : 'Account created. You can now sign in.';
  res.status(201).json({ message, emailVerificationRequired: config.requireEmailVerification });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const user = await User.findOne({ emailVerificationTokenHash: hashToken(req.params.token), emailVerificationExpiresAt: { $gt: new Date() } }).select('+emailVerificationTokenHash +emailVerificationExpiresAt');
  if (!user) return res.status(400).json({ error: 'Verification link is invalid or expired' });
  user.emailVerifiedAt = new Date(); user.emailVerificationTokenHash = null; user.emailVerificationExpiresAt = null; await user.save();
  res.redirect(`${config.clientBaseUrl}/?verified=1`);
});

async function loginCommon(req, res, adminOnly) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const email = String(body.email || '').trim().toLowerCase(); const password = body.password;
  if (!validEmail(email) || typeof password !== 'string' || password.length > 72) return res.status(400).json({ error: 'Enter valid sign-in details' });
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !(await verifyPassword(password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect' });
  if (adminOnly && user.role !== 'admin') return res.status(403).json({ error: 'This account does not have admin access' });
  if (!adminOnly && user.role !== 'user') return res.status(403).json({ error: 'Use the admin sign-in page for this account' });
  if (config.requireEmailVerification && !user.emailVerifiedAt) return res.status(403).json({ error: 'Verify your email before signing in' });
  issueSession(res, user); return res.json({ user: publicUser(user) });
}
export const login = asyncHandler(async (req, res) => loginCommon(req, res, false));
export const adminLogin = asyncHandler(async (req, res) => loginCommon(req, res, true));
export const logout = asyncHandler(async (req, res) => {
  // A stale or missing session must still be allowed to clear the browser cookie.
  try { await disconnectCurrentSessionSockets(req.headers.cookie); } catch { /* Cookie clearing remains the priority. */ }
  clearSession(res);
  res.json({ message: 'Signed out' });
});
export const me = asyncHandler(async (req, res) => res.json({ user: publicUser(req.user) }));

export const forgotPassword = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const email = String(body.email || '').trim().toLowerCase();
  const response = { message: 'If an account exists for this email, reset instructions will be sent.' };
  if (!validEmail(email)) return res.json(response);

  const user = await User.findOne({ email });
  if (!user) return res.json(response);

  const tokenData = createOpaqueToken();
  user.passwordResetTokenHash = tokenData.hash;
  user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();

  const url = passwordResetUrl(tokenData.token);
  try {
    await sendMail({
      to: email,
      subject: 'Reset your Pizza House password',
      text: `Use this one-time link within 30 minutes: ${url}`,
    });
  } catch (error) {
    // Keep the public response identical to the unknown-account path to avoid
    // exposing which email addresses are registered when the provider is down.
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    try {
      await user.save();
    } catch (cleanupError) {
      console.error('[password reset] Could not invalidate reset token after delivery failure.', {
        message: cleanupError?.message || 'unknown database error',
      });
    }
    console.error('[password reset] Email delivery failed.', {
      message: error?.message || 'unknown delivery error',
    });
  }

  if (config.nodeEnv === 'development' && !isMailConfigured()) console.info(`[DEV ONLY] Password reset URL: ${url}`);
  res.json(response);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const password = body.password;
  if (!isStrongEnough(password)) return res.status(400).json({ error: 'Password must be 10–72 characters with uppercase, lowercase and a number' });
  const user = await User.findOne({ passwordResetTokenHash: hashToken(req.params.token), passwordResetExpiresAt: { $gt: new Date() } }).select('+passwordResetTokenHash +passwordResetExpiresAt');
  if (!user) return res.status(400).json({ error: 'Reset link is invalid or expired' });
  user.passwordHash = await hashPassword(password); user.passwordResetTokenHash = null; user.passwordResetExpiresAt = null; user.sessionVersion = (user.sessionVersion || 0) + 1; await user.save();
  await disconnectUserSockets(user._id);
  clearSession(res);
  res.json({ message: 'Password updated. Sign in with your new password.' });
});
