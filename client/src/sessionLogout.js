/**
 * Clear local UI state only after the API confirms that the session cookie
 * has been cleared. A failed request must not be reported as a successful
 * sign-out because the browser may still hold a valid server session.
 */
export async function completeSignOut({ request, clearLocalSession, onError }) {
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch (error) {
    onError?.(error);
    return false;
  }

  clearLocalSession();
  return true;
}
