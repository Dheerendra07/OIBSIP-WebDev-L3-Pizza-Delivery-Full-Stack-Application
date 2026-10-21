# Pizza House — Product Discovery & Differentiation Roadmap

**Owner:** Product manager / engineering  
**Last reviewed:** 2026-10-21  
**Status:** Research baseline saved; hypotheses require validation with real users  
**Current product:** Pizza House, a React/Vite + Express/Mongoose pizza ordering and inventory application

## Executive direction

Pizza House should not try to win by adding a longer menu, a chatbot, more animations, or generic "AI-powered" features. Those are easy to copy and do not fix the moments when users lose confidence. The strongest product story is **control without confusion**: know what is in stock, know what the exact total will be, know what has actually happened to the order, and have a clear path when something goes wrong. Public research points to repeated concerns around fee transparency and resolving missing/wrong orders, while accessibility guidance provides a clear standard for the UI baseline. Public complaints are evidence of possible failure modes, not a representative measurement of frequency; we have not yet interviewed Pizza House users or collected product analytics. The first iteration therefore prioritizes truthful states, accessible cards and loading/error handling before adding larger features.

## Product principle

**Trust-first food ordering:** every key screen must tell the user what is known, what is not yet known, what the next action is, and the actual amount or order status without inventing certainty.

The four moments we want to improve:
1. **Choose:** can I trust the recipe, availability and item price?
2. **Pay:** can I see the actual payable total before the payment provider opens?
3. **Wait:** does the status describe a real recorded event, or is it just a decorative progress bar?
4. **Resolve:** if the order is missing, wrong, delayed or damaged, can I report it without getting stuck in a status-dependent loop?

## Public evidence and confidence

| Signal | Source and observation | How strongly to interpret it |
|---|---|---|
| Price uncertainty | NDTV Profit reported results from a LocalCircles survey on Jan 6, 2026: up to 55% of respondents reported hidden fees/taxes or higher app menu prices, and 87% wanted dine-in and delivery prices shown side by side. The report also referenced 7,000+ grievances against delivery apps in 2024–25. | **Medium** for a broad transparency problem; these are survey/report figures, not a measurement of Pizza House users. |
| Industry-specific UX gaps | Baymard's Aug 13, 2026 benchmark assessed 8 food-delivery/takeout apps against 390+ research-based UX parameters. It reports under-supported repeat ordering, weak dietary/customization paths, unclear orientation/back paths, and insufficient fulfillment timing detail. | **Medium-high within that benchmark sample**; valuable industry-grounded signals, but not India-specific or a study of Pizza House users. |
| Missing-item reporting friction | A Reddit post in r/swiggy dated May 4, 2026 describes an order whose "missing item" support option appeared only after the app marked it delivered; the customer had already started eating and gave up on the claim. | **Low** on prevalence; useful as a concrete edge case we should test against. |
| Support/recovery frustration | An r/swiggy post dated Aug 17, 2026 described missing items combined with an inaccessible support path. Another r/Zomato thread described missing/wrong items and repeated failed resolution. | **Low** on prevalence; multiple anecdotes suggest a class of failure worth preventing, not proof that all orders/apps behave this way. |
| Consumers can escalate food-delivery issues | FSSAI's Food Safety Connect FAQ explicitly lists online aggregator/food-delivery platforms among the types of complaints consumers can lodge. | **High** for the existence of an official complaint route; this does not mean every ordering issue belongs with FSSAI. |
| Accessible interaction is measurable | W3C WCAG 2.2 specifies visible focus, focus not obscured, and a 24×24 CSS-pixel minimum target criterion with exceptions. Our internal design target should be at least 44×44 for important touch controls where layout permits. | **High** for the standard itself; we must test the actual UI before claiming conformance. |
| Simplicity and transparent fees are an active competitive angle | Wired reported in Oct 2026 that Olo launched a US food-ordering app emphasizing regular menu prices and a flat service fee rather than typical higher markups and ad-heavy discovery. | **Medium** as a competitor example, not proof that the same pricing model is viable for an Indian single-restaurant project. |

### Source links

