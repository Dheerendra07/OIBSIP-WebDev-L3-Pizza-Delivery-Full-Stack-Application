# Production Gap Audit — Pizza House

Audit date: 2026-10-23
Repository: `Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application`
Branch: `main`
Scope: live-browser registration/login/session/cart/checkout-recovery, deployed API responses and current CI/deployed-smoke evidence.

## Current verdict

**Test Mode checkout has now passed the live UI flow, with remaining production-readiness gaps.** Real customer registration, login, persisted session, logout, live catalog/cart interactions, delivery validation and pending-order recovery have been exercised against the deployed app. The latest user-supplied live screenshot shows an order as `Paid` and `Order received` after the mock OTP step. The current client calls `POST /api/payments/verify` and refreshes server-backed order history; server code fetches the provider payment and marks an order paid only when the provider reports `captured`. This supersedes the earlier same-day attempt that was blocked by provider HTTP 401. A separate pending order remains in order history and was not modified. This was Test Mode only and is not evidence of a real-money charge or readiness for live-mode sales.

## Run links and deployed revision

- Latest CI: [run 39951259687](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39951259687) — success after adding expired-reservation reconciliation and nonterminal `payment.failed` webhook integration cases; dependency install, high/critical audits, production build and test step all passed. Earlier run [39933091083](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39933091083) passed 226/226 tests and production build.
- Latest deployed smoke: [run 39951259735](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39951259735) — passed with the runtime-commit-aware version check. Earlier deployed smoke [run 39933091241](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39933091241) passed 16/16 checks.
- Current browser smoke: [run 39933091078](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39933091078) — passed.
- Live health: https://pizza-house-api.onrender.com/api/health — HTTP 200, database connected, revision `cbce61f442de10d7a74718770ef35035bf38277a` (latest deployed frontend guidance update). The newer `0ec1657` commit changes tests only; it does not require a Render redeploy.
- Latest deployed-smoke workflow fix: [commit 8b97dfe](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/commit/8b97dfe8286b20ac1d9c187dd61b5325ea694c28) compares health version to the exact commit under test, avoiding a false mismatch when test-only commits follow backend runtime commits.

## Actual live-browser results

| Area | Observed evidence | Status |
|---|---|---|
| Customer registration | Synthetic QA customer registered on the live app; visible response: “Account created. You can now sign in.” | **Pass** |
| Login and session | Live login HTTP 200; authenticated dashboard appeared; `/api/auth/me` was HTTP 200 after reload; cookie flags were checked without reading or logging the token: Secure, HttpOnly, SameSite=Lax. Logout removed signed-in controls and a subsequent `/api/auth/me` returned 401. | **Pass** |
| Catalog and cart | Live Margherita Classic at ₹249; one item plus ₹29 delivery = ₹278. Quantity 2 recalculated to ₹498 subtotal and ₹527 total. Decrement, remove and empty-cart state worked. | **Pass** |
| Delivery validation | An incomplete delivery form was blocked with “Enter a valid 10-digit Indian mobile number.” Valid QA-only form data was accepted for the existing test order. | **Pass** |
| Order history | The real customer saw the existing order and its pending-payment status. Read-only GET for that owned order returned HTTP 200. | **Pass** |
| Resume checkout | New “Resume checkout” action appears on pending order cards. Live click fetched the same order (HTTP 200), restored the saved server quote/address into the bag and session draft, and did not create a new order. Order count stayed at one. | **Pass** |
| Payment order creation | An earlier attempt reached POST `/api/payments/create-order` and got a safe HTTP 502 after upstream Razorpay returned HTTP 401 (`BAD_REQUEST_ERROR`). A later user-supplied live screenshot reached the post-OTP order-history state, showing a separate order as Paid / Order received. The later result supersedes the earlier blocked attempt for Test Mode checkout. | **Pass in Test Mode UI** |
| Error handling fix | Server now normalizes provider authentication failures to HTTP 502, logs only upstream status and a safe provider code, and shows explicit Test Mode credential guidance. Real UI toast was verified after deployment. No cookie, key or provider response body was logged. | **Pass** |
| Payment verification / webhook / refund | The order-history UI shows Paid / Order received after the checkout callback. The client calls `/api/payments/verify`; server code checks provider payment status before marking paid. A separate provider-dashboard inspection and real signed webhook delivery/idempotency/refund exercise were not performed. | **Test Mode verification passed; webhook/refund pending** |
| Expired inventory reservation reconciliation | New mocked-provider MongoDB integration cases cover: no capture → cancel + restore stock; captured payment → paid/order-received without restoring stock; authorized/in-flight payment → defer and preserve stock hold. CI [run 39950832004](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39950832004) passed. Live order inventory values were not queried. | **Automated pass; live state pending** |
| Email delivery / admin fulfillment / live realtime | No configured SMTP delivery, paid order fulfillment or real customer Socket.IO order lifecycle was attempted in this run. | **Not yet verified** |

