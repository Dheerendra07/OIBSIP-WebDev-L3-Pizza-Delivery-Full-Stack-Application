import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { config } from '../config/env.js';
import { isSessionVersionCurrent } from '../utils/sessionVersion.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const cookieOptions = () => ({ httpOnly: true, secure: config.nodeEnv === 'production', sameSite: config.cookieSameSite, path: '/', maxAge: 24 * 60 * 60 * 1000 });
export const issueSession = (res, user) => {
  const token = jwt.sign({ sub: user.id, role: user.role, sv: user.sessionVersion ?? 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, issuer: 'pizza-house-api', audience: 'pizza-house-client' });
  res.cookie('pizza_session', token, cookieOptions());
};
export const clearSession = (res) => res.clearCookie('pizza_session', { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: config.cookieSameSite, path: '/' });

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.pizza_session;
  if (!token) return res.status(401).json({ error: 'Sign in to continue' });
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret, { issuer: 'pizza-house-api', audience: 'pizza-house-client' }); }
  catch { return res.status(401).json({ error: 'Session expired. Sign in again.' }); }
  const user = await User.findById(payload.sub).select('name email role emailVerifiedAt sessionVersion');
  if (!user) return res.status(401).json({ error: 'Account not found' });
  if (!isSessionVersionCurrent(payload.sv, user.sessionVersion)) return res.status(401).json({ error: 'Your session is no longer valid. Sign in again.' });
  if (!user.emailVerifiedAt) return res.status(403).json({ error: 'Verify your email first' });
  req.user = user;
  next();
});
export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};
