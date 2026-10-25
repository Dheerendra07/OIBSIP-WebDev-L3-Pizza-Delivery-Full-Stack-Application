import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const webUrl = (process.env.CLIENT_WEB_URL || 'https://pizza-house-api.onrender.com').replace(/\/$/, '');
const checks = [];
const viewportWidths = [320, 360, 390, 640, 768, 1024, 1440];
const responsiveEvidence = {};
const pageErrors = [];
const failedRequests = [];
const artifactDir = 'qa-artifacts';
let browser;

function pass(label) {
  checks.push(label);
  console.log(`[PASS] ${label}`);
}

async function captureScreenshot(page, name) {
  await page.screenshot({ path: `${artifactDir}/${name}`, fullPage: true, animations: 'disabled' });
  console.log(`[EVIDENCE] ${artifactDir}/${name}`);
}

async function auditResponsiveState(page, label) {
  const results = [];
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: width <= 640 ? 844 : 900 });
    await page.waitForTimeout(120);
    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      rootClientWidth: document.documentElement.clientWidth,
    }));
    results.push(metrics);
    if (metrics.documentWidth > width + 1) {
      responsiveEvidence[label] = results;
      throw new Error(`${label} has horizontal document overflow at ${width}px: document is ${metrics.documentWidth}px wide.`);
    }
  }
  responsiveEvidence[label] = results;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
  pass(`${label} responsive layout: no horizontal document overflow at 320, 360, 390, 640, 768, 1024 and 1440px`);
}

