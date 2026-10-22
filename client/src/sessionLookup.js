/**
 * A failed session check is not proof that the visitor is signed out.
 * Only an explicit 401 from /auth/me establishes an unauthenticated state.
 */
export function classifySessionLookupFailure(error) {
  return error?.status === 401 ? 'unauthenticated' : 'unavailable';
}
