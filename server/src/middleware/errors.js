export function notFound(req, res) { res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }); }
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;
  if (err?.name === 'ValidationError') return res.status(400).json({ error: 'Invalid data', details: Object.values(err.errors).map((e) => e.message) });
  if (err?.name === 'CastError') return res.status(400).json({ error: 'Invalid identifier' });
  if (err?.code === 11000) return res.status(409).json({ error: 'An account or record with that value already exists' });
  const status = Number.isInteger(err.statusCode) ? err.statusCode : (Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500);
  if (status >= 500) console.error('[api error]', { method: req.method, path: req.path, message: err.message });
  res.status(status).json({ error: status >= 500 && process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred' : (err.message || 'Request failed') });
}
