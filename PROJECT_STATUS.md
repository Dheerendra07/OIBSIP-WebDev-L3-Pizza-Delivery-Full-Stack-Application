# Pizza House — Project Status and Launch Roadmap

**Last reviewed:** 2026-10-25 (after PRs #127–#129 and successful 60/60 hosted browser smoke)  
**Repository:** [Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application)  
**Canonical hosted app/API:** https://pizza-house-api.onrender.com  
**Latest application/runtime commit:** d5ab86f8d4c64bba8b28f7b53669ef1eaf5baedc (PR #121)  
**Product state:** deployed development/launch-preparation platform; **not certified for live-money transactions or a real delivery business**.

> Keep implemented features, automated evidence, hosted evidence and real-world readiness separate. A green build or simulated order progression is not proof that a customer was charged, a kitchen accepted an order, or a driver delivered it.

## 1. What is implemented now

### Customer product
- React/Vite responsive storefront, home/menu sections, featured recipe cards with live-catalog ingredient labels, custom pizza builder, product details, cart/checkout and persistent Light/Night themes.
- Customer register/login, email verification, logout, forgotten-password/reset flow and cookie-backed sessions.
- Server-priced cart/order creation, validated delivery recipient and address, quote-change confirmation, idempotent checkout, pending-order/cart recovery, and guarded payment-verification retry.
- Order history with status timeline and stage timestamps; safe repeat-order from the current catalog; authenticated order issue reporting and customer-visible case updates.
- Mobile layout and accessibility fixes across focus management, visible error announcements, contrast and keyboard-operable issue dialog. Some manual accessibility review is still outstanding.

### Money, inventory and security
- Razorpay Test Mode checkout integration with signature verification plus independent provider-state/order/amount/currency checks.
- Signed payment/refund webhook route with idempotent event receipts and conservative late-capture / reservation reconciliation.
- Server-side inventory reservation and review holds for ambiguous payment outcomes; no blind inventory release just because a provider request failed.
- Payment-review workflow and a guarded full-refund recovery path for eligible cases.
- Auth rate limits, hashed expiring email-verification/password-reset tokens, HttpOnly cookies, role-based route guards, session invalidation and safer error logging.
- Insert-only startup inventory bootstrap; startup logs on the latest deployment reported that 20 catalog ingredients were checked and existing stock preserved. Existing admin password was preserved.

### Admin, kitchen and delivery operations
- Admin summary, stock/threshold editing, incoming-order and payment-review queues, low-stock scan/notification job, and customer support case management.
- Admin staff management: create kitchen/delivery staff, assign paid orders and disable accounts.
- Separate role-filtered kitchen/delivery queues and status actions; temporary staff passwords must be changed at first sign-in. Disabling a staff account invalidates its active session.
- Kitchen preparation ticket/details, explicit order-stage timestamps and customer timeline.
- The server distinguishes **simulated Test Mode fulfillment** from Live Mode. Test Mode progression is explicitly presented as a simulation; it does not contact a real kitchen or delivery partner.

## 2. Latest changes and evidence

### PR #121 — secure kitchen and delivery staff workflows
Merged to main as d5ab86f8d4c64bba8b28f7b53669ef1eaf5baedc.
- Role-filtered operations API and queues.
- Staff provisioning, assignments, password rotation and account disable/session revocation.
- Integration coverage for assignment, staged handoff, delivery confirmation, payment-safe fulfillment and staff disable.
- [PR #121](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/121)

### PR #120 — fulfillment operations and safe sandbox flow
- Premium customer order timeline and timestamps.
- Kitchen preparation ticket and stage-filtered admin queue.
- Test Mode stages are simulation-only; Live Mode transitions require the configured app mode and order mode to match.
- [PR #120](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/120)

### Recent UI / visual QA
- [PR #119](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/119) keeps featured recipe images distinct and requires at least three distinct successfully loaded image URLs in production browser smoke.
- [PR #114](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/114) resolves featured recipe ingredient chips from the live catalog.
- [PR #116](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/116) adds recipe-backed pizza detail views and cleans up the home journey.
- [PR #95](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/95), #107, #108 and #109 cover Night Mode and lower-page parity, footer, and photo-led catalog cards; hosted browser checks are linked from the relevant PRs and Actions runs.

### Latest CI / host verification for current main

- **Pizza House CI:** [run 40169695235](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40169695235) — **passed** on current main source commit `cbe2adfae1cfaadcb0937791401cab081d543047`; dependency installation/audit, API and client unit/integration tests, browser-smoke script syntax and production client build all passed.
- **Pizza House Browser Smoke:** [run 40169695225](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40169695225) — **passed 60/60**. It loads the production website and exercises live catalog/card behavior, responsive widths and Light/Night UI, then intercepts customer authentication/checkout/payment and the synthetic kitchen/delivery scenario. New assertions passed for staff first-login password rotation, kitchen acceptance, kitchen hand-off, delivery completion, the Completed filter, and the final customer-facing simulated tracking notice.
- **Safety boundary for the new staff browser drill:** all staff login/password/queue/status calls are Playwright-mocked. The order `PH-OPS-QA` exists only in the browser script's in-memory test state. The test did not create a real staff account, write a production order, contact a kitchen, charge a payment or dispatch a driver. This is UI interaction coverage, not a live authenticated staff acceptance test.
- **Deployed smoke checks:** [run 40169695283](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40169695283) — **passed**. Checks healthy API/database readiness, catalog, credentialed CORS, unauthenticated session/provider guards, webhook method/signature guards, website/bundle and deployed/runtime revision consistency.
- **PR #127 — kitchen/delivery UI smoke:** [PR #127](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/127) added a synthetic browser-only role lifecycle and staff responsive/theme checks. Browser run [40169373775](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40169373775) exposed a duplicate accessible-label match; the exact selector was fixed in [PR #128](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/128). Follow-up run [40169525717](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40169525717) then verified kitchen, hand-off, delivery and Completed filter but exposed an ambiguous order-number assertion; [PR #129](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/129) fixed that assertion. The final run [40169695225](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40169695225) is the green 60/60 result.
- **PR #125 — deployed revision checker:** [PR #125](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/125) is merged. It fetches current main history and accepts the deployed/tested SHAs in either ancestry direction, while still failing if revisions are unrelated or runtime files differ. The deployed smoke now remains green when Render serves a later docs-only revision.
- **Production runtime:** the latest application/runtime change is still PR #121 commit `d5ab86f8d4c64bba8b28f7b53669ef1eaf5baedc`. Render release `dep-dbeosarsp5es73c954ag` is `live`, targeting docs-only commit `a97c1debadd60d04b940a1cb0bbfb48a59dfde3c`, which includes the staff runtime changes. This documentation/test-only main activity did not require a new Render deploy. The earlier staff deploy `dep-dbeonugm7kps73eipdu0` ended `update_failed`; it remains historical evidence, not the current release.
- Render's successful startup logs show the Vite production build, API startup, inventory bootstrap checking 20 catalog ingredients while preserving existing stock, and preserving the existing admin password.
- **What this proves—and what it does not:** the release is live and the hosted service plus mocked browser journey checks pass. It does not prove live-money checkout, provider-sent webhook/refund handling, verified customer email delivery, production staff accounts, or real kitchen/driver delivery. Those remain separate launch gates.

## 3. Pull-request audit snapshot

The repository-wide PR audit reviewed the 121 PRs present during the README refresh, including the latest operational, visual and documentation PRs. Since that snapshot, two stale feature PRs were closed after checking their stated scope against the merged fixes:
- [#111](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/111) closed as superseded by merged [#114](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/114), which resolves featured ingredients from the live catalog.
- [#115](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/115) closed as superseded by merged [#119](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/119), which adds explicit distinct photo mapping and stronger browser assertions.

The remaining open PRs are the nine Dependabot updates #48–#56 (actions/checkout, actions/setup-node, concurrently, dotenv, Vite, mongodb-memory-server, @vitejs/plugin-react, mongoose and lucide-react). Their latest recorded head checks were green for #48, #49, #50, #51, #52, #53, #55 and #56. **PR #54 is not green**: `npm ci` fails with `ERESOLVE` because `@vitejs/plugin-react@6.1.2` requires Vite `^8.0.0`, but #54 changes the plugin while retaining Vite 7. Do not merge #54 alone; coordinate it with the Vite upgrade and rerun the combined lockfile/build/test path. Even green individual PR checks are not permission to merge all major upgrades at once. PR #14 remains closed without merge as a superseded status-document snapshot.

## 4. Known gaps — do not present these as done

1. **Actual business operations:** staff-role code exists, but real employees, operating hours, kitchen acceptance procedure, delivery boundaries/fees, and driver availability have not been configured or validated with a real restaurant. No third-party driver dispatch integration is claimed.
2. **Live money:** the current verified checkout evidence is Test Mode. No production/live-money order has been verified. Keep live credentials disabled until the provider, legal/business details, refund process and live operational controls are approved and tested.
3. **Webhook and refund providers:** code and automated tests exist; real provider-sent signed events, duplicate delivery against the deployed service, end-to-end refunds and failure recovery still require a controlled Test Mode exercise.
4. **Customer notifications:** an email/notification path and scheduled low-stock job exist in code, but successful end-to-end delivery to a verified real inbox is not established by the latest smoke suite. SMS/OTP delivery is not claimed; Test Mode checkout may show simulated OTP.
5. **Whole-role production journey:** hosted UI coverage now runs a full *mocked* customer → kitchen → delivery → customer scenario (60/60 browser checks pass). Every staff login, password change, queue and status call in that scenario is intercepted; no actual production staff account/order is used. A controlled, authenticated role-by-role run against the deployed API and business-configured staff accounts is still outstanding.
6. **Accessibility:** responsive/theme and automated contrast/focus work has landed. Actual screen-reader sessions, literal 200% browser zoom, and remaining manual edge states are not yet verified.
7. **Pending customer/payment data:** do not click resume, cancel, refund, or mutate an existing production order during smoke testing without verifying ownership and intended state. Use clearly identified synthetic test accounts/orders and avoid destructive production-data operations.

## 5. Next work — ordered by dependency

### P0 — close the current release loop
- Keep the deployed revision smoke green after each future runtime release; latest verification [40168730760](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40168730760) passed against the current live release.
- Extend the new 60/60 mocked browser proof with a controlled authenticated staff run against the deployed API using approved synthetic accounts/orders; verify admin assignments, staff authorization, refresh/realtime updates, kitchen queue, dispatch handoff, delivery queue and customer timeline. Keep a clear boundary between Test Mode simulation and real fulfilment.
- Keep the nine open Dependabot PRs isolated; review compatibility and CI individually, especially major-version upgrades.

### P1 — close external-service gaps
- Verify a signed Razorpay Test Mode webhook reaches the deployed endpoint; confirm idempotent replay, nonterminal failure handling and late-capture reconciliation with test-only orders.
- Confirm the selected HTTPS email provider, verified sender and actual inbox delivery for verification/reset notifications and operational alerts.
- Test the guarded Test Mode refund and recovery workflow using eligible synthetic payment-review cases.
- Run complete admin/kitchen/delivery/customer role tests and record actual outcomes, not mocked substitutes.

### P2 — launch-readiness and quality
- Complete the manual accessibility pass (screen reader, keyboard-only, 200% zoom, empty/error/loading states and narrow mobile).
- Document operating hours, service PIN codes/radius, delivery fees/estimates, order acceptance rules, cancellation/refund policy, staff responsibilities and customer support procedures with the business owner.
- Add operational observability and a recoverable process for failed email, webhook, refund, inventory and status-update actions.
- Only after P0/P1 are green and business configuration is approved, conduct a separate Live Mode readiness review; do not automatically switch payment mode.

## 6. Release discipline

- Make small, targeted feature/fix branches; inspect actual source and Git state before editing.
- Run relevant tests/builds and wait for CI; fix failures instead of merging around them.
- Merge only reviewed changes, then verify Render deployment and hosted checks because the Render service has automatic deploy disabled.
- Update this document and README when implementation or verification status changes. Say whether evidence is unit/integration, mocked browser, hosted browser, provider-backed, or actual business operation.
- Never commit server/.env, provider/database credentials, private customer data or production exports; rotate any exposed secret using provider dashboard and hosting environment controls.
