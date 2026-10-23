# Production Gap Audit — Pizza House

Audit date: 2026-10-23
Repository: `Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application`
Branch: `main`
Scope: live-browser registration/login/session/cart/checkout, deployed API responses and current CI/deployed-smoke evidence.

## Current verdict

**Partially end-to-end verified; payment completion is blocked.** Real customer registration, login, persisted session, logout, live catalog/cart interactions and delivery validation have been exercised against the deployed app. The provider-backed checkout step is not passing: the authenticated request reaches Razorpay, but Razorpay rejects the configured Test Mode credential pair with HTTP 401. The site now surfaces a safe, actionable HTTP 502 message instead of misleading “Request failed”. No payment was started or captured.

## Run links and deployed revision

- Current CI: [run 39931529547](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39931529547) — 221/221 tests passed, production client build passed, root/server/client audits reported zero vulnerabilities.
- Current deployed smoke: [run 39931529688](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39931529688) — 16/16 checks passed.
- Live health: https://pizza-house-api.onrender.com/api/health — HTTP 200, database connected, revision `8b97dfe8286b20ac1d9c187dd61b5325ea694c28`.
- Latest deployed-smoke workflow fix: [commit 8b97dfe](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/commit/8b97dfe8286b20ac1d9c187dd61b5325ea694c28) compares health version to the exact commit under test, avoiding a false mismatch when test-only commits follow backend runtime commits.

## Actual live-browser results

| Area | Observed evidence | Status |
|---|---|---|
| Customer registration | Synthetic QA customer registered on the live app; visible response: “Account created. You can now sign in.” | **Pass** |
| Login and session | Live login HTTP 200; authenticated dashboard appeared; `/api/auth/me` was HTTP 200 after reload; cookie flags were checked without reading or logging the token: Secure, HttpOnly, SameSite=Lax. Logout removed signed-in controls and a subsequent `/api/auth/me` returned 401. | **Pass** |
| Catalog and cart | Live Margherita Classic at ₹249; one item plus ₹29 delivery = ₹278. Quantity 2 recalculated to ₹498 subtotal and ₹527 total. Decrement, remove and empty-cart state worked. | **Pass** |
| Delivery validation | An incomplete delivery form was blocked with “Enter a valid 10-digit Indian mobile number.” Valid QA-only form data was accepted for the existing test order. | **Pass** |
| Order history | The real customer saw the existing order and its pending-payment status. Read-only GET for that owned order returned HTTP 200. | **Pass** |
| Payment order creation | With a valid authenticated session, GET order was HTTP 200 and PATCH delivery details was HTTP 200. POST `/api/payments/create-order` failed because upstream Razorpay returned HTTP 401, provider code `BAD_REQUEST_ERROR`. | **Blocked by provider credentials** |
| Error handling fix | Server now normalizes provider authentication failures to HTTP 502, logs only upstream status and a safe provider code, and shows explicit Test Mode credential guidance. Real UI toast was verified after deployment. No cookie, key or provider response body was logged. | **Pass** |
| Payment capture / webhook / refund | No successful Razorpay checkout modal or captured payment was possible while provider credentials were rejected. Valid webhook processing and real refund remain unverified; existing tests cover signatures/reconciliation behavior. | **Not yet verified** |
| Email delivery / admin fulfillment / live realtime | No configured SMTP delivery, paid order fulfillment or real customer Socket.IO order lifecycle was attempted in this run. | **Not yet verified** |

## Confirmed QA order and safety state

Only one QA order was created: `PH-D1488AA0`, total ₹278, with one Margherita Classic. The address is explicitly marked `QA TEST ONLY - DO NOT DELIVER`. The order remains `pending_payment` with `paymentStatus: pending`; `paymentReviewRequired` is false. No payment was started or captured, and no duplicate order was created. Do not fulfill/deliver this order. It was reused for diagnostics rather than creating new orders.

## Code and test changes

- Added `server/src/utils/paymentProviderErrors.js` to translate provider HTTP 401/403 into an actionable, sanitized HTTP 502 and to normalize other upstream/network failures as retryable HTTP 502.
- Updated the payment-order controller to log only `upstreamStatus` and a constrained `providerCode`, release stock through the existing compensating transaction, and throw the normalized error.
- Updated the production error handler to expose only explicitly marked, short safe messages; other 5xx production errors remain redacted.
- Added unit tests covering provider 401/403, network/other upstream errors, safe public messaging and safe diagnostic code handling.
- Updated the real Express/Mongo integration test to assert that provider outage is a 502 retryable checkout failure and that the existing reservation release/retry assertions still pass.
- Fixed deployed-smoke revision checking to validate the precise checked-out commit. Current CI and deployed smoke both pass.

## Next blocking action

The remaining blocker is the Razorpay Test Mode key pair configured in Render. The live request's 401 `BAD_REQUEST_ERROR` comes from the provider, not from customer authentication: login and order endpoints succeed with the same customer session. In Render's Environment settings, ensure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are from the **same Test Mode key generation**. Do not put either value in chat, logs, commits or documentation. After updating the pair privately, verify the admin-only provider check or retry checkout on this same QA order and confirm the Razorpay Test Mode modal opens before any test-only payment attempt.

## Acceptance gate

Do not mark Pizza House fully end-to-end complete until Test Mode checkout opens with valid matching keys, a controlled test capture is verified server-side, webhook idempotency/reconciliation and the order record agree, stock state is correct, and admin/customer order-state updates work. CI success, an HTTP-200 health endpoint, a successful login or a pending order alone is not proof of a completed payment journey.
