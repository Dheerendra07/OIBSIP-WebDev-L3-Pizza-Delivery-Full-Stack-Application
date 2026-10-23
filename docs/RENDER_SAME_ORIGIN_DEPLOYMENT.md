# Render Same-Origin Deployment (Login Session Fix)

Pizza House currently has a static frontend and API on separate `*.onrender.com` hostnames. Those hostnames are isolated sites for cookie purposes, and browser third-party-cookie policies can block the API's session cookie even when the login endpoint itself responds correctly.

The repository can serve the built Vite frontend from the Express API service. Use the API service's existing hostname as the canonical website URL, so the frontend, REST API and Socket.IO share one origin. This avoids needing a paid custom domain.

## Render Web Service settings

Open the existing `pizza-house-api` Web Service. Keep the existing service and its database/provider credentials. Do not create another database, rotate secrets, or paste credentials into chat.

1. In **Settings**, set **Root Directory** to the repository root (blank, not `server`).
2. Set **Build Command** to:

   ```sh
   npm ci --include=dev && npm --prefix server ci --omit=dev && npm --prefix client ci --include=dev && npm --prefix client run build
   ```

3. Keep **Start Command** as:

   ```sh
   npm --prefix server start
   ```

4. Set the non-secret build/runtime variables below. Keep all existing secret/provider variables as they are.

   | Variable | Value |
   |---|---|
   | `VITE_API_BASE_URL` | `/api` |
   | `CLIENT_ORIGIN` | `https://pizza-house-api.onrender.com` |
   | `CLIENT_BASE_URL` | `https://pizza-house-api.onrender.com` |
   | `APP_BASE_URL` | `https://pizza-house-api.onrender.com` |
   | `COOKIE_SAME_SITE` | `lax` |
   | `NODE_ENV` | `production` |

   Keep the existing `MONGODB_URI`, `JWT_SECRET`, admin settings, Resend/SMTP settings and Razorpay **Test Mode** values. Never include their values in an issue, commit, screenshot or chat message.

5. If a health-check path is configured, use `/api/health`.
6. Save the settings and deploy the latest `main` commit. If auto-deploy is disabled, trigger a manual deploy from the Render dashboard.

## Why this fixes the session path

- The production frontend calls the relative `/api` path on the same hostname instead of making credentialed cross-site requests.
- `HttpOnly` session cookies and Socket.IO connections are first-party/same-origin.
- `CLIENT_ORIGIN` allows the canonical site, and verification/reset links return to that same site.
- The old standalone static site may remain deployed, but it is not canonical and will lose API access after `CLIENT_ORIGIN` is switched. Open the app at `https://pizza-house-api.onrender.com`.

## Verification after deployment

1. Visit `https://pizza-house-api.onrender.com/api/health`; expect HTTP 200, `status: "ok"`, and `dependencies.database: "connected"`.
2. Visit `https://pizza-house-api.onrender.com`; expect the Pizza House customer interface, not the API JSON landing page.
3. Check the GitHub **Deployed smoke checks** and **Pizza House Browser Smoke** runs. The checks validate health/database readiness, populated catalog, origin/credentials headers, auth route guards, the built API URL, and the real-browser menu/cart/sign-in interactions.
4. Manually create a test account only after confirming email-verification and email-delivery settings. Then check signup, login, refresh, logout, order creation and Razorpay Test Mode checkout separately. Passing smoke tests does **not** prove the user's credentials, outbound email, Razorpay webhook delivery, payment capture or refund flow.

If Render rejects the build or the service doesn't start, use its deployment logs and restore the previous service settings before changing database/provider settings. Do not change authentication secrets just to troubleshoot a cookie.
