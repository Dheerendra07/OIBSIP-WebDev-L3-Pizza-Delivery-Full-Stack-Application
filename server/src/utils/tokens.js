import crypto from 'node:crypto';
export function createOpaqueToken() { const token = crypto.randomBytes(32).toString('hex'); return { token, hash: crypto.createHash('sha256').update(token).digest('hex') }; }
export function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
export { safeEqualHex } from './paymentSignature.js';
