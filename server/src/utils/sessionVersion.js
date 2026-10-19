/** Return whether a JWT session belongs to the user's current credential generation. */
export function isSessionVersionCurrent(tokenVersion, userVersion) {
  const normalize = (value) => value === undefined || value === null ? 0 : Number.isSafeInteger(value) && value >= 0 ? value : null;
  const token = normalize(tokenVersion); const current = normalize(userVersion);
  return token !== null && current !== null && token === current;
}