- NDTV Profit / LocalCircles, *Three in Four Customers Of Food Delivery Platforms Report Hidden Fees, Taxes And Higher App Menu Price* (Jan 6, 2026): https://www.ndtvprofit.com/business/three-in-four-customers-of-food-delivery-platforms-report-hidden-fees-taxes-and-higher-app-menu-price-10374238/amp/1
- Reddit, r/swiggy, missing item unavailable before delivery was confirmed (May 4, 2026): https://www.reddit.com/r/swiggy/comments/1t3q0nt/one_item_was_missing_in_my_order/
- Reddit, r/swiggy, broken app/missing food/support friction (Aug 17, 2026): https://www.reddit.com/r/swiggy/comments/1vqk0y8/broken_app_missing_food_no_support/
- FSSAI Food Safety Connect consumer grievance FAQ: https://foscos.fssai.gov.in/consumergrievance/faqs
- W3C WAI, What's New in WCAG 2.2: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- W3C WAI, Focus Visible: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible
- W3C WAI, Target Size Minimum: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- Wired, Olo launches a food-ordering app built around menu-price transparency (Oct 2026): https://www.wired.com/story/olo-new-food-delivery-app-could-be-the-antidote-to-menu-markups
- Baymard Institute, *Food Delivery & Takeout UX Benchmark* (Aug 13, 2026): https://baymard.com/research-articles/food-delivery-and-takeout-ux-benchmark-2026

## Code audit: verified issues in current source

Source reviewed on 2026-10-20: `client/src/App.jsx`, `client/src/styles.css`, `client/src/api.js`, `client/src/checkout.js`, `client/src/delivery.js`, `client/src/pendingPayment.js`, `server/src/models/Order.js`, `server/src/utils/orderRules.js`, `server/src/controllers/orderController.js`, and `server/src/services/refunds.js`.

1. **Card skeleton/loading states — implemented in PR #20.** The initial audit found that the `loading` state was not rendered; the merged implementation now provides shared card-shaped loading states for menu, builder, dashboard and admin data panels. The visual timing/announcement behavior still needs browser QA.
2. **Catalog and payment quote trust — implementation landed in PRs #20 and #21.** Catalog errors now have a visible retry path instead of presenting hard-coded defaults as confirmed stock/prices. Before payment, checkout compares the cart against the server-priced order and requires explicit review when an item, recipe, subtotal, delivery fee or total differs. Browser-level outage/recovery scenarios remain to be exercised.
3. **Card and status typography — P0.3 baseline in PR #22.** The initial audit found 7–10px operational text and 28×28px quantity controls. PR #22 raises the sizes of important operational text, increases control targets, and makes mobile inventory fields visibly labelled. Actual rendered layouts and contrast still require browser verification.
4. **Motion/accessibility baseline — broader automated browser pass completed; manual audit pending.** Visible focus and `prefers-reduced-motion` support are present, and PR #22 increases key touch targets. PR #31 validates issue-dialog keyboard handling at 320px; PR #33 validates success/error live regions; PR #35 fixes baseline contrast findings; PR #37 fixes contrast on builder prices/ingredient labels, cart notes and admin metric labels, and adds auth-dialog and mobile-nav focus management. A Playwright + axe-core 4.10.3 harness reported zero WCAG 2.1 A/AA violations over 31 rendered scans across home, menu, builder, populated cart, auth dialog, customer dashboard and admin dashboard after the fixes. The primary home/menu/builder/cart paths showed no horizontal overflow from 320–1440px at the tested widths. Actual NVDA/VoiceOver sessions, literal full-site 200% browser zoom, axe checks marked incomplete and remaining error/recovery states still need manual review.
5. **The existing palette has a coherent starting point, but roles are inconsistent.** Existing core colors are warm paper `#FBF8F2`, ink `#282522`, muted `#79736C`, border `#EAE4DB`, clay `#C94C2C` and olive `#59694A`. Several components also hard-code one-off colors, making consistent redesign and contrast checks harder.
6. **The order UI shows stage labels but not an event history.** It can show a current stage, but a later version should distinguish recorded updates and their timestamps from predicted timing. Do not invent a live ETA until actual delivery data supports it.
7. **The app already has strong payment safety work.** Delivery validation, server-priced orders, payment review/refund paths and same-session payment verification recovery are present in source. New UX work must not weaken these server-side checks or pretend external integration is fully tested.

8. **Safe repeat-order flow — merged in PR #23.** Customer order cards show “Order again” only for delivered/cancelled records outside payment-review holds. `client/src/reorder.js` rebuilds the recipe from the current catalog; it uses today's feature price or current ingredient price formula, refuses missing/retired/unavailable ingredients and invalid quantities, and returns no partial cart. The handler blocks while a payment verification or checkout is unresolved, asks before replacing an existing bag, and never starts payment automatically. The server-priced checkout/quote review remains the final authority. Ten focused utility scenarios pass in a local isolated Node.js 22.16.0 harness. The full 124-test repository suite and Vite production build also passed in the isolated browser-runner workspace; Chrome rendered the home, order history and repeat-order cart on desktop plus order history at 390px mobile using mocked API responses, with no page errors or horizontal overflow. Real API/payment/email journeys remain unverified.

