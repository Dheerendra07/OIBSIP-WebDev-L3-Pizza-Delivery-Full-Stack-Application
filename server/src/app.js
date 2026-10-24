import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import { getReadiness } from './utils/healthStatus.js';
import authRoutes from './routes/authRoutes.js';
import catalogRoutes from './routes/catalogRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import issueRoutes from './routes/issueRoutes.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { handleRazorpayWebhook } from './controllers/paymentWebhookController.js';

const app = express();
const clientDistPath = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const clientIndexPath = fileURLToPath(new URL('../../client/dist/index.html', import.meta.url));
// Render terminates TLS and forwards requests through one trusted reverse proxy.
// Trusting that proxy lets express-rate-limit identify the real client IP safely.
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Razorpay Standard Checkout runs from its official CDN and opens a provider-hosted frame.
// Keep Helmet's restrictive defaults, adding only the external sources required by checkout.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", 'https://checkout.razorpay.com', 'https://cdn.razorpay.com'],
      frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout-static-next.razorpay.com'],
      connectSrc: [
        "'self'",
        'https://api.razorpay.com',
        'https://api-dark.razorpay.com',
        'https://express.razorpay.com',
        'https://lumberjack.razorpay.com',
        'https://lumberjack-cx.razorpay.com',
        'https://lumberjack-metrics.razorpay.com',
      ],
      // Allow only the image hosts used by the premium pizza catalog cards.
      imgSrc: [
        "'self'",
        'data:',
        'https://cdn.razorpay.com',
        'https://images.pexels.com',
        'https://images.unsplash.com',
      ],
      formAction: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
    },
  },
}));
app.use(cors({ origin: config.clientOrigin.split(',').map((s) => s.trim()), credentials: true, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Razorpay-Signature', 'X-Razorpay-Event-Id'] }));
// A browser GET is not a webhook delivery; explain the expected method rather than returning a generic 404.
app.get('/api/payments/webhook', (_req, res) => res.status(405).json({ error: 'Razorpay webhook endpoint accepts POST requests only', service: 'pizza-house-api' }));
// Razorpay signs the exact raw request body, so mount this endpoint before express.json().
app.post('/api/payments/webhook', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }), express.raw({ type: 'application/json', limit: '64kb' }), handleRazorpayWebhook);
app.use(express.json({ limit: '32kb', strict: true }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
app.get('/api/health', (_req, res) => {
  const readiness = getReadiness(mongoose.connection.readyState);
  res.set('Cache-Control', 'no-store');
  return res.status(readiness.httpStatus).json({
    status: readiness.status,
    service: 'pizza-house-api',
    timestamp: new Date().toISOString(),
    // Render provides this commit SHA at runtime; it lets smoke checks prove
    // that the expected revision—not an older still-live deploy—is serving traffic.
    version: process.env.RENDER_GIT_COMMIT || null,
    dependencies: readiness.dependencies,
  });
});
app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ paymentMode: config.paymentMode });
});
app.get('/api', (_req, res) => res.json({
  status: 'ok',
  service: 'pizza-house-api',
  message: 'Pizza House API is online. Use the health endpoint or the customer website.',
  website: config.clientBaseUrl,
  health: '/api/health',
}));
app.use(express.static(clientDistPath, { index: false, fallthrough: true }));
app.get('/', (_req, res) => {
  // When the API service also builds client/dist, serve the customer application
  // on this same origin. This avoids third-party-cookie restrictions from the
  // isolated *.onrender.com frontend/API hostnames. Local API-only runs retain
  // the JSON service landing page when no production bundle exists.
  if (existsSync(clientIndexPath)) {
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(clientIndexPath);
  }
  return res.json({
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
  });
});
app.use('/api/auth', authRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use(notFound); app.use(errorHandler);
export default app;
