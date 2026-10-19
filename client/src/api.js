const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
export async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { method: options.method || 'GET', credentials: 'include', headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || `Request failed (${response.status})`); error.status = response.status; throw error; }
  return data;
}
