# Pizza House — Project Status and Launch Roadmap

**Last reviewed:** 2026-10-25 (after PRs #147–#148; editorial endcaps are live, and hosted browser smoke passes 71 checks)  
**Repository:** [Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application)  
**Canonical hosted app/API:** https://pizza-house-api.onrender.com  
**Latest application/runtime commit:** 737b62a6f7df44da60b7e4f8501bccaa3dbfccea (merged PR #147; Render deploy `dep-dbf05a1srm7s73ev16g0` is live)  
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
- [PR #133](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/133) adds a real-food visual reference to the custom builder that changes according to selected ingredient category. The panel explicitly labels the image as illustrative and keeps the exact selected recipe and current calculated price authoritative; the hosted smoke changes the mushroom selection and verifies photo, recipe and price update together.
- [PR #131](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/131) adds real food photography to the Home hero, retains the local vector fallback if the external photo fails, derives the base/sauce choice count from the live catalog, and removes unverified freshness/delivery promises. Its hosted smoke requires the hero photo to be loaded and the count to match `/api/catalog`.
- [PR #119](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/119) keeps featured recipe images distinct and requires at least three distinct successfully loaded image URLs in production browser smoke.
- [PR #114](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/114) resolves featured recipe ingredient chips from the live catalog.
- [PR #116](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/116) adds recipe-backed pizza detail views and cleans up the home journey.
- [PR #95](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/95), #107, #108 and #109 cover Night Mode and lower-page parity, footer, and photo-led catalog cards; hosted browser checks are linked from the relevant PRs and Actions runs.

### Latest CI / host verification for current main

- **Pizza House CI:** [run 40197672379](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40197672379) — **passed** on current main commit `db7d6a51817c6343c097a5b6b8efc7b997e0bb62`; clean installs, dependency audit, production client build, and API/client tests succeeded.
- **Pizza House Browser Smoke:** [run 40197672504](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40197672504) — **passed 71 UI checks** against the live Render UI release. It verifies Home/menu, flat editorial endcaps in light/night mode, contextual dashboard CTA, cart thumbnails, mocked kitchen/delivery order cards, admin notification UI, and no horizontal overflow at 320, 360, 390, 640, 768, 1024 and 1440px. Staff/payment browser calls are mocked and do not prove a live transaction or real delivery.
- **Deployed smoke checks:** [run 40197672472](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40197672472) — **passed 16/16**, covering API/database readiness, catalog, CORS, auth/provider/webhook guards, website/bundle and deployed/runtime revision consistency.
- **PR #133 — recipe-aware builder visual:** [PR #133](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/133) is merged and live. The builder preview chooses category-appropriate food photography when the selected recipe changes, keeps the local vector fallback, labels the photo as illustrative, and retains current catalog ingredients and calculated price as the source of truth.
- **PR #131 — photo-led Home hero:** [PR #131](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/131) is merged. The Home hero uses real food photography with a local vector fallback; its base/sauce option count comes from the live catalog; unverified freshness/delivery promises were removed.
- **PR #127 — kitchen/delivery UI smoke:** [PR #127](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/127) added a synthetic browser-only role lifecycle and staff responsive/theme checks. [PR #128](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/128) fixed a duplicate accessible-label match and [PR #129](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/129) fixed an ambiguous order-number assertion.
- **Safety boundary for staff browser checks:** staff login/password/queue/status calls in the synthetic role drill are Playwright-mocked. Its order exists only in in-memory test state. The test does not create a real staff account or production order, contact a kitchen, charge a payment or dispatch a driver. This is UI interaction coverage, not a live authenticated staff acceptance test.
- **PR #125 — deployed revision checker:** [PR #125](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/125) is merged. It accepts deployed/tested SHAs in either ancestry direction, while failing if they are unrelated or runtime files differ, avoiding false failures when a later docs-only revision is deployed.
- **Production runtime:** Render release `dep-dbf05a1srm7s73ev16g0` is **live** on `737b62a6f7df44da60b7e4f8501bccaa3dbfccea` (merged PR #147 editorial endcap UI). PR #148 updates only the browser-test selector, not runtime code. Render automatic deploy is disabled, so runtime releases must be triggered explicitly and verified.
- **PR #147 — editorial lower-page endcaps:** [PR #147](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/147) removes repeated sparkle/ring decoration and nested mini-cards from menu, builder, bag, customer dashboard and admin endcaps. Surfaces use restrained flat light/night palettes and divider-led helper rows; dashboard copy reflects live order count and the real empty/loading/error states.
- **PR #148 — Home-to-menu smoke selector:** [PR #148](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/148) corrects a stale browser-test accessible name to the current “Browse the menu” label. Latest [browser run 40197672504](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40197672504) passed 71 checks after this change.
- **PR #143 — quarantine captures with prior refunds:** [PR #143](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/143) adds a shared refund-state guard to payment verification and captured-payment webhook reconciliation. A captured payment with `amount_refunded > 0`, or missing/malformed refund state, enters `payment_review` rather than normal fulfillment; its inventory reservation stays held. A replay for an already-processed full refund remains idempotent.
- **PR #143 test evidence:** [CI run 40193774521](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40193774521) passed the 253-test suite and build; [deployed smoke 40193774561](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40193774561) passed 16/16. Partial-refund integration coverage uses a test-only provider stub and isolated MongoDB; it does not exercise a real Razorpay transaction.
- **PR #145 — quarantine unrequested refund webhooks:** [PR #145](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/145) now flags matched paid orders for manual payment review when a refund webhook cannot be reconciled with an application-requested refund. Active, non-terminal fulfillment orders move to `payment_review`; delivered/cancelled history is preserved while the review flag is set. A signed HTTP webhook integration test verifies an active synthetic kitchen-stage order is quarantined.
- **PR #145 test evidence:** [CI run 40194226414](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40194226414) passed; [deployed smoke 40194226393](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40194226393) passed 16/16. The webhook test uses a synthetic signed payload and isolated MongoDB. It does not prove Razorpay has sent a real event to this deployed endpoint.
- **PR #140 — editorial Home hero:** [PR #140](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/140) removes decorative rings/floating badges/stamps, replaces generic hype copy and faux social proof with clear menu/product information, and uses a responsive rectangular food-photo treatment with a safe local artwork fallback.
- **PR #141 — browser smoke login sequence:** [PR #141](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/141) fixes the test so it opens the sign-in dialog before selecting admin sign-in. This repaired a real false-negative in the hosted browser run without weakening production authentication.
- **PR #135 — photo-backed order items:** [PR #135](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/135) adds item tiles to the shared order card with catalog-aware photo/illustration fallback, item quantity, recipe summary and line total. It is used by customer history and kitchen/delivery/admin views.
- **PR #136 — cart item photography:** [PR #136](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/136) makes cart thumbnails follow the selected catalog/custom recipe and retain the local artwork when the remote image fails.
- **PR #137 — release-gated browser QA:** [PR #137](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/pull/137) adds a stable app release marker so hosted smoke waits for the current UI bundle during Render rollout. The exact cart-photo and Light/Night contrast assertions stay enabled.
- **What this proves—and what it does not:** the current release is live, CI passed, the hosted browser smoke passed with photo-backed cart/order items and both-theme action contrast, and deployed API smoke passed 16/16. Staff sign-in, password rotation, queues and status transitions in that browser exercise remain mocked against a synthetic in-memory order. This does not prove live-money checkout, provider-sent webhook/refund handling, verified customer email delivery, production staff accounts or actual kitchen/driver delivery. Those remain separate launch gates.

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
- Keep the deployed revision smoke green after each future runtime release; latest verification [40197672472](https://github.com/Dheerendra07/OIBSIP-WebDev-L3-Pizza-Delivery-Full-Stack-Application/actions/runs/40197672472) passed 16/16 against the current live release.
- Extend the new 60/60 mocked browser proof with a controlled authenticated staff run against the deployed API using approved synthetic accounts/orders; verify admin assignments, staff authorization, refresh/realtime updates, kitchen queue, dispatch handoff, delivery queue and customer timeline. Keep a clear boundary between Test Mode simulation and real fulfilment.
- Keep the nine open Dependabot PRs isolated; review compatibility and CI individually, especially major-version upgrades.

### P1 — close external-service gaps
- Verify provider-sent signed Razorpay Test Mode webhooks on the deployed endpoint; confirm idempotent replay, nonterminal failure handling, prior-refund quarantine and late-capture reconciliation using explicitly synthetic Test Mode orders. The current deploy smoke checks endpoint readiness/guards, not a provider-originated event.
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
