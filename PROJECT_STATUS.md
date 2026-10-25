# Pizza House — Project Status and Launch Roadmap

**Last reviewed:** 2026-10-25  
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

### Current CI / host checks for PR #121's application/runtime commit
- **Pizza House CI:** [run 40163698652](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40163698652) — passed the configured tests and client production build.
- **Pizza House Browser Smoke:** [run 40163698528](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40163698528) — passed the hosted website browser smoke.
- **Deployed smoke checks:** [run 40163698500](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40163698500) — **failed**. Its retry loop made 20 attempts and continued to receive runtime SHA 6a15436b006765edf732cfa4f3b4ef11a419b192 instead of the expected staff-workflow commit d5ab86f8d4c64bba8b28f7b53669ef1eaf5baedc. This is a deployment/revision mismatch, not a passing verification.
- **Render deploy:** dep-dbeonugm7kps73eipdu0 targets runtime commit d5ab86f8d4c64bba8b28f7b53669ef1eaf5baedc. Render logs show the Vite build succeeded, the server started, the inventory bootstrap completed and the existing admin password was preserved. However, Render continued reporting update_in_progress and no deploy_ended/server_available event had appeared in the event list at last check. The public smoke still saw the previous runtime SHA. Treat PR #121's staff UI/API as merged and CI-tested, but do **not** claim that version is live until the deploy completes and deployed smoke passes.
- **Follow-up deploy retry:** after the smoke failure, a manual deploy of main commit a97c1debadd60d04b940a1cb0bbfb48a59dfde3c was accepted as queued: dep-dbeosarsp5es73c954ag. It is waiting behind dep-dbeonugm7kps73eipdu0; at the latest check, the older deploy still had no terminal event and the public smoke still reported the previous runtime. Open the Render service's Deploys page to inspect/cancel the stalled deployment if it has not finished, then verify the queued retry and rerun deployed smoke. A queued deploy request is not a successful release.
- CI and browser smoke are automated evidence. They do not by themselves prove real Razorpay payments, provider webhooks/refunds, customer email delivery, real staff usage or real restaurant fulfillment.

## 3. Pull-request audit snapshot

A repository-wide pull-request list returned **121 PRs** in total at review time: **109 merged**, **11 open**, and **1 closed without merge** (#14, a superseded status-document PR).

Open PRs:
- **#48–#56 (9 Dependabot PRs):** updates to GitHub Actions, concurrently, dotenv, vite, mongodb-memory-server, @vitejs/plugin-react, mongoose and lucide-react. Several cross major-version boundaries. Review and test compatibility individually; do not blindly merge the group just because the current baseline CI passes.
- **#111:** older featured-ingredient rendering follow-up. Its description overlaps the later merged ingredient fix in [#114](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/114); verify the branch diff before closing it as superseded.
- **#115:** older distinct-photo follow-up. Its description overlaps [#119](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/119); verify the branch diff before closing it as superseded.

No open PR was merged or closed as part of this documentation refresh. The pull-request list was audited by number, title, state and merge status; recent operational/UI PR descriptions and the current staff/order route files were also reviewed.

## 4. Known gaps — do not present these as done

1. **Actual business operations:** staff-role code exists, but real employees, operating hours, kitchen acceptance procedure, delivery boundaries/fees, and driver availability have not been configured or validated with a real restaurant. No third-party driver dispatch integration is claimed.
2. **Live money:** the current verified checkout evidence is Test Mode. No production/live-money order has been verified. Keep live credentials disabled until the provider, legal/business details, refund process and live operational controls are approved and tested.
3. **Webhook and refund providers:** code and automated tests exist; real provider-sent signed events, duplicate delivery against the deployed service, end-to-end refunds and failure recovery still require a controlled Test Mode exercise.
4. **Customer notifications:** an email/notification path and scheduled low-stock job exist in code, but successful end-to-end delivery to a verified real inbox is not established by the latest smoke suite. SMS/OTP delivery is not claimed; Test Mode checkout may show simulated OTP.
5. **Whole-role production journey:** the latest hosted browser smoke passed, but it has not been recorded as a complete authenticated production run from customer checkout through admin assignment, kitchen acceptance, dispatch and customer delivery update against the live provider.
6. **Accessibility:** responsive/theme and automated contrast/focus work has landed. Actual screen-reader sessions, literal 200% browser zoom, and remaining manual edge states are not yet verified.
7. **Pending customer/payment data:** do not click resume, cancel, refund, or mutate an existing production order during smoke testing without verifying ownership and intended state. Use clearly identified synthetic test accounts/orders and avoid destructive production-data operations.

## 5. Next work — ordered by dependency

### P0 — close the current release loop
- Re-check Render deployment dep-dbeonugm7kps73eipdu0 and deployed smoke run [40163698500](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40163698500); confirm deployed runtime SHA and public health/catalog responses.
- On a controlled synthetic Test Mode order, exercise customer order history, admin staff assignment, kitchen queue, dispatch handoff, delivery queue and final customer timeline. Confirm each actor's permissions and refresh/realtime behavior. Never call it a real delivery.
- Check current branch state and close stale PRs #111/#115 only after comparing their complete diffs with merged #114/#119.

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
