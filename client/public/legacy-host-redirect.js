(() => {
  const legacyHost = 'pizza-house-web-n75h.onrender.com';
  const primaryOrigin = 'https://pizza-house-api.onrender.com';

  // The API host serves the customer app and API on one origin, so auth cookies
  // and Socket.IO work without cross-site browser-cookie restrictions.
  if (window.location.hostname !== legacyHost) return;

  const destination = new URL(
    window.location.pathname + window.location.search + window.location.hash,
    primaryOrigin,
  );

  window.location.replace(destination.href);
})();
