# Production Gap Audit — Pizza House

Audit date: 2026-10-23
Repository: `Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application`
Branch: `main`
Scope: production evidence and the latest hosted-browser/API smoke logs available during this audit.

## Executive status

**Not yet end-to-end production verified.** Automated CI is green and the deployed smoke checks passed, but a successful real customer login/session and provider-backed order journey have not been demonstrated. Do not treat mocked authentication as production authentication.

## Evidence reviewed

- Hosted browser smoke run [39914211411](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39914211411): 9/9 checks passed.
- Deployed API smoke run [39907398646](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39907398646): 16/16 checks passed.
- CI/test/build run [39914211397](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/39914211397): status recorded by the project as 217/217 tests, client production build, and root/server/client audits with zero reported vulnerabilities.
- Current project evidence: [PROJECT_STATUS.md](../PROJECT_STATUS.md).

## Findings

| Priority | Area | Evidence / gap | Status |
|---|---|---|---|
| P0 | Real customer login | Browser smoke run has empty `PIZZA_QA_CUSTOMER_EMAIL` and `PIZZA_QA_CUSTOMER_PASSWORD`. Successful login, cookie flags, session restoration after full reload and logout invalidation were tested against mocked auth endpoints, not the production auth API. | **Blocked on dedicated QA account secrets** |
| P0 | Real checkout/payment | No confirmed full browser-to-Razorpay Test Mode journey with captured payment and matching production order record was present in reviewed evidence. | **Unverified** |
| P0 | Razorpay webhook/refund | Invalid signature guard passed. That proves rejection of a bad signature only; it does not prove a valid dashboard webhook was delivered, reconciled idempotently, or that a refund was completed. | **Partially verified** |
| P1 | Email delivery | Registration form render and validation passed, but successful email verification/password-reset delivery and inbox receipt are not proven by these runs. | **Unverified** |
| P1 | Inventory transactions | API readiness/catalog and test coverage are green; live concurrent reservation/stock contention and reservation-expiry reconciliation were not demonstrated by the reviewed production smoke. | **Unverified** |
| P1 | End-to-end order lifecycle | Menu → bag → delivery form was exercised. A real authenticated customer order through payment, order history, admin fulfillment and customer-visible Socket.IO update was not demonstrated. | **Unverified** |
| P1 | UI/accessibility | Hosted browser checks covered home/menu, bag/delivery, mobile sign-in focus, accessible invalid-login feedback, signup rendering and uncaught page errors. They do not cover every route/state, a full keyboard-only checkout, real screen-reader sessions or literal 200% zoom. | **Partial coverage** |
| P2 | Deployment propagation | The API smoke log initially saw HTTP 503 and the previous separate web hostname during retries, then passed all 16 checks against the canonical same-origin deployment. | **Passed after retries; monitor on next deploy** |

## Verified hosted-browser checks (9/9)

1. Hosted home and live menu render.
2. Menu → bag → delivery form interaction.
3. Mobile sign-in opens with focus inside the dialog.
4. Live sign-in API error reaches the browser accessibly.
5. Signup form renders without creating a production account.
6. Simulated successful login updates the UI and stores a simulated secure session cookie.
7. Simulated signed-in state is restored after a full-page reload.
8. Simulated logout clears the simulated cookie and remains signed out after reload.
9. No uncaught browser page errors.

Important: checks 6–8 are explicitly mocked. They are not proof of production authentication.

## Safe next steps

1. Add a dedicated, verified, non-admin QA customer's email and password as GitHub Actions repository secrets named `PIZZA_QA_CUSTOMER_EMAIL` and `PIZZA_QA_CUSTOMER_PASSWORD`. Do not paste credentials into an issue, commit, or chat. The workflow exposes them only to the `main` browser QA job.
2. Rerun the hosted-browser smoke and confirm that the real login path, secure HttpOnly/SameSite cookie, session lookup after reload and logout invalidation pass. If the customer account cannot sign in, record the actual response and fix the verified cause.
3. Exercise Razorpay **Test Mode** only: successful capture, invalid signature, duplicate/out-of-order webhook delivery, uncertain verification, payment-review handling and eligible test refund. Do not create live payments or issue real refunds during QA.
4. Verify email delivery with the configured provider and a test inbox; confirm verification/reset links work without logging tokens.
5. Run the full browser order lifecycle with a dedicated test account and test payment, then verify customer history, admin queue/status changes, stock reconciliation and scoped realtime updates.
6. Complete manual keyboard, 320px and 200% zoom, screen-reader and error/empty/loading-state review.

## Acceptance gate

Mark production end-to-end complete only after the real customer session path and safe test-payment/order lifecycle pass with evidence. A passing CI run, mocked login, health endpoint, invalid webhook rejection or successful build alone is insufficient.