## Confirmed QA order and safety state

The earlier synthetic QA order `PH-D1488AA0` remains a separate QA diagnostic order and is not the order shown in the latest screenshot. The screenshot shows one Test Mode order as Paid / Order received and another distinct order still pending. Avoid recording the screenshot's personal delivery details in this public repository. Do not fulfill/deliver any order paid only in Test Mode; do not cancel or alter the other pending order without confirming its intended state.

## Code and test changes

- Added `server/src/utils/paymentProviderErrors.js` to translate provider HTTP 401/403 into an actionable, sanitized HTTP 502 and to normalize other upstream/network failures as retryable HTTP 502.
- Updated the payment-order controller to log only `upstreamStatus` and a constrained `providerCode`, release stock through the existing compensating transaction, and throw the normalized error.
- Updated the production error handler to expose only explicitly marked, short safe messages; other 5xx production errors remain redacted.
- Added unit tests covering provider 401/403, network/other upstream errors, safe public messaging and safe diagnostic code handling.
- Updated the real Express/Mongo integration test to assert that provider credential rejection is a sanitized 502 and that the existing reservation release/retry assertions still pass.
- Expanded the real Express/Mongo integration test to exercise expired reservation reconciliation with mocked provider states: empty payments restore inventory/cancel the order; a valid late capture marks paid/order-received while consuming reserved stock; an authorized payment keeps the order pending and the stock hold intact. Full CI passed in [run 39950832004](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39950832004). A further signed `payment.failed` webhook case now confirms the pending order remains retryable and its stock hold is preserved before a later captured payment; the expanded suite passed in [run 39951259687](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39951259687).
- Added `buildPendingCheckoutCart` plus tests to restore a pending order from its server-saved quote; customer order cards now expose “Resume checkout”. Live browser verification confirmed saved cart/address restoration and no duplicate order.
- Fixed deployed-smoke revision checking to compare against the latest backend/frontend runtime commit; test-only commits no longer produce false deployed-version failures. Latest CI and deployed smoke passed in runs [39951259687](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39951259687) and [39951259735](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39951259735).

## Next blocking action

The initial browser-side failure was Razorpay's official checkout JavaScript failing to load. The loader now has shared in-flight loading, timeout, cleanup and actionable network/content-blocker guidance; the updated bundle is live. The later Test Mode journey reached Paid / Order received. Automated tests now cover stock reconciliation for empty, captured and authorized provider-payment states, but the actual live order's inventory values and provider dashboard record remain unqueried. Next, exercise signed webhook idempotency and admin order-state transitions with Test Mode data, then reconcile the separate pending order safely without paying again or delivering test orders. Do not use live-mode keys or perform real-money payment tests. The Razorpay secret previously exposed in chat should be rotated privately; never copy secrets into GitHub or public documentation.

## Acceptance gate

Do not mark Pizza House fully end-to-end complete until Test Mode checkout/payment verification is reconciled with provider evidence, webhook idempotency is confirmed, inventory is in the correct state, the separate pending order is safely reconciled, and admin/customer order-state updates work. SMTP delivery and refund recovery also remain unverified. Test Mode `Paid` must never be treated as a real-money sale. CI success or an HTTP-200 health endpoint alone is not proof of a completed payment journey.
