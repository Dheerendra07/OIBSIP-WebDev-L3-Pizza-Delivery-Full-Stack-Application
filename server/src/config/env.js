import 'dotenv/config';

import { validateEnv } from '../utils/envValidation.js';
validateEnv();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pizza_delivery',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-this-secret-before-deployment-please',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  cookieSameSite: String(process.env.COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'lax' : 'strict')).toLowerCase(),
  clientBaseUrl: process.env.CLIENT_BASE_URL || 'http://localhost:5173',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:4000',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
  adminAlertEmail: process.env.ADMIN_ALERT_EMAIL || '',
  stockAlertCooldownHours: Number(process.env.LOW_STOCK_ALERT_COOLDOWN_HOURS || 6),
};