async function auditDashboardThemes(page, { prefix, lightScreenshot, nightScreenshot }) {
  const currentTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (currentTheme !== 'light') {
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  }
  await page.locator('.dashboard-metrics > div').first().waitFor({ state: 'visible', timeout: 15_000 });
  const dashboardEndcap = page.locator('[data-page-endcap="dashboard"]');
  await dashboardEndcap.waitFor({ state: 'visible', timeout: 15_000 });
  if (await dashboardEndcap.locator('.page-endcap-item').count() !== 3) {
    throw new Error('Customer dashboard must show all three contextual lower-page support cards.');
  }
  pass('customer dashboard includes contextual support and next-step cards below order history');
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('.dashboard-metrics > div')).backgroundColor === 'rgb(255, 255, 255)',
  );
  await captureScreenshot(page, lightScreenshot);
  await auditResponsiveState(page, `${prefix}-light`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
  await page.waitForFunction(() => (
    document.documentElement.dataset.theme === 'dark' &&
    getComputedStyle(document.querySelector('.dashboard-metrics > div')).backgroundColor === 'rgb(16, 31, 44)' &&
    getComputedStyle(document.querySelector('.dashboard-top .button-light')).backgroundColor === 'rgb(255, 98, 71)' &&
    getComputedStyle(document.querySelector('.dashboard-top .button-light')).color === 'rgb(255, 255, 255)'
  ), null, { timeout: 5000 });
  pass(`${prefix} dashboard surfaces and primary order CTA use the premium night palette`);
  await captureScreenshot(page, nightScreenshot);
  await auditResponsiveState(page, `${prefix}-night`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.waitForFunction(() => (
    document.documentElement.dataset.theme === 'light' &&
    getComputedStyle(document.querySelector('.dashboard-metrics > div')).backgroundColor === 'rgb(255, 255, 255)'
  ), null, { timeout: 5000 });
  // The following logout/session checks deliberately exercise mobile navigation;
  // leave the browser at the same 390px viewport used by the rest of this smoke.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
}

try {
  await mkdir(artifactDir, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'en-IN',
  });
  // Verify the old static hostname before testing the canonical app. This catches
  // stale CDN/deployment state as well as path/query/hash regressions.
  const legacyPage = await context.newPage();
  const legacySmokeUrl = new URL(
    '/?legacy-redirect-smoke=1#legacy',
    'https://pizza-house-web-n75h.onrender.com',
  );
  await legacyPage.goto(legacySmokeUrl.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await legacyPage.waitForURL((url) =>
    url.origin === new URL(webUrl).origin &&
    url.pathname === '/' &&
    url.searchParams.get('legacy-redirect-smoke') === '1' &&
    url.hash === '#legacy',
  { timeout: 20_000 });
  pass('legacy static frontend redirects to canonical origin and preserves path, query and hash');
  await legacyPage.close();

  const page = await context.newPage();
  // The browser drill intentionally exercises a synthetic Test Mode checkout.
  // Mock the mode explicitly instead of relying on the live Render config request
  // to finish while the API service may be deploying. No provider call is real.
  await page.route('**/api/config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, json: { paymentMode: 'test' } });
      return;
    }
    await route.continue();
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    try {
      const url = new URL(request.url());
      failedRequests.push({ url: url.origin + url.pathname, error: request.failure()?.errorText || 'unknown' });
    } catch { failedRequests.push({ url: 'unparseable-url', error: request.failure()?.errorText || 'unknown' }); }
  });

  // Wait for the actual visual release, not only older UI markers. This prevents
  // a green smoke run against a previous Render instance while a deploy is rolling out.
  let mobileSignInReady = false;
  let premiumVisualState = { variantCount: 0, primaryColor: '', footerColor: '', premiumCardCount: 0, loadedPhotoCount: 0, uniquePhotoCount: 0, interactiveCardCount: 0, ingredientCardCount: 0 };
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('.hero h1').waitFor({ state: 'visible', timeout: 30_000 });
    // Catalog data is asynchronous. Never infer a missing visual variant while
    // cards are still loading; wait for at least one live product and the known first item.
    await page.locator('.pizza-card').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await page.getByRole('heading', { name: 'Margherita Classic', exact: true }).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});

    const releaseMarkersReady =
      (await page.locator('.mobile-auth-link').count() === 1) &&
      (await page.locator('[data-mobile-auth-focus="dialog-first"]').count() === 1) &&
      (await page.locator('[data-payment-provider-check="readonly-admin-v1"]').count() === 1) &&
      (await page.locator('[data-auth-toast-fix="clear-stale-toast-v1"]').count() === 1) &&
      (await page.locator('[data-theme-toggle]').count() === 1) &&
      (await page.locator('[data-home-hero="premium-food-v1"]').count() === 1) &&
      (await page.locator('[data-pizza-card-version="premium-photo-v1"]').count() >= 3) &&
      (await page.locator('[data-cart-photo-release="catalog-photo-v1"]').count() === 1) &&
      (await page.locator('[data-notification-health-release="admin-notifications-v1"]').count() === 1);

    premiumVisualState = await page.locator('[data-pizza-card-version="premium-photo-v1"]').evaluateAll((cards) => {
      const names = ['tomato', 'green', 'orange', 'cream'];
      const variants = cards.map((card) => names.find((name) => card.classList.contains(name))).filter(Boolean);
      const loadedPhotoCount = cards.filter((card) => {
        const image = card.querySelector('.pizza-card-photo');
        return Boolean(image && image.complete && image.naturalWidth > 0 && card.classList.contains('has-photo'));
      }).length;
      const loadedPhotoSources = cards
        .filter((card) => {
          const image = card.querySelector('.pizza-card-photo');
          return Boolean(image && image.complete && image.naturalWidth > 0 && card.classList.contains('has-photo'));
        })
        .map((card) => card.querySelector('.pizza-card-photo')?.currentSrc || '')
        .filter(Boolean);
      const uniquePhotoCount = new Set(loadedPhotoSources).size;
      const interactiveCardCount = cards.filter((card) =>
        card.querySelector('.pizza-card-quantity') &&
        card.querySelector('.pizza-card-price strong') &&
        card.querySelector('.pizza-card-total strong') &&
        card.querySelector('.add-button:not(:disabled)') &&
        card.querySelector('.customize-link'),
      ).length;
      const ingredientCardCount = cards.filter((card) => {
        const chips = [...card.querySelectorAll('.pizza-card-ingredients .pizza-ingredient-chip:not(.ingredient-more)')]
          .map((chip) => chip.textContent.trim());
        return chips.length > 0 && chips.every((chip) => chip && chip !== 'House recipe');
      }).length;
      const primary = document.querySelector('.hero .button-dark');
      const footer = document.querySelector('.site-footer');
      const heroImage = document.querySelector('[data-home-hero-photo="premium-food-v1"]');
      const homeHeroPhotoLoaded = Boolean(
        heroImage && heroImage.complete && heroImage.naturalWidth > 0 &&
        heroImage.closest('.hero-pizza')?.classList.contains('has-photo'),
      );
      return {
        homeHeroPhotoLoaded,
        variantCount: new Set(variants).size,
        primaryColor: primary ? getComputedStyle(primary).backgroundColor : '',
        footerColor: footer ? getComputedStyle(footer).backgroundColor : '',
        premiumCardCount: cards.length,
        loadedPhotoCount,
        uniquePhotoCount,
        interactiveCardCount,
        ingredientCardCount,
      };
    }).catch(() => ({ homeHeroPhotoLoaded: false, variantCount: 0, primaryColor: '', footerColor: '', premiumCardCount: 0, loadedPhotoCount: 0, uniquePhotoCount: 0, interactiveCardCount: 0, ingredientCardCount: 0 }));

    if (releaseMarkersReady &&
        premiumVisualState.homeHeroPhotoLoaded === true &&
        premiumVisualState.premiumCardCount >= 3 &&
        premiumVisualState.loadedPhotoCount >= 3 &&
        premiumVisualState.uniquePhotoCount >= 3 &&
        premiumVisualState.interactiveCardCount >= 3 &&
        premiumVisualState.ingredientCardCount >= premiumVisualState.premiumCardCount &&
        premiumVisualState.variantCount >= 3 &&
        premiumVisualState.primaryColor === 'rgb(228, 71, 50)' &&
        premiumVisualState.footerColor === 'rgb(16, 39, 55)') {
      mobileSignInReady = true;
      break;
    }

    console.log(
      '[WAIT] waiting for premium photo-card release (' + attempt + '/20; cards=' +
      premiumVisualState.premiumCardCount + '; loadedPhotos=' + premiumVisualState.loadedPhotoCount +
      '; interactive=' + premiumVisualState.interactiveCardCount +
      '; uniquePhotos=' + premiumVisualState.uniquePhotoCount +
      '; heroPhoto=' + premiumVisualState.homeHeroPhotoLoaded +
      '; ingredientCards=' + premiumVisualState.ingredientCardCount + '; variants=' +
      premiumVisualState.variantCount + '; CTA=' + premiumVisualState.primaryColor +
      '; footer=' + premiumVisualState.footerColor + ')',
    );
    await page.waitForTimeout(5_000);
  }
  if (!mobileSignInReady) {
    throw new Error('Hosted site did not publish a loaded food-photo hero plus three distinct, loaded premium cards with working controls and the navy/red visual release after 20 checks: ' + JSON.stringify(premiumVisualState));
  }
  pass('home hero displays a loaded real-food photograph with the local vector fallback retained');
  pass('production publishes three distinct premium photo cards with all three food photos loaded');
  pass('premium cards expose working quantity, catalog-price, subtotal and cart controls');
  pass('every premium card shows real ingredient names instead of the fallback label');
  pass('primary CTA uses tomato red and the footer uses the navy brand surface');

  await page.locator('[data-pizza-card-version="premium-photo-v1"]').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('heading', { name: 'Margherita Classic', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  const firstPremiumCard = page.locator('[data-pizza-card-version="premium-photo-v1"]').first();

  const liveMenuResponse = await page.request.get(`${webUrl}/api/catalog`, { timeout: 10_000 });
  if (!liveMenuResponse.ok()) throw new Error('The live catalog endpoint failed during ingredient chip verification.');
  const liveMenu = await liveMenuResponse.json();
  const expectedBaseAndSauceCount = (liveMenu.catalog?.bases?.length || 0) + (liveMenu.catalog?.sauces?.length || 0);
  const displayedBaseAndSauceCount = Number((await page.locator('.hero-proof strong').innerText()).trim());
  if (!expectedBaseAndSauceCount || displayedBaseAndSauceCount !== expectedBaseAndSauceCount) {
    throw new Error('Home hero base/sauce count does not match the live catalog: ' + JSON.stringify({ expectedBaseAndSauceCount, displayedBaseAndSauceCount }));
  }
  pass('home hero choice count matches the current live base and sauce catalog');
  const firstPizzaId = await firstPremiumCard.getAttribute('data-pizza-id');
  const firstLivePizza = liveMenu?.featuredPizzas?.find((pizza) => pizza.id === firstPizzaId);
  if (!firstLivePizza || !liveMenu?.catalog) throw new Error('Could not match the first featured card to the live catalog API.');

  const catalogOptionName = (group, id) => liveMenu.catalog[group]?.find((option) => option.id === id)?.name || '';
  const recipe = firstLivePizza.ingredients || {};
  const expectedIngredientLabels = [
    catalogOptionName('bases', recipe.base),
    catalogOptionName('sauces', recipe.sauce),
    catalogOptionName('cheeses', recipe.cheese),
    ...(Array.isArray(recipe.vegetables) ? recipe.vegetables.map((id) => catalogOptionName('vegetables', id)) : []),
  ].filter(Boolean).slice(0, 4);
  const renderedIngredientLabels = (await firstPremiumCard.locator('.pizza-card-ingredients .pizza-ingredient-chip:not(.ingredient-more)').allInnerTexts())
    .map((label) => label.trim());
  if (expectedIngredientLabels.length === 0 ||
      JSON.stringify(renderedIngredientLabels) !== JSON.stringify(expectedIngredientLabels)) {
    throw new Error('Featured ingredient chips do not match the live API recipe and catalog names: ' +
      JSON.stringify({ expectedIngredientLabels, renderedIngredientLabels, firstPizzaId }));
  }
  pass('featured ingredient chips match the live API recipe IDs and catalog names');

  const initialCardPricing = await firstPremiumCard.evaluate((card) => ({
    quantity: card.querySelector('.pizza-card-quantity > span')?.textContent?.trim() || '',
    price: card.querySelector('.pizza-card-price strong')?.textContent?.trim() || '',
    subtotal: card.querySelector('.pizza-card-total strong')?.textContent?.trim() || '',
    photoLoaded: Boolean(card.querySelector('.pizza-card-photo')?.naturalWidth > 0),
  }));
  if (initialCardPricing.quantity !== '1' || !initialCardPricing.price ||
      initialCardPricing.price === 'Unavailable' || initialCardPricing.subtotal !== initialCardPricing.price ||
      !initialCardPricing.photoLoaded) {
    throw new Error('The first premium card did not render an image and a consistent live menu price: ' + JSON.stringify(initialCardPricing));
  }
  await firstPremiumCard.locator('button[aria-label^="Increase "]').click();
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-pizza-card-version="premium-photo-v1"]');
    return card?.querySelector('.pizza-card-quantity > span')?.textContent?.trim() === '2';
  }, null, { timeout: 5_000 });
  const doubleQuantitySubtotal = await firstPremiumCard.locator('.pizza-card-total strong').innerText();
  if (doubleQuantitySubtotal === initialCardPricing.subtotal) {
    throw new Error('The premium card subtotal did not update after increasing quantity: ' + JSON.stringify({ initialCardPricing, doubleQuantitySubtotal }));
  }
  await firstPremiumCard.locator('button[aria-label^="Decrease "]').click();
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-pizza-card-version="premium-photo-v1"]');
    return card?.querySelector('.pizza-card-quantity > span')?.textContent?.trim() === '1';
  }, null, { timeout: 5_000 });
  const restoredSubtotal = await firstPremiumCard.locator('.pizza-card-total strong').innerText();
  if (restoredSubtotal !== initialCardPricing.subtotal) {
    throw new Error('The premium card subtotal did not restore after returning to quantity one.');
  }
  pass('premium card quantity controls update the subtotal and restore the original price');

  // Opening a live card must navigate to the richer recipe/detail page.
  await firstPremiumCard.locator('.pizza-card-view-button').click();
  const detailPage = page.locator('[data-pizza-detail]');
  await detailPage.waitFor({ state: 'visible', timeout: 10_000 });
  if (await detailPage.getAttribute('data-pizza-id') !== firstPizzaId) {
    throw new Error('The card opened a detail page for the wrong pizza.');
  }
  await page.locator('.pizza-detail-media.has-photo').waitFor({ state: 'visible', timeout: 15_000 });
  const detailData = await detailPage.evaluate((root) => ({
    name: root.querySelector('h1')?.textContent?.trim() || '',
    quantity: root.querySelector('.pizza-detail-quantity-wrap .pizza-card-quantity > span')?.textContent?.trim() || '',
    price: root.querySelector('.pizza-detail-price-line strong')?.textContent?.trim() || '',
    subtotal: root.querySelector('.pizza-detail-subtotal strong')?.textContent?.trim() || '',
    imageLoaded: Boolean(root.querySelector('.pizza-detail-photo')?.naturalWidth > 0),
    ingredientLabels: [...root.querySelectorAll('.pizza-detail-ingredient')].map((el) => el.textContent.trim()),
  }));
  if (detailData.name !== firstLivePizza.name || detailData.quantity !== '1' ||
      detailData.price !== initialCardPricing.price || detailData.subtotal !== initialCardPricing.price ||
      !detailData.imageLoaded ||
      !expectedIngredientLabels.every((label) => detailData.ingredientLabels.includes(label))) {
    throw new Error('Pizza detail page does not match the live catalog card: ' + JSON.stringify({ detailData, expectedIngredientLabels, initialCardPricing }));
  }
  pass('tapping a featured photo opens the correct product detail with live recipe, photo and price');

  await detailPage.locator('.pizza-detail-quantity-wrap button[aria-label^="Increase "]').click();
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-pizza-detail]');
    return root?.querySelector('.pizza-detail-quantity-wrap .pizza-card-quantity > span')?.textContent?.trim() === '2';
  }, null, { timeout: 5_000 });
  const detailDoubleSubtotal = await detailPage.locator('.pizza-detail-subtotal strong').innerText();
  if (detailDoubleSubtotal === initialCardPricing.subtotal) {
    throw new Error('Detail-page quantity did not update its subtotal.');
  }
  await detailPage.locator('.pizza-detail-quantity-wrap button[aria-label^="Decrease "]').click();
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-pizza-detail]');
    return root?.querySelector('.pizza-detail-quantity-wrap .pizza-card-quantity > span')?.textContent?.trim() === '1';
  }, null, { timeout: 5_000 });
  if (await detailPage.locator('.pizza-detail-subtotal strong').innerText() !== initialCardPricing.subtotal) {
    throw new Error('Detail-page subtotal did not restore after returning quantity to one.');
  }
  pass('detail-page quantity selector updates and restores the selected subtotal');
  await captureScreenshot(page, '17-pizza-detail-mobile.png');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(150);
  await captureScreenshot(page, '18-pizza-detail-desktop.png');
  await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5_000 });
  await captureScreenshot(page, '19-pizza-detail-night-desktop.png');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await detailPage.locator('.pizza-detail-breadcrumb').getByRole('button', { name: 'Back to home', exact: true }).click();
  await page.locator('.hero h1').waitFor({ state: 'visible', timeout: 10_000 });
  pass('detail-page Light/Night Mode toggles and back navigation work');
  pass('home featured cards wait for live catalog before visual capture');
  await captureScreenshot(page, '01-home-mobile.png');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  if (await page.locator('.main-nav .mobile-auth-link').isVisible()) {
    throw new Error('Mobile-only sign-in link must stay hidden in the desktop navigation.');
  }
  pass('desktop header shows only one sign-in action');
  await captureScreenshot(page, '02-home-desktop.png');
  const builderPromo = page.locator('[data-home-builder-promo]');
  await builderPromo.waitFor({ state: 'visible', timeout: 10_000 });
  const builderPromoState = await builderPromo.evaluate((el) => ({
    title: el.querySelector('h3')?.textContent?.trim() || '',
    body: el.querySelector('p')?.textContent?.trim() || '',
    button: el.querySelector('button')?.textContent?.trim() || '',
    proofCount: el.querySelectorAll('.custom-callout-proof span').length,
  }));
  if (!builderPromoState.title.includes('pizza made around your cravings') ||
      !builderPromoState.body.includes('See your recipe and price') ||
      !builderPromoState.button.includes('Create your pizza') ||
      builderPromoState.proofCount !== 2 ||
      await page.locator('[data-page-endcap="home"], .last-word, .callout-watermark').count() !== 0) {
    throw new Error('Home lower section still contains decorative filler or is missing the useful builder CTA: ' + JSON.stringify(builderPromoState));
  }
  const footerNavCount = await page.locator('.footer-nav button').count();
  if (footerNavCount < 4) throw new Error('Footer is missing expected navigation shortcuts.');
  if (await page.locator('.footer-brand .brand-name small').innerText() !== 'LIVE MENU · CLEAR PRICES') {
    throw new Error('Footer brand tagline is not the current product-led label.');
  }
  pass('home lower section uses a direct builder CTA with live ingredient and pricing value');
  pass('generic home quote/endcap filler is removed and footer copy is product-led');
  pass('shared footer provides working navigation shortcuts');
  await captureScreenshot(page, '15-home-builder-promo-light-desktop.png');
  await auditResponsiveState(page, 'home');

  // The custom builder has its own option cards, recipe preview, pricing and
  // quantity controls. Audit it in both themes instead of assuming home styles
  // prove every product surface is readable.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.main-nav').getByRole('button', { name: 'Build your own', exact: true }).click();
  await page.getByRole('heading', { name: /The art of your slice/i }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.builder-summary').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('heading', { name: 'Your masterpiece.' }).waitFor({ state: 'visible' });
  const builderPreview = page.locator('[data-builder-preview]');
  await builderPreview.waitFor({ state: 'visible', timeout: 10_000 });
  const initialBuilderVisual = await builderPreview.evaluate((root) => ({
    source: root.getAttribute('data-builder-preview-source') || '',
    loaded: Boolean(root.querySelector('.summary-pizza-photo')?.naturalWidth > 0 && root.classList.contains('has-photo')),
    badge: root.querySelector('.summary-badge')?.textContent?.trim() || '',
    note: root.querySelector('.summary-photo-note')?.textContent?.trim() || '',
    price: document.querySelector('.builder-summary .summary-total strong')?.textContent?.trim() || '',
  }));
  if (!initialBuilderVisual.loaded || initialBuilderVisual.badge !== 'VISUAL REFERENCE' ||
      !initialBuilderVisual.note.includes('Illustrative food photo') ||
      !initialBuilderVisual.note.includes('selected recipe is listed below') || !initialBuilderVisual.price) {
    throw new Error('Builder preview must load a real reference photo, disclose that it is illustrative, and retain the exact selected-recipe price: ' + JSON.stringify(initialBuilderVisual));
  }
  const mushroomsOption = page.locator('.veg-grid .veg-option').filter({ hasText: 'Mushrooms' }).first();
  await mushroomsOption.click();
  await page.waitForFunction((previousSource) => {
    const preview = document.querySelector('[data-builder-preview]');
    return Boolean(preview && preview.getAttribute('data-builder-preview-source') !== previousSource &&
      preview.querySelector('.summary-pizza-photo')?.naturalWidth > 0 && preview.classList.contains('has-photo'));
  }, initialBuilderVisual.source, { timeout: 10_000 });
  const changedBuilderVisual = await builderPreview.evaluate((root) => ({
    source: root.getAttribute('data-builder-preview-source') || '',
    selectedRecipe: document.querySelector('.builder-summary .summary-ingredients')?.innerText || '',
    price: document.querySelector('.builder-summary .summary-total strong')?.textContent?.trim() || '',
  }));
  if (changedBuilderVisual.source === initialBuilderVisual.source ||
      !changedBuilderVisual.selectedRecipe.includes('Mushrooms') ||
      changedBuilderVisual.price === initialBuilderVisual.price) {
    throw new Error('Changing selected toppings must update the reference photo, exact recipe summary and price: ' + JSON.stringify({ initialBuilderVisual, changedBuilderVisual }));
  }
  pass('builder photo reference changes with selected toppings while the exact recipe and price stay visible');
  const builderLight = await page.locator('.builder-summary').evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    heading: getComputedStyle(el.querySelector('.summary-body h2')).color,
  }));
  if (builderLight.background !== 'rgb(255, 255, 255)') {
    throw new Error('The builder preview did not keep its light-mode surface: ' + JSON.stringify(builderLight));
  }
  const builderEndcapLight = page.locator('[data-page-endcap="builder"]');
  await builderEndcapLight.waitFor({ state: 'visible', timeout: 15_000 });
  if ((await builderEndcapLight.locator('.page-endcap-item').count()) !== 3) {
    throw new Error('Builder must render all three lower-page helper cards in light mode.');
  }
  pass('custom pizza builder and its lower-page helper cards render in light mode');
  await captureScreenshot(page, '11-builder-light-desktop.png');
  await auditResponsiveState(page, 'builder');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
  await page.waitForFunction(() => (
    document.documentElement.dataset.theme === 'dark' &&
    getComputedStyle(document.querySelector('.builder-summary')).backgroundColor === 'rgb(16, 30, 43)' &&
    getComputedStyle(document.querySelector('.builder-summary .summary-body h2')).color === 'rgb(243, 246, 248)'
  ), null, { timeout: 5000 });
  const builderEndcapNight = await page.locator('[data-page-endcap="builder"]').evaluate((el) => ({
    backgroundImage: getComputedStyle(el).backgroundImage,
    cardBackground: getComputedStyle(el.querySelector('.page-endcap-item')).backgroundColor,
  }));
  if (builderEndcapNight.backgroundImage === 'none' || builderEndcapNight.cardBackground !== 'rgb(16, 32, 45)') {
    throw new Error('Builder lower-page cards are not using the night palette: ' + JSON.stringify(builderEndcapNight));
  }
  pass('custom builder and lower-page cards use the premium night palette');
  await captureScreenshot(page, '12-builder-night-desktop.png');
  await auditResponsiveState(page, 'builder-night');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.locator('.main-nav').getByRole('button', { name: 'Home', exact: true }).click();
  await page.locator('.hero h1').waitFor({ state: 'visible', timeout: 15_000 });

  const initialTheme = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: window.localStorage.getItem('pizza-house-theme'),
  }));
  if (initialTheme.theme !== 'light' || initialTheme.stored !== 'light') {
    throw new Error('Fresh visits must use the light theme by default; received ' + JSON.stringify(initialTheme));
  }
  pass('light theme remains the default on a fresh visit');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(180);
  await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
  // The primary CTA animates its background when the root theme token changes.
  // Wait for the transition to finish so this assertion tests the final palette,
  // not the first animation frame with the old light-mode color.
  await page.waitForFunction(() => (
    document.documentElement.dataset.theme === 'dark' &&
    getComputedStyle(document.querySelector('.hero .button-dark')).backgroundColor === 'rgb(255, 98, 71)'
  ), null, { timeout: 5000 });
  const nightState = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: window.localStorage.getItem('pizza-house-theme'),
    colorScheme: document.documentElement.style.colorScheme,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    primaryColor: getComputedStyle(document.querySelector('.hero .button-dark')).backgroundColor,
    footerColor: getComputedStyle(document.querySelector('.site-footer')).backgroundColor,
  }));
  if (nightState.theme !== 'dark' || nightState.stored !== 'dark' ||
      nightState.colorScheme !== 'dark' ||
      nightState.bodyBackground !== 'rgb(7, 19, 30)' ||
      nightState.primaryColor !== 'rgb(255, 98, 71)' ||
      nightState.footerColor !== 'rgb(4, 10, 16)') {
    throw new Error('Night mode did not apply/persist the expected premium palette: ' + JSON.stringify(nightState));
  }
  pass('night mode applies the dark navy palette, warm CTA and matching footer');
  const homePromoNight = await page.locator('[data-home-builder-promo]').evaluate((el) => ({
    titleColor: getComputedStyle(el.querySelector('h3')).color,
    iconBackground: getComputedStyle(el.querySelector('.callout-icon')).backgroundColor,
    ctaBackground: getComputedStyle(el.querySelector('.button-light')).backgroundColor,
    ctaColor: getComputedStyle(el.querySelector('.button-light')).color,
    proofCount: el.querySelectorAll('.custom-callout-proof span').length,
  }));
  if (homePromoNight.titleColor !== 'rgb(247, 249, 250)' ||
      homePromoNight.iconBackground !== 'rgb(27, 51, 66)' ||
      homePromoNight.ctaBackground !== 'rgb(255, 209, 122)' ||
      homePromoNight.ctaColor !== 'rgb(25, 42, 52)' ||
      homePromoNight.proofCount !== 2) {
    throw new Error('Home builder CTA did not switch to the premium night palette: ' + JSON.stringify(homePromoNight));
  }
  pass('Home builder CTA retains readable copy, clear CTA contrast and recipe-price proofs in Night Mode');
  await captureScreenshot(page, '16-home-builder-promo-night-desktop.png');
  await captureScreenshot(page, '07-home-night-desktop.png');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.hero h1').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('heading', { name: 'Margherita Classic', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  const restoredTheme = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: window.localStorage.getItem('pizza-house-theme'),
  }));
  if (restoredTheme.theme !== 'dark' || restoredTheme.stored !== 'dark') {
    throw new Error('Night mode preference was not restored after reload: ' + JSON.stringify(restoredTheme));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await captureScreenshot(page, '08-home-night-mobile.png');
  await auditResponsiveState(page, 'home-night');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  const lightRestored = await page.evaluate(() => window.localStorage.getItem('pizza-house-theme'));
  if (lightRestored !== 'light') throw new Error('Switching back to light mode did not persist the preference.');
  pass('light/night toggle persists across reload and can return to light');

  await page.getByRole('button', { name: 'Explore the menu' }).click();
  await page.locator('.pizza-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('heading', { name: 'Margherita Classic', exact: true }).waitFor({ state: 'visible' });
  const menuEndcap = page.locator('[data-page-endcap="menu"]');
  await menuEndcap.waitFor({ state: 'visible', timeout: 15_000 });
  if (await menuEndcap.locator('.page-endcap-item').count() !== 3) {
    throw new Error('Menu page must show all three live-catalog and checkout helper cards.');
  }
  await captureScreenshot(page, '03-menu-mobile.png');
  await auditResponsiveState(page, 'menu');
  await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const menuEndcapNight = await menuEndcap.evaluate((el) => ({
    cardBackground: getComputedStyle(el.querySelector('.page-endcap-item')).backgroundColor,
    cardText: getComputedStyle(el.querySelector('.page-endcap-item h3')).color,
  }));
  if (menuEndcapNight.cardBackground !== 'rgb(16, 32, 45)' || menuEndcapNight.cardText !== 'rgb(237, 243, 246)') {
    throw new Error('Menu lower-page cards are not readable in night mode: ' + JSON.stringify(menuEndcapNight));
  }
  await captureScreenshot(page, '09-menu-night-mobile.png');
  await auditResponsiveState(page, 'menu-night');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  pass('hosted home and live menu render in both themes');

  await page.getByRole('button', { name: 'Add Margherita Classic', exact: true }).click();
  await page.locator('.bag-button').click();
  await page.getByRole('heading', { name: /Your little bag of joy/i }).waitFor({ state: 'visible' });
  await page.locator('.delivery-details-panel').waitFor({ state: 'visible' });
  const cartPhoto = page.locator('.cart-line [data-cart-line-photo="catalog-photo-v1"]').first();
  await cartPhoto.waitFor({ state: 'visible', timeout: 10_000 });
  if ((await cartPhoto.getAttribute('data-cart-line-photo-name')) !== 'Margherita Classic') {
    throw new Error('The cart thumbnail does not reflect the selected live menu item.');
  }
  pass('cart line renders a photo-backed thumbnail from the selected catalog item');
  const cartEndcap = page.locator('[data-page-endcap="cart"]');
  await cartEndcap.waitFor({ state: 'visible', timeout: 15_000 });
  if (await cartEndcap.locator('.page-endcap-item').count() !== 3) {
    throw new Error('Bag page must show all three delivery/payment helper cards.');
  }
  if ((await page.locator('.bag-button b').innerText()).trim() !== '1') {
    throw new Error('Adding a pizza did not update the bag count to one.');
  }
  await page.locator('.toast').waitFor({ state: 'hidden', timeout: 6_000 }).catch(() => {});
  await captureScreenshot(page, '04-bag-mobile.png');
  await auditResponsiveState(page, 'bag');
  await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const cartEndcapNight = await cartEndcap.evaluate((el) => getComputedStyle(el.querySelector('.page-endcap-item')).backgroundColor);
  if (cartEndcapNight !== 'rgb(16, 32, 45)') throw new Error('Bag lower-page cards are not using the night theme: ' + cartEndcapNight);
  await captureScreenshot(page, '10-bag-night-mobile.png');
  await auditResponsiveState(page, 'bag-night');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  pass('menu → bag → delivery form interaction in light and night themes');

  // Recreate the stale-toast condition deliberately: a cart success message is live,
  // then a customer opens Sign in immediately. The dialog must dismiss the old toast.
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('.main-nav.open').getByRole('button', { name: 'Our menu', exact: true }).click();
  await page.getByRole('button', { name: 'Add Margherita Classic', exact: true }).click();
  await page.locator('.toast').waitFor({ state: 'visible', timeout: 5_000 });
  pass('adding a pizza creates a visible success toast before auth opens');

  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const mobileNav = page.locator('.main-nav.open');
  await mobileNav.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  if (await page.locator('.toast').count()) {
    throw new Error('Opening sign-in left a stale toast on top of the authentication dialog.');
  }
  pass('opening sign-in clears stale cart toast before showing the dialog');
  await auditResponsiveState(page, 'sign-in-dialog');
  await captureScreenshot(page, '05-sign-in-dialog-mobile.png');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('.main-nav.open').getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  const authNightState = await dialog.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    heading: getComputedStyle(el.querySelector('h2')).color,
  }));
  if (authNightState.background !== 'rgb(16, 31, 44)' || authNightState.heading !== 'rgb(244, 247, 249)') {
    throw new Error('Night-mode sign-in dialog lost its contrast palette: ' + JSON.stringify(authNightState));
  }
  pass('sign-in dialog keeps high-contrast text and surfaces in night mode');
  await captureScreenshot(page, '13-sign-in-dialog-night-mobile.png');
  await auditResponsiveState(page, 'sign-in-dialog-night');
  const loginEmail = dialog.getByLabel('Email address');
  await loginEmail.waitFor({ state: 'visible' });
  if (!(await loginEmail.evaluate((element) => document.activeElement === element))) {
    throw new Error('Opening sign-in from the mobile menu must move keyboard focus into the dialog.');
  }
  pass('mobile sign-in opens with focus inside the dialog');
  await loginEmail.fill(`qa-smoke-${Date.now()}@example.invalid`);
  await dialog.getByLabel('Password').fill('NotARealPassword123');

  const loginResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  if (loginResponse.status() === 401) {
    await page.getByRole('alert').filter({ hasText: /Email or password is incorrect/i })
      .waitFor({ state: 'visible', timeout: 10_000 });
    pass('invalid-credential response reaches the browser accessibly');
  } else if (loginResponse.status() === 429) {
    await page.getByRole('alert').filter({ hasText: /Too many attempts\. Please try again later\./i })
      .waitFor({ state: 'visible', timeout: 10_000 });
    pass('auth rate-limit response reaches the browser accessibly');
  } else {
    throw new Error('A sign-in probe for a deliberately nonexistent account returned HTTP ' + loginResponse.status() + '; expected 401 or the configured auth rate limit 429.');
  }

  // Inspect signup UI only. Do not create a production account or send an email.
  await dialog.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByRole('heading', { name: 'Make yourself at home.' }).waitFor({ state: 'visible' });
  await dialog.getByLabel('Your name').waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Create my account', exact: true }).waitFor({ state: 'visible' });
  pass('signup form renders without creating a production account');

  // Optional credential-backed production QA. Use a dedicated verified QA customer,
  // never an admin account; no order/payment is created by this path.
  const qaEmail = (process.env.PIZZA_QA_CUSTOMER_EMAIL || '').trim();
  const qaPassword = process.env.PIZZA_QA_CUSTOMER_PASSWORD || '';
  if (Boolean(qaEmail) !== Boolean(qaPassword)) {
    throw new Error('Configure both PIZZA_QA_CUSTOMER_EMAIL and PIZZA_QA_CUSTOMER_PASSWORD secrets to enable successful customer-session QA.');
  }

  if (qaEmail && qaPassword) {
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await dialog.getByLabel('Email address').fill(qaEmail);
    await dialog.getByLabel('Password').fill(qaPassword);

    const qaLoginResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/login' &&
      response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    const qaLoginResponse = await qaLoginResponsePromise;
    if (qaLoginResponse.status() !== 200) {
      throw new Error(`Configured QA customer login returned HTTP ${qaLoginResponse.status()}; expected 200.`);
    }

        const qaSessionCookie = (await context.cookies(webUrl))
      .find((cookie) => cookie.name === 'pizza_session');
    if (!qaSessionCookie || !qaSessionCookie.httpOnly || !qaSessionCookie.secure || qaSessionCookie.sameSite !== 'Lax') {
      throw new Error('Successful QA login did not persist a Secure, HttpOnly, SameSite=Lax session cookie in the browser.');
    }

    await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
    await page.locator('.account-button').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.account-button').click();
    await page.getByRole('heading', { name: /Good to see you,/ }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.toast').waitFor({ state: 'hidden', timeout: 6_000 }).catch(() => {});
    await auditDashboardThemes(page, {
      prefix: 'live-customer-dashboard',
      lightScreenshot: '06-live-customer-dashboard.png',
      nightScreenshot: '14-live-customer-dashboard-night.png',
    });

    const sessionRefreshResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/me' &&
      response.request().method() === 'GET',
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const sessionRefreshResponse = await sessionRefreshResponsePromise;
    if (sessionRefreshResponse.status() !== 200) {
      throw new Error(`QA session did not survive a full-page reload: /api/auth/me returned HTTP ${sessionRefreshResponse.status()}.`);
    }
    await page.locator('.account-button').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.account-button').click();
    await page.getByRole('heading', { name: /Good to see you,/ }).waitFor({ state: 'visible', timeout: 15_000 });
    pass('QA customer login issues Secure/HttpOnly/SameSite=Lax cookie and session survives a full-page reload');

    const logoutResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/logout' &&
      response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const logoutResponse = await logoutResponsePromise;
    if (logoutResponse.status() !== 200) {
      throw new Error(`QA logout returned HTTP ${logoutResponse.status()}; expected 200.`);
    }
    await page.locator('.account-button').waitFor({ state: 'hidden', timeout: 15_000 });

    const unauthenticatedMePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/me' &&
      response.request().method() === 'GET',
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const unauthenticatedMe = await unauthenticatedMePromise;
    if (unauthenticatedMe.status() !== 401) {
      throw new Error(`QA logout did not clear the session cookie; /api/auth/me returned HTTP ${unauthenticatedMe.status()}.`);
    }
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.locator('.main-nav.open').getByRole('button', { name: 'Sign in', exact: true })
      .waitFor({ state: 'visible', timeout: 15_000 });
    pass('QA logout clears the browser session and remains signed out after reload');
  } else {
    // No production test account is required for this deterministic UI flow.
    // Mock only auth/session endpoints after all read-only live smoke checks have finished.
    const mockedUser = {
      id: 'browser-smoke-customer',
      name: 'Browser QA Customer',
      email: 'browser-qa@example.invalid',
      role: 'user',
    };
    const mockedSessionCookie = 'pizza_session=browser-smoke-session';
    let activeMockedUser = null;
    let qaCheckoutOrder = null;
    let qaOpsOrder = null;
    const staffLoginCases = {
      kitchen: {
        email: 'kitchen-qa@example.invalid',
        temporaryPassword: 'TempKitchenPass123',
        newPassword: 'KitchenPass2026',
        user: { id: 'browser-smoke-kitchen', name: 'Browser QA Kitchen', role: 'kitchen', mustChangePassword: true },
      },
      delivery: {
        email: 'delivery-qa@example.invalid',
        temporaryPassword: 'TempDeliveryPass123',
        newPassword: 'DeliveryPass2026',
        user: { id: 'browser-smoke-delivery', name: 'Browser QA Delivery', role: 'delivery', mustChangePassword: true },
      },
    };

    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.route('**/api/auth/login', async (route) => {
      const body = route.request().postDataJSON();
      if (body?.email !== mockedUser.email || body?.password !== 'MockOnlyPass123') {
        await route.fulfill({ status: 400, json: { error: 'Unexpected mock sign-in input.' } });
        return;
      }
      activeMockedUser = mockedUser;
      await route.fulfill({
        status: 200,
        headers: {
          'set-cookie': mockedSessionCookie + '; Path=/; HttpOnly; Secure; SameSite=Lax',
        },
        json: { user: mockedUser },
      });
    });
    await page.route('**/api/auth/staff/login', async (route) => {
      const body = route.request().postDataJSON();
      const entry = Object.values(staffLoginCases).find((candidate) =>
        candidate.email === body?.email && candidate.temporaryPassword === body?.password,
      );
      if (!entry) {
        await route.fulfill({ status: 401, json: { error: 'Invalid staff test credentials.' } });
        return;
      }
      activeMockedUser = { ...entry.user, email: entry.email };
      await route.fulfill({
        status: 200,
        headers: {
          'set-cookie': mockedSessionCookie + '; Path=/; HttpOnly; Secure; SameSite=Lax',
        },
        json: { user: activeMockedUser },
      });
    });
    await page.route('**/api/auth/staff/change-password', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON();
      const entry = staffLoginCases[activeMockedUser?.role];
      if (!entry || body?.currentPassword !== entry.temporaryPassword ||
          typeof body?.newPassword !== 'string' || body.newPassword.length < 10) {
        await route.fulfill({ status: 400, json: { error: 'Invalid mocked staff password rotation.' } });
        return;
      }
      activeMockedUser = { ...activeMockedUser, mustChangePassword: false };
      await route.fulfill({ status: 200, json: { user: activeMockedUser } });
    });
    await page.route('**/api/auth/me', async (route) => {
      const hasSession = (route.request().headers().cookie || '').includes(mockedSessionCookie);
      await route.fulfill({
        status: hasSession && activeMockedUser ? 200 : 401,
        json: hasSession && activeMockedUser ? { user: activeMockedUser } : { error: 'Sign in to continue' },
      });
    });
    await page.route('**/api/orders/my', async (route) => {
      const visibleOrder = activeMockedUser?.role === 'user'
        ? qaOpsOrder?.status === 'delivered'
          ? qaOpsOrder
          : qaCheckoutOrder?.paymentStatus === 'paid' ? qaCheckoutOrder : null
        : null;
      await route.fulfill({ status: 200, json: { orders: visibleOrder ? [visibleOrder] : [] } });
    });
    await page.route('**/api/ops/orders**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const role = activeMockedUser?.role;
      if (!['kitchen', 'delivery'].includes(role)) {
        await route.fulfill({ status: 401, json: { error: 'Sign in to continue' } });
        return;
      }
      if (pathname === '/api/ops/orders' && request.method() === 'GET') {
        const visibleForRole = role === 'kitchen'
          ? ['order_received', 'in_kitchen'].includes(qaOpsOrder?.status)
          : ['in_kitchen', 'sent_to_delivery', 'delivered'].includes(qaOpsOrder?.status);
        await route.fulfill({
          status: 200,
          json: { orders: visibleForRole && qaOpsOrder ? [qaOpsOrder] : [], role },
        });
        return;
      }
      if (pathname === '/api/ops/orders/browser-smoke-ops-order/status' && request.method() === 'PATCH') {
        const body = request.postDataJSON();
        const allowed = role === 'kitchen'
          ? (qaOpsOrder?.status === 'order_received' && body?.status === 'in_kitchen') ||
            (qaOpsOrder?.status === 'in_kitchen' && body?.status === 'sent_to_delivery')
          : role === 'delivery' && qaOpsOrder?.status === 'sent_to_delivery' && body?.status === 'delivered';
        if (!allowed || !qaOpsOrder) {
          await route.fulfill({ status: 400, json: { error: 'The mocked staff transition is not allowed.' } });
          return;
        }
        const now = new Date().toISOString();
        qaOpsOrder = {
          ...qaOpsOrder,
          status: body.status,
          ...(body.status === 'in_kitchen' ? { kitchenStartedAt: now } : {}),
          ...(body.status === 'sent_to_delivery' ? { dispatchedAt: now } : {}),
          ...(body.status === 'delivered' ? { deliveredAt: now } : {}),
        };
        await route.fulfill({ status: 200, json: { order: { ...qaOpsOrder, fulfillmentMode: 'simulated' } } });
        return;
      }
      await route.fulfill({ status: 404, json: { error: 'Unexpected mocked operations route.' } });
    });
    await page.route('**/api/issues/my', (route) =>
      route.fulfill({ status: 200, json: { issues: [] } }),
    );
    await page.route('**/api/auth/logout', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      activeMockedUser = null;
      await route.fulfill({
        status: 200,
        headers: {
          'set-cookie': 'pizza_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
        },
        json: { message: 'Signed out' },
      });
    });

    await dialog.getByLabel('Email address').fill(mockedUser.email);
    await dialog.getByLabel('Password').fill('MockOnlyPass123');
    const simulatedLoginResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/login' &&
      response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    const simulatedLoginResponse = await simulatedLoginResponsePromise;
    if (simulatedLoginResponse.status() !== 200) {
      throw new Error('Simulated successful customer login returned HTTP ' + simulatedLoginResponse.status() + '; expected 200.');
    }
    // Because the API is mocked in this branch, simulate the browser state change
    // that its real Set-Cookie response performs; this is a UI/session-state test.
    await context.addCookies([{
      name: 'pizza_session',
      value: 'browser-smoke-session',
      url: webUrl,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    }]);
    const browserCookies = await context.cookies(webUrl);
    const sessionCookie = browserCookies.find((cookie) => cookie.name === 'pizza_session');
    if (!sessionCookie || !sessionCookie.httpOnly || !sessionCookie.secure || sessionCookie.sameSite !== 'Lax') {
      throw new Error('Browser did not persist the simulated secure HttpOnly SameSite=Lax session cookie.');
    }
    await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
    await page.locator('.account-button').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.account-button').click();
    await page.getByRole('heading', { name: /Good to see you,.*Browser/i }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.toast').waitFor({ state: 'hidden', timeout: 6_000 }).catch(() => {});
    await auditDashboardThemes(page, {
      prefix: 'mocked-customer-dashboard',
      lightScreenshot: '06-mocked-customer-dashboard.png',
      nightScreenshot: '14-mocked-customer-dashboard-night.png',
    });
    pass('simulated successful customer login updates the UI and stores a secure session cookie');

    const sessionRefreshResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/me' &&
      response.request().method() === 'GET',
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const sessionRefreshResponse = await sessionRefreshResponsePromise;
    if (sessionRefreshResponse.status() !== 200) {
      throw new Error('Simulated session did not survive a full-page reload: /api/auth/me returned HTTP ' + sessionRefreshResponse.status() + '.');
    }
    await page.locator('.account-button').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.account-button').click();
    await page.getByRole('heading', { name: /Good to see you,.*Browser/i }).waitFor({ state: 'visible', timeout: 15_000 });
    pass('simulated signed-in customer session is restored after a full-page reload');

    // Mock the entire order/payment boundary for a safe browser-only checkout drill.
    // These routes never reach the live Order database or Razorpay.
    const qaCheckoutOrderId = '64b000000000000000000099';
    const qaFeatured = {
      margherita: {
        name: 'Margherita Classic',
        unitPrice: 249,
        ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['tomato'] },
      },
      garden: {
        name: 'Garden Party',
        unitPrice: 329,
        ingredients: { base: 'thin', sauce: 'pesto', cheese: 'mozzarella', vegetables: ['capsicum', 'onion', 'mushroom', 'olive'] },
      },
      firecracker: {
        name: 'Firecracker',
        unitPrice: 359,
        ingredients: { base: 'pan', sauce: 'spicy-arrabbiata', cheese: 'cheddar', vegetables: ['jalapeno', 'onion', 'corn'] },
      },
      'white-garden': {
        name: 'White Garden',
        unitPrice: 379,
        ingredients: { base: 'whole-wheat', sauce: 'white-garlic', cheese: 'vegan', vegetables: ['mushroom', 'capsicum', 'tomato'] },
      },
    };
    let qaOrderCreateCalls = 0;
    let qaOrderFetchCalls = 0;
    let qaDeliveryPatchCalls = 0;
    let qaPaymentCreateCalls = 0;
    let qaVerifyCalls = 0;
    const qaPaymentOrderIds = [];
    const qaVerifyBodies = [];

    await page.route('**/api/orders', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      qaOrderCreateCalls += 1;
      const body = route.request().postDataJSON();
      if (!Array.isArray(body?.items) || body.items.length < 1 ||
          body.items.some((line) => line.type !== 'featured' || !qaFeatured[line.pizzaId])) {
        await route.fulfill({ status: 400, json: { error: 'Checkout QA expected a supported featured-pizza basket.' } });
        return;
      }
      const items = body.items.map((line) => {
        const pizza = qaFeatured[line.pizzaId];
        const quantity = Number(line.quantity);
        return {
          name: pizza.name,
          quantity,
          unitPrice: pizza.unitPrice,
          lineTotal: pizza.unitPrice * quantity,
          ingredients: pizza.ingredients,
        };
      });
      const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
      const deliveryFee = subtotal >= 499 ? 0 : 29;
      qaCheckoutOrder = {
        id: qaCheckoutOrderId,
        orderNumber: 'PH-BROWSER-QA',
        items,
        deliveryDetails: body.deliveryDetails,
        subtotal,
        deliveryFee,
        total: subtotal + deliveryFee,
        status: 'pending_payment',
        paymentStatus: 'pending',
        paymentMode: 'test',
      };
      await route.fulfill({ status: 201, json: { order: qaCheckoutOrder, reused: false } });
    });

    await page.route(`**/api/orders/${qaCheckoutOrderId}`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      qaOrderFetchCalls += 1;
      await route.fulfill({ status: 200, json: { order: qaCheckoutOrder } });
    });

    await page.route(`**/api/orders/${qaCheckoutOrderId}/delivery-details`, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      qaDeliveryPatchCalls += 1;
      const body = route.request().postDataJSON();
      qaCheckoutOrder = { ...qaCheckoutOrder, deliveryDetails: body.deliveryDetails };
      await route.fulfill({ status: 200, json: { order: qaCheckoutOrder } });
    });

    await page.route('**/api/payments/create-order', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      qaPaymentCreateCalls += 1;
      const body = route.request().postDataJSON();
      qaPaymentOrderIds.push(body?.orderId);
      if (body?.orderId !== qaCheckoutOrderId || !qaCheckoutOrder) {
        await route.fulfill({ status: 400, json: { error: 'Checkout QA order identity mismatch.' } });
        return;
      }
      if (qaPaymentCreateCalls === 1) {
        await route.fulfill({ status: 503, json: { error: 'QA simulated Razorpay provider outage.' } });
        return;
      }
      await route.fulfill({
        status: 200,
        json: {
          keyId: 'rzp_test_browser_mock',
          amount: qaCheckoutOrder.total * 100,
          currency: 'INR',
          paymentOrderId: 'order_test_browser_mock',
          orderNumber: qaCheckoutOrder.orderNumber,
          orderId: qaCheckoutOrder.id,
          customer: { name: 'Browser QA Customer', email: 'browser-qa@example.invalid', contact: '9876543210' },
        },
      });
    });

    await page.route('**/api/payments/verify', async (route) => {
      if (route.request().method() === 'POST') {
        qaVerifyCalls += 1;
        qaVerifyBodies.push(route.request().postDataJSON());
        if (qaVerifyCalls === 1) {
          await route.fulfill({ status: 503, json: { error: 'QA simulated temporary verification outage.' } });
          return;
        }
        qaCheckoutOrder = {
          ...qaCheckoutOrder,
          status: 'order_received',
          paymentStatus: 'paid',
          paidAt: new Date().toISOString(),
        };
        await route.fulfill({
          status: 200,
          json: { order: { id: qaCheckoutOrderId, orderNumber: qaCheckoutOrder.orderNumber, status: 'order_received', paymentStatus: 'paid', paymentReviewRequired: false } },
        });
        return;
      }
      await route.continue();
    });

    await page.evaluate(() => {
      window.__qaRazorpayOpenCount = 0;
      window.__qaRazorpayEvents = {};
      window.__qaRazorpayConfigs = [];
      window.Razorpay = function (options) {
        window.__qaRazorpayConfigs.push({
          key: options.key,
          amount: options.amount,
          currency: options.currency,
          orderId: options.order_id,
          handler: options.handler,
        });
        this.on = (eventName, callback) => { window.__qaRazorpayEvents[eventName] = callback; };
        this.open = () => { window.__qaRazorpayOpenCount += 1; };
      };
    });

    await page.locator('.bag-button').click();
    await page.getByRole('heading', { name: /Where should we send your pizza/i }).waitFor({ state: 'visible' });
    await page.getByLabel('Recipient name').fill('Browser QA Customer');
    await page.getByLabel('10-digit mobile number').fill('9876543210');
    await page.getByLabel('House / street address').fill('42 Model Town Street');
    await page.getByLabel('City').fill('Meerut');
    await page.getByLabel('State').fill('Uttar Pradesh');
    await page.getByLabel('6-digit PIN code').fill('250001');
    const checkoutButton = page.getByRole('button', { name: 'Checkout securely', exact: true });
    await checkoutButton.waitFor({ state: 'visible', timeout: 15_000 });
    if (await checkoutButton.isDisabled()) throw new Error('Mock checkout was disabled despite a signed-in customer, live catalog and valid delivery details.');
    const bagLineCountBeforeCheckout = await page.locator('.cart-line').count();
    const totalBeforeCheckout = await page.locator('.price-row.final').innerText();

    const firstOrderCreation = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/orders' && response.request().method() === 'POST',
    );
    const firstProviderAttempt = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/payments/create-order' && response.request().method() === 'POST',
    );
    await checkoutButton.click();
    const firstOrderResponse = await firstOrderCreation;
    const firstPaymentResponse = await firstProviderAttempt;
    if (firstOrderResponse.status() !== 201 || firstPaymentResponse.status() !== 503) {
      throw new Error('Checkout QA expected a mocked order followed by a mocked provider outage; received ' +
        firstOrderResponse.status() + ' and ' + firstPaymentResponse.status() + '.');
    }
    await page.getByRole('alert').filter({ hasText: /QA simulated Razorpay provider outage/i })
      .waitFor({ state: 'visible', timeout: 10_000 });
    if (await page.locator('.cart-line').count() !== bagLineCountBeforeCheckout ||
        await page.locator('.price-row.final').innerText() !== totalBeforeCheckout ||
        qaOrderCreateCalls !== 1 || qaPaymentCreateCalls !== 1 ||
        await page.evaluate(() => window.__qaRazorpayOpenCount) !== 0) {
      throw new Error('Provider failure changed the bag/order unexpectedly or opened Razorpay before provider details were ready.');
    }
    pass('provider creation failure preserves the basket and leaves checkout safely retryable');

    const retryProviderAttempt = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/payments/create-order' && response.request().method() === 'POST',
    );
    await checkoutButton.click();
    const retryPaymentResponse = await retryProviderAttempt;
    if (retryPaymentResponse.status() !== 200) {
      throw new Error('A provider retry for the same pending order did not recover; received HTTP ' + retryPaymentResponse.status() + '.');
    }
    await page.waitForFunction(() => window.__qaRazorpayOpenCount === 1, null, { timeout: 5000 });
    const razorpayConfig = await page.evaluate(() => window.__qaRazorpayConfigs.at(-1));
    if (qaOrderCreateCalls !== 1 || qaOrderFetchCalls < 1 || qaDeliveryPatchCalls < 1 ||
        qaPaymentCreateCalls !== 2 || qaPaymentOrderIds.some((id) => id !== qaCheckoutOrderId) ||
        razorpayConfig?.orderId !== 'order_test_browser_mock') {
      throw new Error('Retry created a duplicate order or opened the wrong mocked payment order.');
    }
    pass('checkout retry reuses the original pending order and opens only the mocked payment provider');

    await page.evaluate(() => {
      const failed = window.__qaRazorpayEvents['payment.failed'];
      if (typeof failed !== 'function') throw new Error('Mock Razorpay did not register its payment.failed handler.');
      failed({ error: { description: 'Browser QA simulated payment failure' } });
    });
    await page.getByRole('alert').filter({ hasText: /Payment failed\. You can safely retry the same order/i })
      .waitFor({ state: 'visible', timeout: 10_000 });
    if (qaOrderCreateCalls !== 1 || qaPaymentCreateCalls !== 2 || qaVerifyCalls !== 0 ||
        await page.locator('.cart-line').count() !== bagLineCountBeforeCheckout ||
        await page.locator('.price-row.final').innerText() !== totalBeforeCheckout) {
      throw new Error('A failed mock payment triggered verification/duplicate order creation or changed the customer basket.');
    }
    pass('payment.failed shows safe-retry guidance without verification or duplicate order creation');

    // Retrying checkout after a failed attempt must still use the existing order;
    // then simulate a paid response while verification is temporarily unavailable.
    const secondCheckoutAttempt = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/payments/create-order' && response.request().method() === 'POST',
    );
    await checkoutButton.click();
    const secondCheckoutResponse = await secondCheckoutAttempt;
    if (secondCheckoutResponse.status() !== 200) {
      throw new Error('Retry after payment.failed did not reopen the same mocked checkout; received HTTP ' + secondCheckoutResponse.status() + '.');
    }
    await page.waitForFunction(() => window.__qaRazorpayOpenCount === 2, null, { timeout: 5000 });
    const secondRazorpayConfig = await page.evaluate(() => window.__qaRazorpayConfigs.at(-1));
    if (qaOrderCreateCalls !== 1 || qaPaymentCreateCalls !== 3 ||
        qaPaymentOrderIds.some((id) => id !== qaCheckoutOrderId) ||
        secondRazorpayConfig?.orderId !== 'order_test_browser_mock') {
      throw new Error('Retry after payment.failed created a second order or changed the provider order ID.');
    }

    const mockPaidResponse = {
      razorpay_order_id: 'order_test_browser_mock',
      razorpay_payment_id: 'pay_test_browser_mock',
      razorpay_signature: 'a'.repeat(64),
    };
    const firstVerificationResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/payments/verify' && response.request().method() === 'POST',
    );
    await page.evaluate((response) => {
      const handler = window.__qaRazorpayConfigs.at(-1)?.handler;
      if (typeof handler !== 'function') throw new Error('Mock Razorpay did not retain its payment success handler.');
      handler(response);
    }, mockPaidResponse);
    const firstVerification = await firstVerificationResponse;
    if (firstVerification.status() !== 503 || qaVerifyCalls !== 1) {
      throw new Error('The simulated paid response did not hit the expected temporary verification outage.');
    }
    await page.locator('.payment-retry-panel').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.payment-retry-panel').getByRole('button', { name: 'Retry payment confirmation', exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('alert').filter({ hasText: /Payment confirmation is incomplete\. Do not pay again yet/i })
      .waitFor({ state: 'visible', timeout: 10_000 });
    if (qaOrderCreateCalls !== 1 || qaPaymentCreateCalls !== 3 ||
        await page.locator('.cart-line').count() !== bagLineCountBeforeCheckout ||
        await page.locator('.price-row.final').innerText() !== totalBeforeCheckout) {
      throw new Error('Verification outage lost the customer basket or caused a duplicate order/payment attempt.');
    }
    pass('verification outage persists a same-payment recovery action and explicitly warns not to pay again');

    const retryVerificationResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/payments/verify' && response.request().method() === 'POST',
    );
    await page.locator('.payment-retry-panel').getByRole('button', { name: 'Retry payment confirmation', exact: true }).click();
    const retriedVerification = await retryVerificationResponsePromise;
    if (retriedVerification.status() !== 200) {
      throw new Error('Retry payment confirmation did not recover from a transient verification outage; received HTTP ' + retriedVerification.status() + '.');
    }
    await page.getByRole('heading', { name: /Good to see you,.*Browser/i }).waitFor({ state: 'visible', timeout: 15_000 });
    if (qaVerifyCalls !== 2 || JSON.stringify(qaVerifyBodies[0]) !== JSON.stringify(qaVerifyBodies[1]) ||
        qaOrderCreateCalls !== 1 || qaPaymentCreateCalls !== 3 ||
        qaVerifyBodies[1]?.orderId !== qaCheckoutOrderId ||
        qaVerifyBodies[1]?.razorpay_payment_id !== mockPaidResponse.razorpay_payment_id) {
      throw new Error('Verification retry did not resend the exact same payment confirmation or created a duplicate order/payment.');
    }
    pass('payment confirmation retry resends the same payment proof and completes without another charge attempt');

    const logoutResponsePromise = page.waitForResponse((response) =>

      new URL(response.url()).pathname === '/api/auth/logout' &&
      response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const logoutResponse = await logoutResponsePromise;
    if (logoutResponse.status() !== 200) {
      throw new Error('Simulated logout returned HTTP ' + logoutResponse.status() + '; expected 200.');
    }
    // Reflect the mocked server's cookie-expiry effect in the browser context.
    await context.clearCookies({ name: 'pizza_session' });
    await page.locator('.account-button').waitFor({ state: 'hidden', timeout: 15_000 });
    const remainingSession = (await context.cookies(webUrl)).find((cookie) => cookie.name === 'pizza_session');
    if (remainingSession) throw new Error('Simulated logout left the session cookie in the browser context.');

    const unauthenticatedMePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/me' &&
      response.request().method() === 'GET',
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const unauthenticatedMe = await unauthenticatedMePromise;
    if (unauthenticatedMe.status() !== 401) {
      throw new Error('Simulated logout did not persist after reload: /api/auth/me returned HTTP ' + unauthenticatedMe.status() + '.');
    }
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.locator('.main-nav.open').getByRole('button', { name: 'Sign in', exact: true })
      .waitFor({ state: 'visible', timeout: 15_000 });
    pass('simulated logout clears the cookie and remains signed out after reload');

    // Staff lifecycle drill: every auth, queue and stage request below is intercepted
    // by Playwright. It never creates a production staff account or changes a real order.
    qaOpsOrder = {
      id: 'browser-smoke-ops-order',
      orderNumber: 'PH-OPS-QA',
      user: { name: 'Browser QA Customer', email: 'browser-qa@example.invalid' },
      items: [{
        name: 'Margherita Classic',
        quantity: 1,
        unitPrice: 249,
        lineTotal: 249,
        ingredients: { base: 'classic', sauce: 'classic-tomato', cheese: 'mozzarella', vegetables: ['tomato'] },
      }],
      deliveryDetails: {
        recipientName: 'Browser QA Customer',
        phone: '9876543210',
        addressLine: '42 Model Town Street',
        city: 'Meerut',
        state: 'Uttar Pradesh',
        postalCode: '250001',
        landmark: 'Model Town',
        instructions: 'Synthetic browser smoke order — not a real delivery.',
      },
      subtotal: 249,
      deliveryFee: 29,
      total: 278,
      status: 'order_received',
      paymentStatus: 'paid',
      paymentMode: 'test',
      paymentReviewRequired: false,
      createdAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
      kitchenStartedAt: null,
      dispatchedAt: null,
      deliveredAt: null,
      kitchenStaff: { id: staffLoginCases.kitchen.user.id, name: staffLoginCases.kitchen.user.name, active: true },
      deliveryStaff: { id: staffLoginCases.delivery.user.id, name: staffLoginCases.delivery.user.name, active: true },
    };

    async function openStaffLogin(entry) {
      await page.locator('.main-nav.open').getByRole('button', { name: 'Sign in', exact: true }).click();
      await dialog.getByRole('button', { name: 'Kitchen / delivery sign in', exact: true }).click();
      await dialog.getByLabel('Email address').fill(entry.email);
      await dialog.getByLabel('Password').fill(entry.temporaryPassword);
      const loginResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/auth/staff/login' &&
        response.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Sign in to operations', exact: true }).click();
      const loginResponse = await loginResponsePromise;
      if (loginResponse.status() !== 200) {
        throw new Error('Mocked ' + entry.user.role + ' login returned HTTP ' + loginResponse.status() + '.');
      }
      await context.addCookies([{
        name: 'pizza_session',
        value: 'browser-smoke-session',
        url: webUrl,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      }]);
      await page.getByRole('heading', { name: 'Set your private password.', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
      await page.getByLabel('Temporary password').fill(entry.temporaryPassword);
      await page.getByLabel('New password', { exact: true }).fill(entry.newPassword);
      await page.getByLabel('Confirm new password').fill(entry.newPassword);
      const rotateResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/auth/staff/change-password' &&
        response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: /Set password & open queue/ }).click();
      const rotateResponse = await rotateResponsePromise;
      if (rotateResponse.status() !== 200) {
        throw new Error('Mocked ' + entry.user.role + ' first-login password rotation returned HTTP ' + rotateResponse.status() + '.');
      }
      const queueHeading = entry.user.role === 'kitchen' ? /Kitchen queue/ : /Your delivery/;
      await page.getByRole('heading', { name: queueHeading }).waitFor({ state: 'visible', timeout: 15_000 });
      await page.getByText('SANDBOX WORKFLOW', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
      const visibleStaffOrder = page.locator('.order-card[data-order-id="browser-smoke-ops-order"]');
      const previewItems = visibleStaffOrder.locator('[data-order-card-item]');
      if (await previewItems.count() !== 1 || (await previewItems.first().getAttribute('data-order-card-item-name')) !== 'Margherita Classic') {
        throw new Error('The staff order card did not render the item preview from the synthetic order payload.');
      }
      if (!(await previewItems.first().locator('.order-card-item-photo').isVisible())) {
        throw new Error('The staff order card photo fallback is missing.');
      }
      pass('staff queue order card renders photo-backed item tiles from order data in both kitchen and delivery views');
      pass('mocked ' + entry.user.role + ' first sign-in forces a password change before showing the assigned queue');
    }

    async function signOutMockedStaff() {
      const logoutResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/auth/logout' &&
        response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      const logoutResponse = await logoutResponsePromise;
      if (logoutResponse.status() !== 200) throw new Error('Mocked staff sign-out failed.');
      await context.clearCookies({ name: 'pizza_session' });
      await page.locator('.account-button').waitFor({ state: 'hidden', timeout: 10_000 });
      await page.getByRole('button', { name: 'Open menu', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.locator('.main-nav.open').getByRole('button', { name: 'Sign in', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    }

    const kitchenEntry = staffLoginCases.kitchen;
    await openStaffLogin(kitchenEntry);
    const kitchenOrder = page.locator('.order-card[data-order-id="browser-smoke-ops-order"]');
    await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await captureScreenshot(page, '16-mocked-kitchen-queue-night.png');
    await auditResponsiveState(page, 'mocked-kitchen-queue-night');
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');

    const acceptResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/ops/orders/browser-smoke-ops-order/status' &&
      response.request().method() === 'PATCH',
    );
    await kitchenOrder.getByRole('button', { name: 'Accept & start preparation', exact: true }).click();
    const acceptResponse = await acceptResponsePromise;
    if (acceptResponse.status() !== 200) throw new Error('Kitchen acceptance UI did not receive the mocked success response.');
    await kitchenOrder.getByRole('button', { name: 'Mark prepared & hand to delivery', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    pass('kitchen can accept an assigned paid order and start preparation; customer-facing copy remains explicitly simulated');

    const handoffResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/ops/orders/browser-smoke-ops-order/status' &&
      response.request().method() === 'PATCH',
    );
    await kitchenOrder.getByRole('button', { name: 'Mark prepared & hand to delivery', exact: true }).click();
    const handoffResponse = await handoffResponsePromise;
    if (handoffResponse.status() !== 200 || qaOpsOrder.status !== 'sent_to_delivery' || !qaOpsOrder.dispatchedAt) {
      throw new Error('Kitchen hand-off did not set the synthetic order to dispatched with a timestamp.');
    }
    await kitchenOrder.waitFor({ state: 'hidden', timeout: 10_000 });
    pass('kitchen hand-off moves the synthetic order into the delivery queue and leaves kitchen queue clear');

    await signOutMockedStaff();
    const deliveryEntry = staffLoginCases.delivery;
    await openStaffLogin(deliveryEntry);
    const deliveryOrder = page.locator('.order-card[data-order-id="browser-smoke-ops-order"]');
    await deliveryOrder.getByRole('button', { name: 'Confirm delivery completed', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await captureScreenshot(page, '17-mocked-delivery-run-light.png');
    await auditResponsiveState(page, 'mocked-delivery-run-light');

    const deliveryResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/ops/orders/browser-smoke-ops-order/status' &&
      response.request().method() === 'PATCH',
    );
    await deliveryOrder.getByRole('button', { name: 'Confirm delivery completed', exact: true }).click();
    const deliveryResponse = await deliveryResponsePromise;
    if (deliveryResponse.status() !== 200 || qaOpsOrder.status !== 'delivered' || !qaOpsOrder.deliveredAt) {
      throw new Error('Delivery confirmation did not set the synthetic order to delivered with a timestamp.');
    }
    await page.getByRole('button', { name: /Completed/ }).click();
    await page.locator('.order-card[data-order-id="browser-smoke-ops-order"]').waitFor({ state: 'visible', timeout: 10_000 });
    pass('delivery staff confirms only a dispatched order and can find the completed order in its Completed filter');

    await signOutMockedStaff();
    await page.locator('.main-nav.open').getByRole('button', { name: 'Sign in', exact: true }).click();
    await dialog.getByLabel('Email address').fill(mockedUser.email);
    await dialog.getByLabel('Password').fill('MockOnlyPass123');
    const returnCustomerLoginPromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/login' &&
      response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    const returnCustomerLogin = await returnCustomerLoginPromise;
    if (returnCustomerLogin.status() !== 200) throw new Error('Mock customer could not sign back in after staff workflow.');
    await context.addCookies([{
      name: 'pizza_session',
      value: 'browser-smoke-session',
      url: webUrl,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    }]);
    await page.getByRole('heading', { name: /Good to see you,.*Browser/i }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByText('PH-OPS-QA', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByText('TEST MODE · SIMULATED TRACKING', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    const customerQaOrder = page.locator('.order-card[data-order-id="browser-smoke-ops-order"]');
    if (await customerQaOrder.locator('[data-order-card-item]').count() !== 1) {
      throw new Error('Customer order history is missing the catalog-backed item preview.');
    }
    const reportProblemButton = customerQaOrder.locator('.order-issue-actions .button-light');
    await reportProblemButton.waitFor({ state: 'visible', timeout: 10_000 });
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'light') {
      await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    }
    const lightReportColors = await reportProblemButton.evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, color: style.color };
    });
    if (lightReportColors.background !== 'rgb(255, 255, 255)' || lightReportColors.color !== 'rgb(29, 53, 68)') {
      throw new Error('The light-mode report-problem action is not readable: ' + JSON.stringify(lightReportColors));
    }
    await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
    await page.waitForFunction(() => {
      const el = document.querySelector('.order-card[data-order-id="browser-smoke-ops-order"] .order-issue-actions .button-light');
      if (!el || document.documentElement.dataset.theme !== 'dark') return false;
      const style = getComputedStyle(el);
      return style.backgroundColor === 'rgb(255, 98, 71)' && style.color === 'rgb(255, 255, 255)';
    }, null, { timeout: 5000 });
    const nightReportColors = await reportProblemButton.evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, color: style.color };
    });
    if (nightReportColors.background !== 'rgb(255, 98, 71)' || nightReportColors.color !== 'rgb(255, 255, 255)') {
      throw new Error('The night-mode report-problem action is not readable: ' + JSON.stringify(nightReportColors));
    }
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    pass('customer order history renders photo-backed item cards and readable report actions in light and night themes');
    pass('customer order history reflects the synthetic completed stage and clearly labels it as Test Mode simulation');

    // Check the admin-only notification health panel with a synthetic administrator
    // and mocked endpoints. No production account, queue entry, or notification is changed.
    const mockedAdmin = {
      id: 'browser-smoke-admin',
      name: 'Browser QA Admin',
      email: 'admin-qa@example.invalid',
      role: 'admin',
    };
    const notificationHealthFixture = {
      checkedAt: new Date().toISOString(),
      deliveryConfigured: false,
      counts: { queued: 2, sending: 0, sentLast24Hours: 1, dead: 1 },
      oldestQueuedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      deadLetters: [{
        orderNumber: 'PH-NOTIFY-QA',
        attempts: 8,
        lastError: 'Email provider delivery failed',
        updatedAt: new Date().toISOString(),
      }],
    };
    await page.route('**/api/auth/admin/login', async (route) => {
      const body = route.request().postDataJSON();
      if (body?.email !== mockedAdmin.email || body?.password !== 'AdminMockOnlyPass123') {
        await route.fulfill({ status: 401, json: { error: 'Unexpected admin test credentials.' } });
        return;
      }
      activeMockedUser = mockedAdmin;
      await route.fulfill({
        status: 200,
        headers: { 'set-cookie': mockedSessionCookie + '; Path=/; HttpOnly; Secure; SameSite=Lax' },
        json: { user: mockedAdmin },
      });
    });
    await page.route('**/api/admin/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const responses = {
        '/api/admin/summary': { summary: { ordersTotal: 1, paidOrders: 1, revenue: 278, lowStock: 0 } },
        '/api/admin/inventory': { items: [] },
        '/api/admin/orders': { orders: [] },
        '/api/admin/payment-reviews': { events: [] },
        '/api/admin/issues': { issues: [] },
        '/api/admin/staff': { staff: [] },
        '/api/admin/notification-health': notificationHealthFixture,
      };
      if (route.request().method() !== 'GET' || !responses[pathname]) {
        await route.fulfill({ status: 404, json: { error: 'Unexpected mocked admin route.' } });
        return;
      }
      await route.fulfill({ status: 200, json: responses[pathname] });
    });

    await signOutMockedStaff();
    await dialog.getByRole('button', { name: 'Admin sign in', exact: true }).click();
    await dialog.getByLabel('Email address').fill(mockedAdmin.email);
    await dialog.getByLabel('Password').fill('AdminMockOnlyPass123');
    const adminLoginPromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/admin/login' &&
      response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Sign in as admin', exact: true }).click();
    const adminLoginResponse = await adminLoginPromise;
    if (adminLoginResponse.status() !== 200) throw new Error('Synthetic admin login returned HTTP ' + adminLoginResponse.status() + '.');
    await context.addCookies([{
      name: 'pizza_session',
      value: 'browser-smoke-session',
      url: webUrl,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    }]);
    const notificationPanel = page.locator('[data-notification-health-panel="admin-notifications-v1"]');
    await page.getByRole('heading', { name: /Good food takes/ }).waitFor({ state: 'visible', timeout: 15_000 });
    await notificationPanel.waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByText('Email provider not configured', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await notificationPanel.getByText('Order emails stay queued until a Resend sender/key or SMTP settings are configured in Render.', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });
    const queueMetrics = await notificationPanel.locator('.notification-health-metric').evaluateAll((cards) =>
      cards.map((card) => ({
        label: card.querySelector('span')?.textContent?.trim(),
        count: card.querySelector('strong')?.textContent?.trim(),
      })),
    );
    const expectedMetrics = [
      { label: 'Queued', count: '2' },
      { label: 'Sending', count: '0' },
      { label: 'Sent · 24h', count: '1' },
      { label: 'Needs attention', count: '1' },
    ];
    if (JSON.stringify(queueMetrics) !== JSON.stringify(expectedMetrics)) {
      throw new Error('Admin notification metrics do not match the mocked health response: ' + JSON.stringify(queueMetrics));
    }
    await notificationPanel.getByText('PH-NOTIFY-QA', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await notificationPanel.getByText('Email provider delivery failed', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await notificationPanel.getByText(/8 attempts/).waitFor({ state: 'visible', timeout: 10_000 });
    pass('admin notification panel renders provider-not-configured state, queue metrics and dead-letter details from its API response');

    await page.setViewportSize({ width: 1440, height: 900 });
    const lightProviderStyle = await notificationPanel.locator('.notification-provider-state.missing').evaluate((el) => {
      const strong = el.querySelector('strong');
      return { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(strong).color };
    });
    if (lightProviderStyle.background !== 'rgb(255, 248, 235)' || lightProviderStyle.color !== 'rgb(118, 83, 27)') {
      throw new Error('Admin notification missing-provider state has unreadable light-theme contrast: ' + JSON.stringify(lightProviderStyle));
    }
    await captureScreenshot(page, '18-mocked-admin-notifications-light.png');
    await auditResponsiveState(page, 'mocked-admin-notifications-light');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-notification-health-panel="admin-notifications-v1"] .notification-provider-state.missing');
      const strong = panel?.querySelector('strong');
      return document.documentElement.dataset.theme === 'dark' &&
        panel && getComputedStyle(panel).backgroundColor === 'rgb(48, 40, 28)' &&
        strong && getComputedStyle(strong).color === 'rgb(255, 223, 154)';
    }, null, { timeout: 5000 });
    await captureScreenshot(page, '19-mocked-admin-notifications-night.png');
    await auditResponsiveState(page, 'mocked-admin-notifications-night');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    pass('admin notification health remains legible and responsive in Light and Night modes');
    console.log('[INFO] Kitchen, delivery, customer and admin dashboard drills use mocked HTTP routes and synthetic in-memory accounts/orders; no production account, order, payment, or notification queue entry was created or changed.');
    console.log('[INFO] Successful customer-auth checks use mocked endpoints unless optional PIZZA_QA_CUSTOMER_EMAIL/PIZZA_QA_CUSTOMER_PASSWORD secrets enable the separate live-session check.');
  }

  if (pageErrors.length) {
    throw new Error(`Browser page errors detected: ${pageErrors.join(' | ')}`);
  }
  pass('no uncaught browser page errors');
  console.log(`Hosted browser smoke checks passed: ${checks.length}/${checks.length}`);
} catch (error) {
  console.error('Live browser smoke failed:', error?.stack || error);
  process.exitCode = 1;
} finally {
  try {
    await writeFile(`${artifactDir}/browser-evidence.json`, JSON.stringify({
      checkedAt: new Date().toISOString(),
      target: webUrl,
      checks,
      responsiveEvidence,
      pageErrors,
      failedRequests,
      successfulLiveCustomerLoginEnabled: Boolean(
        (process.env.PIZZA_QA_CUSTOMER_EMAIL || '').trim() &&
        (process.env.PIZZA_QA_CUSTOMER_PASSWORD || '')
      ),
      note: 'When live-customer credentials are not configured, successful-login checks use mocked auth endpoints. A mocked session is not proof of successful production authentication.',
    }, null, 2));
  } catch (error) {
    console.error('Could not write browser QA evidence:', error?.message || error);
    process.exitCode = 1;
  }
  await browser?.close().catch(() => {});
}
