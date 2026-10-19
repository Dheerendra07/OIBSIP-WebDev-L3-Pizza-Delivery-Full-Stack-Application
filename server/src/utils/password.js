import bcrypt from 'bcryptjs';
export async function hashPassword(password) { return bcrypt.hash(password, 12); }
export async function verifyPassword(password, hash) { return bcrypt.compare(password, hash); }
export function isStrongEnough(password) { return typeof password === 'string' && password.length >= 10 && password.length <= 72 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password); }
