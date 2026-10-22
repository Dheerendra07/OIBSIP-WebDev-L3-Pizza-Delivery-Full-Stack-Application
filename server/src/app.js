import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config/env.js';
import authRoutes from './routes/authRoutes.js';
import catalogRoutes from './routes/catalogRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import issueRoutes from './routes/issueRoutes.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { handleRazorpayWebhook } from './controllers/paymentWebhookController.js';

const app = express();
// Render terminates TLS and forwards requests through one trusted reverse proxy.
// Trusting that proxy lets express-rate-limit identify the real client IP safely.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.clientOrigin.split(',').map((s) => s.trim()), credentials: true, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-Razorpay-Signature', 'X-Razorpay-Event-Id'] }));
// A browser GET is not a webhook delivery; explain the expected method rather than returning a generic 404.
app.get('/api/payments/webhook', (_req, res) => res.status(405).json({ error: 'Razorpay webhook endpoint accepts POST requests only', service: 'pizza-house-api' }));
// Razorpay signs the exact raw request body, so mount this endpoint before express.json().
app.post('/api/payments/webhook', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }), express.raw({ type: 'application/json', limit: '64kb' }), handleRazorpayWebhook);
app.use(express.json({ limit: '32kb', strict: true }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'pizza-house-api', timestamp: new Date().toISOString() }));
app.get('/api', (_req, res) => res.json({
  status: 'ok',
  service: 'pizza-house-api',
  message: 'Pizza House API is online. Use the health endpoint or the customer website.',
  website: config.clientBaseUrl,
  health: '/api/health',
}));
app.get('/', (_req, res) => res.json({
  status: 'ok',
  service: 'pizza-house-api',
  message: 'Pizza House API is online. Open the customer website to place an order.',
  website: config.clientBaseUrl,
  health: '/api/health',
  endpoints: {
    catalog: '/api/catalog',
    auth: '/api/auth',
    orders: '/api/orders',
    payments: '/api/payments',
  },
}));
app.use('/api/auth', authRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use(notFound); app.use(errorHandler);
export default app;
