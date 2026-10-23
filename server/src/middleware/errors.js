const SAFE_LOG_TOKEN = /^[A-Za-z0-9_-]{1,80}$/;

function safeLogToken(value) {
  return typeof value === 'string' && SAFE_LOG_TOKEN.test(value) ? value : null;
}

function safeErrorRoute(req) {
  const baseUrl = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  const routePath = typeof req.route?.path === 'string' ? req.route.path : '';
  // Use Express's matched route template, never req.path: auth reset/verification
  // URLs can contain user-specific tokens in their actual path.
  const route = `${baseUrl}${routePath}`.slice(0, 180);
  return route || 'unmatched';
}

export function notFound(req, res) { res.status(404).json({ error: 'Route not found', method: safeLogToken(req.method) || 'UNKNOWN' }); }
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;
  if (err?.name === 'ValidationError') return res.status(400).json({ error: 'Invalid data', details: Object.values(err.errors).map((e) => e.message) });
  if (err?.name === 'CastError') return res.status(400).json({ error: 'Invalid identifier' });
  if (err?.code === 11000) return res.status(409).json({ error: 'An account or record with that value already exists' });
  const status = Number.isInteger(err.statusCode) ? err.statusCode : (Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500);
  if (status >= 500) {
    const details = {
      method: safeLogToken(req.method) || 'UNKNOWN',
      route: safeErrorRoute(req),
      statusCode: status,
      errorName: safeLogToken(err?.name) || 'Error',
    };
    const errorCode = safeLogToken(err?.code);
    if (errorCode) details.errorCode = errorCode;
    // Never log raw exception text or the concrete URL path; either may contain secrets.
    console.error('[api error]', details);
  }
  const safePublicMessage = err.safeToExpose === true && typeof err.message === 'string' && err.message.length <= 240;
  res.status(status).json({ error: status >= 500 && process.env.NODE_ENV === 'production' && !safePublicMessage ? 'An unexpected server error occurred' : (err.message || 'Request failed') });
}