This audit began as source-only. A later Chrome preview exercised the actual frontend source with mocked API responses; that confirms client rendering and selected interactions, but does not prove deployed or external-service behavior.

## Prioritized opportunity backlog

### P0 — fix first: reliable UI states and trust

**P0.1 Shared card-state system (implemented in PR #20; browser QA pending)**
- Provide consistent `loading`, `content`, `empty`, `error/retry`, `disabled` and `offline/stale` patterns for menu cards, order cards and admin data panels.
- Skeletons must match the card's actual shape, use a subtle shimmer or static pulse, and respect reduced-motion preference.
- Loading skeletons should be announced as loading once per region, not once per card. Hide decorative skeleton shapes from assistive technology.
- Errors should say what failed and provide a real retry action; never render a fake "no orders" empty state when a request failed.
- Acceptance: home/menu show aligned skeleton cards while the catalog is loading; builder, dashboard metrics/order history, and admin inventory/review/order panels each have matching skeleton geometry; no default/hard-coded catalog is shown as current stock/price after an API failure; retry recovers to content when the API comes back; empty results remain distinct from failed requests; reduced-motion users do not receive shimmer animations.

**P0.2 Truthful catalog state and authoritative price (implemented in PR #21; live-flow QA pending)**
- Treat catalog status as a real state machine: loading → ready, or error → retry; do not silently fall back to static prices/availability as if they were live.
- Before opening Razorpay, compare what the user saw with the server-priced order returned by the API. If server totals/items differ, stop before creating the payment order, show the updated authoritative breakdown, and require the user to confirm again.
- Acceptance: API outage shows a visible retry state; no purchasable stale menu appears; a server price change never silently proceeds to payment.

**P0.3 Consistent visual and accessibility foundation (source changes in PR #22; rendered QA pending)**
- Keep the existing warm pizza-house identity rather than apply a random new theme: paper/cream background, deep ink, clay-orange primary action and olive secondary accent. Centralize semantic color roles in CSS tokens.
- Define card, badge, price row, status chip, field, primary/secondary/destructive action, skeleton and empty/error state patterns.
- Minimum product standards: normal body text generally 14–16px, secondary/meta text generally at least 12px, 1.45+ line-height for readable copy, visible focus on every keyboard action, no color-only statuses, and at least 44×44px for important touch controls wherever practical. Validate contrast rather than guessing from color names.
- Add `prefers-reduced-motion`; no critical action may depend on hover or animation.
- Acceptance: 320px mobile width without horizontal overflow, 200% text zoom without lost controls, keyboard-only journey, readable status labels/icons, and reduced-motion mode with no shimmer/transform animations.

### P1 — differentiation through user control

**P1.1 "Fix it without fighting" order-help flow**
- Put a Report a problem entry directly on each order record; do not make the issue-entry path depend exclusively on the order having a final "delivered" status.
- Offer specific categories: missing item, wrong item/recipe, damaged/spilled, delivery/delay, payment/refund, other.
- Prefill the order number/items/time so the customer does not type it all again. For "missing item", do not require a photo of the item that is absent; allow optional supporting evidence where appropriate.
- Create a reference ID and visible status (received, reviewing, resolved, more information requested). Admin sees the same case and can add a resolution note.
- Do not promise an automatic refund or claim a complaint was sent to an external platform unless that integration actually exists. Use source facts only; retain audit history.

**P1.2 No silent substitutions**
- If an ingredient becomes unavailable before the kitchen starts, present options and price delta, and obtain explicit consent before changing the recipe. If no response is received, use a documented safe policy (hold/cancel/refund workflow), not an unapproved swap.
- This can build on the current inventory and custom-pizza model; only implement the workflow after the UI state foundation is stable.

**P1.3 One-tap repeat order, with a price-change safety check**
- Place a clear “Order again” action on a prior order; prefill its saved recipe/items and quantities so repeat customers do not rebuild the same order from scratch.
- Before checkout, compare the saved recipe with the live catalog. Mark unavailable ingredients, display current item prices plus the full delivery total, highlight every difference and require one explicit reconfirmation if anything changed. Never silently charge the old total or substitute a recipe.
- Acceptance: an unchanged available order can be restored to the bag; an unavailable item blocks submission until the customer edits it; changed prices are itemized and require confirmation; retries never create duplicate orders.
- Evidence: Baymard's 2026 benchmark found repeat-order access under-supported in its sample and order history too sparse to identify prior orders. This makes one-tap repeat plus current-price confirmation a defensible hypothesis, not a proven preference among our own users.

**P1.3 All-in budget guard**
- Let a customer set a total-budget limit and browse only recipes that fit the *final payable total*, including fees and taxes if any are introduced.
- Keep the actual order total visible as the user changes quantity/ingredients. Never add default-on paid add-ons or hide a fee until the payment screen.

### P2 — high value but dependent on real operational data

**P2.1 Ingredient confidence / allergen clarity**

**P2.1 Ingredient confidence / allergen clarity**
- Provide a dietary/customization decision path at the menu/filter and item-detail level using verified ingredients, not just a badge on a card. Distinguish "ingredient not listed" from "contains none"; never label a pizza allergen-free without validated recipe and cross-contact controls. Keep a visible kitchen cross-contact caveat where relevant.
- Evidence: Baymard's 2026 benchmark found dietary/customization needs lacked a supported path across its evaluated decision points; investigate with local users before settling labels and filter taxonomy.
- Requires a reliable catalog data source and kitchen process, so do not build from guesses.

**P2.2 Need-by planning / delivery confidence**
- Do not advertise guaranteed arrival by a requested time based only on a decorative ETA. Build only after there are real prep/delivery event timestamps and enough observations to validate estimates.

**P2.3 Low-waste packing options**
- Offer packaging/napkin/condiment choices only if kitchen fulfilment can honour them and make the choice obvious. Keep this below order reliability and issue resolution.

## Visual system baseline to preserve and improve

- **Brand:** warm, editorial, premium but approachable; do not change to a generic purple/gradient dashboard.
- **Core semantic roles:** canvas, surface, raised surface, primary text, secondary text, border, primary action, primary-hover, success, warning, danger, info, focus ring, skeleton base/highlight.
- **Cards:** consistent radius/border/padding; title and price hierarchy; stable card height; one primary action; status label paired with icon/text; visible disabled reason; hover is enhancement only.
- **Skeleton cards:** same geometry as real cards; stable width/height to prevent layout shift; shimmer disabled with reduced motion; aria-hidden decorative shapes plus one polite status message for the region.
- **Order cards:** current state, last confirmed update time once available, item/recipe summary, final amount, delivery summary only where needed, and a clear action for next step or issue report.
- **No false precision:** no fake star counts, social proof, "live" rider maps, guaranteed ETAs or unsupported ingredient promises.

## Dependency audit follow-up

- `npm audit --prefix server` found one high-severity Nodemailer advisory with the prior `^7.0.9` range.
- Nodemailer `^10.1.7` is now merged via PR #24. The isolated install reports zero server audit findings and passed all 124 tests plus the production client build; real SMTP sends remain to be verified.
- PR #26 adds root/server/client lockfiles and switches `install:all`/CI to `npm ci`, with lockfile-aware npm cache configuration. Clean installs passed on Node 22.22.2/npm 10.9.7, along with 124/124 tests, production build, and zero root/server/client audit findings. Real SMTP sending remains unverified.

## Current implementation checkpoint — safe repeat order

- **Research basis:** Baymard's 2026 food-delivery benchmark reports weak access to repeat orders and sparse order-history cues in the eight evaluated sites/apps. This is a strong product hypothesis, not proof that Pizza House customers prefer it; validate with task-based user sessions.
- **User contract:** rebuild the previous recipe, not the previous price. Use current item/ingredient prices; block stale or unavailable recipes without silently substituting; don't replace a non-empty bag without consent; don't interrupt pending payment verification; never automatically reopen checkout.
- **Card contract:** action appears only on delivered/cancelled orders, never on a payment-review record; copy explains that current prices apply; button has a 44px minimum height and stacks cleanly on narrow mobile screens.
- **Loading contract:** customer order-list skeleton cards reserve the footer shape before data arrives, preventing the new CTA from abruptly changing card height; admin skeleton cards do not show that customer-only action.
- **Verification:** 10 focused repeat-order utility cases passed; the full 141-test repository suite and Vite production build passed on Node 22.22.2/npm 10.9.7 in an isolated workspace. Root/server/client audits reported zero vulnerabilities. Chrome rendered home, order history, repeat-order cart, issue-report dialog, admin case queue, and 390px mobile order history using mocked API responses; no page errors or horizontal overflow were recorded. These checks do not verify live DB/Razorpay/SMTP integrations.
- **Order issue reporting — merged in PR #27.** Customers can report a missing item, wrong item, quality concern, delay, or other problem against their own paid order in an eligible fulfilment state. An active case per order/customer is enforced by a partial unique index; invalid input and extra fields fail validation. Admins can see cases, move `open → under_review → resolved`, and post a message that is explicitly visible to the customer. This does not issue refunds or claim that the issue is resolved by an external provider.
- **Issue dialog keyboard handling — merged in PR #31.** The dialog focuses the category selector, traps Tab/Shift+Tab inside the modal, closes on Escape when not submitting, restores focus on close, and moves focus to the created case after success. A 320px Chrome check showed no horizontal overflow; the simulated 409 conflict remained inside the dialog. This is a targeted interaction check, not a full accessibility conformance claim.
- **Feedback announcements and control contrast — merged in PR #33.** Success messages use a polite status; action errors and retryable data warnings use assertive alerts. The 320px and 640px Chrome checks recorded no horizontal overflow; selected form control text/border contrast measured 14.99:1 / 3.41:1. The 640px check is a narrow-viewport proxy, not literal 200% browser zoom. Actual screen-reader sessions and whole-site contrast/zoom remain pending.
- **Axe contrast follow-up — merged in PRs #35 and #37.** PR #35 corrected baseline findings; the broader PR #37 rendered scan identified and fixed builder, cart and admin operational text contrast. The post-fix 31-scan browser pass reported zero WCAG 2.1 A/AA violations on the selected views. Axe left some checks incomplete; actual screen-reader sessions, literal full-site 200% zoom and manual checks remain pending.

- **Database integration regression test — merged in PR #29.** The test uses a disposable MongoDB 7.0.14 server, syncs real model indexes, and calls the actual Express endpoints. It verifies creation/listing, owner isolation, admin role, customer-visible messages, resolved-case history, persistence after reconnect, and concurrent duplicate protection via the partial unique index. Full suite passed 142/142 with this test enabled; GitHub Actions run `39517058359` passed. Root/server/client audits each reported zero vulnerabilities. This validates a disposable database, not the production/Atlas deployment.

## Delivery plan

1. **Phase 0 — discovery and UI contract:** this document; define states, tokens, acceptance checks and priority order.
2. **Phase 1 — skeleton + truthful catalog state:** one isolated branch, no broad re-theme. Implement shared card skeleton and error/retry components, remove misleading fallback presentation, add tests for the state logic and retry path.
3. **Phase 2 — visual foundation:** consolidate semantic tokens, fix small type/tap targets, reduced motion, focus and empty/error states; run a mobile/tablet/desktop manual checklist.
4. **Phase 3 — price-consent guard:** ensure any server/client price difference is shown and reconfirmed before payment starts.
5. **Phase 4 — issue-resolution flow:** first implementation merged in PR #27. Customer form/reference, admin queue, `open → under_review → resolved`, customer-visible message, allowlist validation, partial unique active-case index and auth smoke tests are in place. No automatic compensation claim. Live database index creation and configured user journeys remain pending.
6. **Phase 5 — consent-based substitution and verified ingredient disclosures.**
7. **Phase 6 — final environment setup and full external end-to-end test**, after code-side work as requested.

## Definition of done / defect discipline

A change is done only when:
- The problem and acceptance criteria are written before code changes.
- One contained change is made on an isolated branch; no direct broad rewrite of `App.jsx`/global CSS.
- Targeted tests cover success, error, empty, repeat action, reload/retry and boundary inputs as relevant.
- A manual regression checklist is recorded for mobile, keyboard and main customer/admin paths.
- Local test/build commands are run when the repository is available locally; GitHub Actions status is not treated as the sole proof or as a substitute for external integration tests.
- Failures are diagnosed to a root cause before another patch; no speculative retries, duplicate code paths or "fix until green" loops.
- The final note states exactly what was run, what passed, what was not possible, and what remains.

## Source and research limitations

This was a public-web scan plus a source-level repository review, not a statistically representative user study or live browser usability test. Reddit posts are self-selected anecdotes. Next, conduct 5–8 short task-based sessions with people who order food on mobile and ask them to: find the final total, change a recipe, understand an order status, and report a missing item. Record where each person hesitates or fails instead of asking only whether they "like" the design.
