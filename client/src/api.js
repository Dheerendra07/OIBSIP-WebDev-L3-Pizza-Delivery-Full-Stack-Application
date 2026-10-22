const DEFAULT_API_BASE = import.meta.env.PROD
  ? 'https://pizza-house-api.onrender.com/api'
  : 'http://localhost:4000/api';

// Vite variables are baked into the production bundle at build time. Keep a
// production-safe fallback so missing Render build settings never send auth
// requests to a customer's own localhost.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '');
export const API_ORIGIN = new URL(API_BASE, window.location.origin).origin;

export async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    credentials: 'include',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}
