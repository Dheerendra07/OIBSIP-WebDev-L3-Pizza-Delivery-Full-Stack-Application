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

  const dashboardRoot = page.locator('[data-customer-dashboard="premium-dashboard-v1"]');
  await dashboardRoot.waitFor({ state: 'visible', timeout: 15_000 });
  const dashboardOverview = await dashboardRoot.evaluate((root) => {
    const metricCards = [...root.querySelectorAll('.dashboard-metrics > div')];
    return {
      eyebrow: root.querySelector('.dashboard-top .eyebrow')?.textContent?.trim() || '',
      description: root.querySelector('.dashboard-top p')?.textContent?.trim() || '',
      primaryAction: root.querySelector('.dashboard-top > .button')?.textContent?.trim() || '',
      metricLabels: metricCards.map((card) => card.querySelector('span')?.textContent?.trim() || ''),
      metricBackground: metricCards[0] ? getComputedStyle(metricCards[0]).backgroundImage : '',
      metricAccent: metricCards[0] ? getComputedStyle(metricCards[0], '::before').backgroundImage : '',
      metricRadius: metricCards[0] ? getComputedStyle(metricCards[0]).borderRadius : '',
    };
  });
  if (dashboardOverview.eyebrow !== 'YOUR ORDERS' ||
      !dashboardOverview.description.includes('Track order progress') ||
      dashboardOverview.primaryAction !== 'Browse the menu' ||
      JSON.stringify(dashboardOverview.metricLabels) !== JSON.stringify(['TOTAL ORDERS', 'IN PROGRESS', 'LAST ORDER TOTAL']) ||
      !dashboardOverview.metricBackground.includes('linear-gradient') ||
      !dashboardOverview.metricAccent.includes('linear-gradient') ||
      dashboardOverview.metricRadius !== '16px') {
    throw new Error('Customer dashboard overview or metric-card hierarchy failed: ' + JSON.stringify(dashboardOverview));
  }
  pass('customer dashboard uses direct order-focused copy and distinct premium metric surfaces');
  const dashboardEndcap = page.locator('[data-page-endcap="dashboard"]');
  await dashboardEndcap.waitFor({ state: 'visible', timeout: 15_000 });
  const dashboardEditorialState = await dashboardEndcap.evaluate((el) => ({
    eyebrow: el.querySelector('.page-endcap-main .eyebrow').innerText,
    sparkleIcons: el.querySelectorAll('.page-endcap-main .eyebrow svg').length,
    afterContent: getComputedStyle(el, '::after').content,
    heading: el.querySelector('.page-endcap-main h2').innerText,
    actionCount: el.querySelectorAll('.page-endcap-actions button').length,
  }));
  if (dashboardEditorialState.sparkleIcons !== 0 ||
      dashboardEditorialState.afterContent !== 'none' ||
      dashboardEditorialState.actionCount !== 2) {
    throw new Error('Dashboard endcap should use restrained decoration and two working actions: ' + JSON.stringify(dashboardEditorialState));
  }
  if (await dashboardEndcap.locator('.page-endcap-item').count() !== 3) {
    throw new Error('Customer dashboard must show all three contextual lower-page support cards.');
  }
  pass('customer dashboard includes contextual support and next-step cards below order history');
  await page.waitForFunction(() => {
    const card = document.querySelector('.dashboard-metrics > div');
    const backgroundImage = card ? getComputedStyle(card).backgroundImage : '';
    return backgroundImage.includes('linear-gradient') && backgroundImage.includes('rgb(255, 255, 255)');
  });
  await captureScreenshot(page, lightScreenshot);
  await auditResponsiveState(page, `${prefix}-light`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
  await page.waitForFunction(() => (
    document.documentElement.dataset.theme === 'dark' &&
    getComputedStyle(document.querySelector('.dashboard-metrics > div')).backgroundImage.includes('linear-gradient') &&
    getComputedStyle(document.querySelector('.dashboard-metrics > div')).backgroundImage.includes('rgb(20, 38, 53)') &&
    getComputedStyle(document.querySelector('.dashboard-metrics > div::before')).backgroundImage !== '' &&
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
    getComputedStyle(document.querySelector('.dashboard-metrics > div')).backgroundImage.includes('linear-gradient') &&
    getComputedStyle(document.querySelector('.dashboard-metrics > div')).backgroundImage.includes('rgb(255, 255, 255)')
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
  let premiumVisualState = { variantCount: 0, primaryColor: '', footerColor: '', premiumCardCount: 0, loadedPhotoCount: 0, uniquePhotoCount: 0, interactiveCardCount: 0, ingredientCardCount: 0, cardActionColorMatchCount: 0, equalActionHeightCount: 0, endcapGradientApplied: false };
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
      (await page.locator('[data-home-ui-release="step4-home-refine-20261027-v3"]').count() === 1) &&
      (await page.locator('[data-page-endcap="home"]').count() === 1) &&
      (await page.locator('[data-pizza-card-version="premium-photo-v1"]').count() >= 3) &&
      (await page.locator('[data-pizza-card-open="photo-hit-area-v1"]').count() >= 3) &&
      (await page.locator('[data-cart-photo-release="catalog-photo-v1"]').count() === 1) &&
      (await page.locator('[data-notification-health-release="admin-notifications-v1"]').count() === 1) &&
      (await page.locator('[data-payment-mode-disclosure-release="sandbox-otp-v1"]').count() === 1) &&
      (await page.locator('[data-payment-review-support-release="payment-support-v1"]').count() === 1);

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
        card.matches('[data-pizza-card-layout="compact-purchase-v2"]') &&
        Number.isFinite(Number(card.getAttribute('data-pizza-unit-price'))) &&
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
      const cardActionColorMatchCount = cards.filter((card) => {
        const addButton = card.querySelector('.add-button');
        return Boolean(addButton && primary &&
          getComputedStyle(addButton).backgroundColor === getComputedStyle(primary).backgroundColor);
      }).length;
      const equalActionHeightCount = cards.filter((card) => {
        const addButton = card.querySelector('.add-button');
        const customizeButton = card.querySelector('.customize-link');
        return Boolean(addButton && customizeButton &&
          Math.abs(addButton.getBoundingClientRect().height - customizeButton.getBoundingClientRect().height) <= 0.25 &&
          Math.abs(addButton.getBoundingClientRect().height - 48) <= 0.5 &&
          Math.abs(customizeButton.getBoundingClientRect().height - 48) <= 0.5);
      }).length;
      const homeEndcap = document.querySelector('[data-page-endcap="home"]');
      const endcapGradientApplied = Boolean(
        homeEndcap && getComputedStyle(homeEndcap).backgroundImage.includes('linear-gradient'),
      );
      return {
        homeHeroPhotoLoaded,
        cardActionColorMatchCount,
        equalActionHeightCount,
        endcapGradientApplied,
        variantCount: new Set(variants).size,
        primaryColor: primary ? getComputedStyle(primary).backgroundColor : '',
        footerColor: footer ? getComputedStyle(footer).backgroundColor : '',
        premiumCardCount: cards.length,
        loadedPhotoCount,
        uniquePhotoCount,
        interactiveCardCount,
        ingredientCardCount,
        compactLayoutCount: cards.filter((card) => card.matches('[data-pizza-card-layout="compact-purchase-v2"]')).length,
      };
    }).catch(() => ({ homeHeroPhotoLoaded: false, variantCount: 0, primaryColor: '', footerColor: '', premiumCardCount: 0, loadedPhotoCount: 0, uniquePhotoCount: 0, interactiveCardCount: 0, ingredientCardCount: 0, compactLayoutCount: 0, cardActionColorMatchCount: 0, equalActionHeightCount: 0, endcapGradientApplied: false }));

    if (releaseMarkersReady &&
        premiumVisualState.homeHeroPhotoLoaded === true &&
        premiumVisualState.premiumCardCount >= 3 &&
        premiumVisualState.loadedPhotoCount >= 3 &&
        premiumVisualState.uniquePhotoCount >= 3 &&
        premiumVisualState.interactiveCardCount >= 3 &&
        premiumVisualState.compactLayoutCount >= 3 &&
        premiumVisualState.ingredientCardCount >= premiumVisualState.premiumCardCount &&
        premiumVisualState.cardActionColorMatchCount >= 3 &&
        premiumVisualState.equalActionHeightCount >= 3 &&
        premiumVisualState.endcapGradientApplied === true &&
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
      '; ingredientCards=' + premiumVisualState.ingredientCardCount + '; compactLayout=' +
      premiumVisualState.compactLayoutCount + '; cardCTAColors=' + premiumVisualState.cardActionColorMatchCount +
      '; equalActionHeights=' + premiumVisualState.equalActionHeightCount +
      '; endcapGradient=' + premiumVisualState.endcapGradientApplied +
      '; variants=' + premiumVisualState.variantCount + '; CTA=' + premiumVisualState.primaryColor +
      '; footer=' + premiumVisualState.footerColor + ')',
    );
    await page.waitForTimeout(5_000);
  }
  if (!mobileSignInReady) {
    throw new Error('Hosted site did not publish a loaded food-photo hero plus three distinct, loaded premium cards with working controls and the navy/red visual release after 20 checks: ' + JSON.stringify(premiumVisualState));
  }
  pass('home hero displays a loaded real-food photograph with the local vector fallback retained');
  pass('production publishes three distinct premium photo cards with all three food photos loaded');
  pass('premium cards expose quantity, one live total, and working cart controls with the compact layout marker');
  pass('every premium card shows real ingredient names instead of the fallback label');
  pass('primary CTA uses tomato red and the footer uses the navy brand surface');
  const homeEndcap = page.locator('[data-page-endcap="home"]');
  const homeEndcapState = await homeEndcap.evaluate((el) => ({
    actions: [...el.querySelectorAll('.page-endcap-actions button')].map((button) => button.innerText.trim()),
    benefitCount: el.querySelectorAll('.page-endcap-item').length,
    heading: el.querySelector('.page-endcap-main h2')?.innerText.trim() || '',
  }));
  if (homeEndcapState.benefitCount !== 3 ||
      homeEndcapState.actions.length !== 2 ||
      !homeEndcapState.heading ||
      !homeEndcapState.actions.includes('Explore house recipes') ||
      !homeEndcapState.actions.includes('Review your bag')) {
    throw new Error('Homepage lower-page endcap is missing contextual next steps: ' + JSON.stringify(homeEndcapState));
  }
  pass('homepage includes a contextual lower-page endcap with live-catalog guidance and two useful navigation actions');

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
    unitPrice: Number(card.getAttribute('data-pizza-unit-price')),
    subtotal: card.querySelector('.pizza-card-total strong')?.textContent?.trim() || '',
    photoLoaded: Boolean(card.querySelector('.pizza-card-photo')?.naturalWidth > 0),
    layout: card.getAttribute('data-pizza-card-layout') || '',
  }));
  const expectedUnitPrice = Number.isFinite(initialCardPricing.unitPrice)
    ? `₹${initialCardPricing.unitPrice.toLocaleString('en-IN')}`
    : '';
  if (initialCardPricing.quantity !== '1' || !expectedUnitPrice ||
      initialCardPricing.subtotal !== expectedUnitPrice ||
      initialCardPricing.layout !== 'compact-purchase-v2' ||
      await firstPremiumCard.locator('.pizza-card-price').count() !== 0 ||
      await firstPremiumCard.locator('.pizza-card-assurance').count() !== 0 ||
      !initialCardPricing.photoLoaded) {
    throw new Error('The first premium card did not render a distinct photo, single matching live total and compact layout: ' + JSON.stringify({ initialCardPricing, expectedUnitPrice }));
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

  // The full photo target must be an accessible, keyboard-operable named button.
  const photoSurface = firstPremiumCard.locator('.pizza-card-open');
  const photoSurfaceSemantics = await photoSurface.evaluate((element) => ({
    tagName: element.tagName,
    type: element.getAttribute('type'),
    label: element.getAttribute('aria-label'),
    releaseMarker: element.getAttribute('data-pizza-card-open'),
    tabIndex: element.tabIndex,
  }));
  if (photoSurfaceSemantics.tagName !== 'BUTTON' ||
      photoSurfaceSemantics.type !== 'button' ||
      photoSurfaceSemantics.label !== `View ${firstLivePizza.name} details` ||
      photoSurfaceSemantics.releaseMarker !== 'photo-hit-area-v1' ||
      photoSurfaceSemantics.tabIndex < 0) {
    throw new Error('Featured photo hit target is missing its accessible button semantics: ' + JSON.stringify(photoSurfaceSemantics));
  }
  pass('featured photo hit target exposes a named, keyboard-focusable button');

  // Enter activates the photo target, not just the visible CTA pill.
  await photoSurface.focus();
  await photoSurface.press('Enter');
  const keyboardDetail = page.locator('[data-pizza-detail]');
  await keyboardDetail.waitFor({ state: 'visible', timeout: 10_000 });
  if (await keyboardDetail.getAttribute('data-pizza-id') !== firstPizzaId) {
    throw new Error('Keyboard activation opened the wrong pizza detail.');
  }
  pass('keyboard Enter on the featured photo opens the matching product detail');
  await keyboardDetail.locator('.pizza-detail-breadcrumb button').click();

  // A pointer tap near the edge of the photo must also open that product.
  await firstPremiumCard.locator('.pizza-card-open').waitFor({ state: 'visible', timeout: 10_000 });
  const pointerSurface = firstPremiumCard.locator('.pizza-card-open');
  const photoSurfaceBounds = await pointerSurface.boundingBox();
  const photoArtworkBounds = await firstPremiumCard.locator('.pizza-card-art').boundingBox();
  if (!photoSurfaceBounds || !photoArtworkBounds ||
      Math.abs(photoSurfaceBounds.width - photoArtworkBounds.width) > 1 ||
      Math.abs(photoSurfaceBounds.height - photoArtworkBounds.height) > 1) {
    throw new Error('The featured pizza open target does not cover the full artwork surface.');
  }
  await pointerSurface.click({ position: {
    x: Math.max(24, photoSurfaceBounds.width - 24),
    y: Math.min(photoSurfaceBounds.height - 24, Math.max(24, photoSurfaceBounds.height / 2)),
  } });
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
      detailData.price !== initialCardPricing.subtotal || detailData.subtotal !== initialCardPricing.subtotal ||
      !detailData.imageLoaded ||
      !expectedIngredientLabels.every((label) => detailData.ingredientLabels.includes(label))) {
    throw new Error('Pizza detail page does not match the live catalog card: ' + JSON.stringify({ detailData, expectedIngredientLabels, initialCardPricing }));
  }
  pass('tapping a featured photo opens the correct product detail with live recipe, photo and price');
  const detailEndcap = page.locator('[data-page-endcap="pizza-detail"]');
  await detailEndcap.waitFor({ state: 'visible', timeout: 10_000 });
  const detailEndcapState = await detailEndcap.evaluate((el) => ({
    heading: el.querySelector('.page-endcap-main h2')?.innerText.trim() || '',
    actions: [...el.querySelectorAll('.page-endcap-actions button')].map((button) => button.innerText.trim()),
    benefitCount: el.querySelectorAll('.page-endcap-item').length,
  }));
  if (!detailEndcapState.heading.includes(firstLivePizza.name) ||
      detailEndcapState.benefitCount !== 3 ||
      !detailEndcapState.actions.includes('Back to the menu') ||
      !detailEndcapState.actions.includes('Build your own')) {
    throw new Error('Pizza detail lower-page endcap is not contextual or missing its navigation actions: ' + JSON.stringify(detailEndcapState));
  }
  pass('pizza detail page closes with the selected recipe name, three contextual benefits and menu/builder navigation');

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
  await detailEndcap.getByRole('button', { name: 'Build your own', exact: true }).click();
  await page.getByRole('heading', { name: /The art of/ }).waitFor({ state: 'visible', timeout: 10_000 });
  pass('pizza detail lower-page builder action opens the custom pizza builder');
  await page.locator('.site-header .brand').click();
  await page.locator('.hero h1').waitFor({ state: 'visible', timeout: 10_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  pass('detail-page Light/Night Mode toggles and lower-page navigation work');
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
  if (!builderPromoState.title.toLowerCase().includes('make the recipe yours') ||
      !builderPromoState.body.toLowerCase().includes('review the recipe and total') ||
      !builderPromoState.button.includes('Create your pizza') ||
      builderPromoState.proofCount !== 2 ||
      await page.locator('.last-word, .callout-watermark').count() !== 0) {
    throw new Error('Home lower section is missing the direct builder CTA or still contains decorative filler: ' + JSON.stringify(builderPromoState));
  }
  const footerNavCount = await page.locator('.footer-nav button').count();
  if (footerNavCount < 4) throw new Error('Footer is missing expected navigation shortcuts.');
  if (await page.locator('.footer-brand .brand-name small').innerText() !== 'LIVE MENU · CLEAR PRICES') {
    throw new Error('Footer brand tagline is not the current product-led label.');
  }
  pass('home lower section uses a direct builder CTA with live ingredient and pricing value');
  pass('homepage combines the direct builder CTA with a contextual lower-page endcap; decorative quote filler stays removed');
  pass('shared footer provides working navigation shortcuts');
  await captureScreenshot(page, '15-home-builder-promo-light-desktop.png');
  await auditResponsiveState(page, 'home');

  // Check the actual computed styles on the live menu card, not just CSS source tokens.
  // The 48px mobile minimum keeps Add and Customize equally easy to tap in either theme.
  const inspectHomeCardTheme = async () => page.locator('[data-pizza-card-version="premium-photo-v1"]').first().evaluate((card) => {
    const addButton = card.querySelector('.add-button');
    const customizeButton = card.querySelector('.customize-link');
    const heroButton = document.querySelector('.hero .button-dark');
    const endcap = document.querySelector('[data-page-endcap="home"]');
    const luminance = (color) => {
      const values = color.match(/[0-9]+(?:\\.[0-9]+)?/g)?.slice(0, 3).map((value) => Number(value) / 255);
      if (!values || values.length !== 3) return 0;
      const linear = values.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const foreground = luminance(getComputedStyle(customizeButton).color);
    const background = luminance(getComputedStyle(customizeButton).backgroundColor);
    return {
      theme: document.documentElement.dataset.theme,
      addBackground: getComputedStyle(addButton).backgroundColor,
      heroBackground: getComputedStyle(heroButton).backgroundColor,
      builderPromoBackground: getComputedStyle(document.querySelector('[data-home-builder-promo] .button-light')).backgroundColor,
      builderPromoColor: getComputedStyle(document.querySelector('[data-home-builder-promo] .button-light')).color,
      customizeContrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      addHeight: addButton.getBoundingClientRect().height,
      customizeHeight: customizeButton.getBoundingClientRect().height,
      actionHeightDelta: Math.abs(addButton.getBoundingClientRect().height - customizeButton.getBoundingClientRect().height),
      cardBackgroundImage: getComputedStyle(card).backgroundImage,
      endcapBackgroundImage: getComputedStyle(endcap).backgroundImage,
    };
  });

  const lightCardTheme = await inspectHomeCardTheme();
  if (lightCardTheme.theme !== 'light' ||
      lightCardTheme.addBackground !== lightCardTheme.heroBackground ||
      lightCardTheme.customizeContrast < 4.5 ||
      Math.abs(lightCardTheme.addHeight - 48) > 0.5 ||
      Math.abs(lightCardTheme.customizeHeight - 48) > 0.5 ||
      lightCardTheme.actionHeightDelta > 0.25 ||
      !lightCardTheme.endcapBackgroundImage.includes('linear-gradient')) {
    throw new Error('Light-theme menu card actions/surfaces failed computed-style checks: ' + JSON.stringify(lightCardTheme));
  }
  pass('Light theme: menu-card CTA matches the primary brand CTA, secondary action contrast is readable, and action heights align');

  await page.getByRole('button', { name: 'Switch to night mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  // Theme changes animate the CTA background; wait for the settled computed style instead of sampling the transition's first frame.
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-home-builder-promo] .button-light');
    return button && getComputedStyle(button).backgroundColor === 'rgb(255, 210, 122)';
  }, undefined, { timeout: 2_000 });
  const darkCardTheme = await inspectHomeCardTheme();
  if (darkCardTheme.theme !== 'dark' ||
      darkCardTheme.addBackground !== darkCardTheme.heroBackground ||
      darkCardTheme.customizeContrast < 4.5 ||
      Math.abs(darkCardTheme.addHeight - 48) > 0.5 ||
      Math.abs(darkCardTheme.customizeHeight - 48) > 0.5 ||
      darkCardTheme.actionHeightDelta > 0.25 ||
      darkCardTheme.builderPromoBackground !== 'rgb(255, 210, 122)' ||
      darkCardTheme.builderPromoColor !== 'rgb(25, 42, 52)' ||
      !darkCardTheme.cardBackgroundImage.includes('linear-gradient') ||
      !darkCardTheme.endcapBackgroundImage.includes('linear-gradient')) {
    throw new Error('Night-theme menu card actions/surfaces failed computed-style checks: ' + JSON.stringify(darkCardTheme));
  }
  pass('Night theme: menu-card CTA and lower-page surface follow the night palette, with readable secondary text and aligned actions');

  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');

  // Audit the entire customer-facing menu, not just the three homepage favourites.
  // The API remains the source of truth for recipe IDs and current menu count.
  // Responsive audit leaves the viewport at 390px; use the visible homepage CTA
  // instead of the collapsed desktop navigation to exercise the real mobile route.
  const menuNav = page.locator('.hero-actions').getByRole('button', { name: 'Explore the menu', exact: true });
  await menuNav.click();
  const fullMenuCards = page.locator('.pizza-grid.full-grid [data-pizza-card-version="premium-photo-v1"]');
  await fullMenuCards.first().waitFor({ state: 'visible', timeout: 15_000 });
  const expectedMenuRecipes = liveMenu?.featuredPizzas || [];
  if (expectedMenuRecipes.length !== 8) {
    throw new Error('Expected eight live featured recipes for the current menu release, received ' + expectedMenuRecipes.length + '.');
  }
  await page.waitForFunction((expectedCount) =>
    document.querySelectorAll('.pizza-grid.full-grid [data-pizza-card-version="premium-photo-v1"]').length === expectedCount,
    expectedMenuRecipes.length,
    { timeout: 10_000 },
  );

  // Trigger lazy loading for every recipe photo and record its real browser result.
  // A unique src attribute is not proof that the remote image was actually delivered.
  const menuPhotoLoadChecks = [];
  for (let index = 0; index < expectedMenuRecipes.length; index += 1) {
    const card = fullMenuCards.nth(index);
    await card.scrollIntoViewIfNeeded();
    await page.waitForFunction((cardIndex) => {
      const currentCard = document.querySelectorAll('.pizza-grid.full-grid [data-pizza-card-version="premium-photo-v1"]')[cardIndex];
      const image = currentCard?.querySelector('.pizza-card-photo');
      return !image || (image.complete && image.naturalWidth > 0 && currentCard.classList.contains('has-photo'));
    }, index, { timeout: 12_000 }).catch(() => {});
    menuPhotoLoadChecks.push(await card.evaluate((element) => {
      const image = element.querySelector('.pizza-card-photo');
      const artwork = element.querySelector('.pizza-card-artwork');
      const artworkRect = artwork?.getBoundingClientRect();
      return {
        id: element.getAttribute('data-pizza-id') || '',
        name: element.querySelector('.pizza-card-title-button')?.textContent?.trim() || '',
        assignedSource: element.getAttribute('data-pizza-photo-source') || '',
        loadedSource: image?.currentSrc || '',
        loaded: Boolean(image && image.complete && image.naturalWidth > 0 && element.classList.contains('has-photo')),
        fallbackArtworkPresent: Boolean(artwork && artworkRect && artworkRect.width > 0 && artworkRect.height > 0),
        imageState: !image ? 'fallback-active' : image.complete && image.naturalWidth > 0 ? 'loaded' : image.complete ? 'failed-or-empty' : 'still-pending',
        naturalWidth: image?.naturalWidth || 0,
      };
    }));
  }
  const failedMenuPhotos = menuPhotoLoadChecks.filter((photo) => !photo.loaded);
  if (failedMenuPhotos.length > 0) {
    throw new Error('Actual menu photo delivery failed for one or more recipes: ' + JSON.stringify({
      loadedCount: menuPhotoLoadChecks.length - failedMenuPhotos.length,
      expectedCount: menuPhotoLoadChecks.length,
      failedMenuPhotos,
      allPhotoResults: menuPhotoLoadChecks,
    }));
  }
  pass('all eight menu recipe photos load in the real browser after lazy-load scrolling; no SVG fallback is substituting for a missing photo');

  const fullMenuState = await fullMenuCards.evaluateAll((cards) => cards.map((card) => ({
    id: card.getAttribute('data-pizza-id') || '',
    name: card.querySelector('.pizza-card-title-button')?.textContent?.trim() || '',
    photoSource: card.getAttribute('data-pizza-photo-source') || '',
    photoAlt: card.querySelector('.pizza-card-photo')?.getAttribute('alt') || '',
    detailLabel: card.querySelector('.pizza-card-open')?.getAttribute('aria-label') || '',
    unitPrice: card.getAttribute('data-pizza-unit-price') || '',
    ingredientCount: [...card.querySelectorAll('.pizza-card-ingredients .pizza-ingredient-chip:not(.ingredient-more)')]
      .map((chip) => chip.textContent.trim()).filter(Boolean).length,
    hasQuantityControls: Boolean(card.querySelector('.pizza-card-quantity button[aria-label^="Increase "]') &&
      card.querySelector('.pizza-card-quantity button[aria-label^="Decrease "]')),
    hasAddAction: Boolean(card.querySelector('.add-button')),
  })));
  const actualIds = fullMenuState.map((recipe) => recipe.id).sort();
  const expectedIds = expectedMenuRecipes.map((recipe) => recipe.id).sort();
  const photoSources = fullMenuState.map((recipe) => recipe.photoSource);
  const uniquePhotoSources = new Set(photoSources);
  const invalidMenuCards = fullMenuState.filter((recipe) =>
    !recipe.id || !recipe.name || !recipe.photoSource || !recipe.photoAlt ||
    recipe.detailLabel !== 'View ' + recipe.name + ' details' ||
    recipe.unitPrice === '' || !Number.isFinite(Number(recipe.unitPrice)) ||
    recipe.ingredientCount === 0 || !recipe.hasQuantityControls || !recipe.hasAddAction,
  );
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds) ||
      fullMenuState.length !== 8 ||
      uniquePhotoSources.size !== 8 ||
      invalidMenuCards.length > 0) {
    throw new Error('Full menu recipe/photo/interaction audit failed: ' + JSON.stringify({
      apiCount: expectedMenuRecipes.length,
      renderedCount: fullMenuState.length,
      uniquePhotoCount: uniquePhotoSources.size,
      actualIds,
      expectedIds,
      invalidMenuCards,
    }));
  }
  const recipeNamesMatch = fullMenuState.every((card) =>
    expectedMenuRecipes.some((recipe) => recipe.id === card.id && recipe.name === card.name),
  );
  if (!recipeNamesMatch) throw new Error('One or more menu card names do not match the live recipe API.');
  pass('full menu renders all eight API recipes with eight distinct assigned food-photo sources, live prices, ingredient chips and usable card controls');

  await page.getByRole('button', { name: 'PLANT-BASED', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('.pizza-grid.full-grid [data-pizza-card-version="premium-photo-v1"]').length === 2,
    null,
    { timeout: 5_000 },
  );
  const plantBasedIds = await fullMenuCards.evaluateAll((cards) => cards.map((card) => card.getAttribute('data-pizza-id')).sort());
  if (JSON.stringify(plantBasedIds) !== JSON.stringify(['olive-atelier', 'white-garden'])) {
    throw new Error('Plant-based menu filter returned an unexpected recipe set: ' + JSON.stringify(plantBasedIds));
  }
  await page.getByRole('button', { name: 'Everything', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('.pizza-grid.full-grid [data-pizza-card-version="premium-photo-v1"]').length === 8,
    null,
    { timeout: 5_000 },
  );
  pass('menu category filtering isolates the two plant-based recipes and restores the complete eight-item menu');

  const oliveAtelierCard = page.locator('.pizza-grid.full-grid .pizza-card[data-pizza-id="olive-atelier"]');
  await oliveAtelierCard.locator('.pizza-card-open').click();
  const oliveAtelierDetail = page.locator('[data-pizza-detail]');
  await oliveAtelierDetail.waitFor({ state: 'visible', timeout: 10_000 });
  if (await oliveAtelierDetail.getAttribute('data-pizza-id') !== 'olive-atelier' ||
      await oliveAtelierDetail.locator('h1').innerText() !== 'Olive Atelier') {
    throw new Error('A menu-only recipe did not open its own product detail: ' + await oliveAtelierDetail.innerText());
  }
  await oliveAtelierDetail.locator('.pizza-detail-breadcrumb button').click();
  await page.locator('.pizza-grid.full-grid [data-pizza-card-version="premium-photo-v1"]').first().waitFor({ state: 'visible', timeout: 10_000 });
  pass('a recipe outside the homepage featured three opens its matching detail page and returns to the complete menu');
  await page.locator('.site-header .brand').click();
  await page.locator('.hero h1').waitFor({ state: 'visible', timeout: 10_000 });

  // The custom builder has its own option cards, recipe preview, pricing and
  // quantity controls. Audit it in both themes instead of assuming home styles
  // prove every product surface is readable.
  await page.setViewportSize({ width: 1440, height: 900 });
  const classicPhotoPattern = '**/photo-1594007654729-407eedc4be65**';
  const abortClassicPhoto = (route) => route.abort();
  // Force the default remote photo to fail so the in-page fallback is tested,
  // rather than relying on an intermittent CDN incident to exercise this path.
  await page.route(classicPhotoPattern, abortClassicPhoto);
  await page.locator('.main-nav').getByRole('button', { name: 'Build your own', exact: true }).click();
  await page.getByRole('heading', { name: /The art of your slice/i }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.builder-summary').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('heading', { name: 'Your masterpiece.' }).waitFor({ state: 'visible' });
  const builderPreview = page.locator('[data-builder-preview]');
  await builderPreview.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const preview = document.querySelector('[data-builder-preview]');
    const image = preview?.querySelector('.summary-pizza-photo');
    return Boolean(image?.naturalWidth > 0 && preview?.classList.contains('has-photo'));
  }, null, { timeout: 15_000 });
  const initialBuilderVisual = await builderPreview.evaluate((root) => ({
    source: root.getAttribute('data-builder-preview-source') || '',
    displaySource: root.getAttribute('data-builder-preview-photo-source') || '',
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
  if (!initialBuilderVisual.source.includes('images.unsplash.com') ||
      !initialBuilderVisual.displaySource ||
      initialBuilderVisual.displaySource === initialBuilderVisual.source) {
    throw new Error('A deliberately failed primary Unsplash photo must select a different loaded fallback image: ' + JSON.stringify(initialBuilderVisual));
  }
  await page.unroute(classicPhotoPattern, abortClassicPhoto);
  pass('builder preview falls back to a distinct food photo when its primary image host fails');
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
  // Wait for the fade-in to finish before taking evidence screenshots; a loaded image
  // can have naturalWidth > 0 while its CSS opacity transition is still near zero.
  await page.waitForFunction(() => {
    const preview = document.querySelector('[data-builder-preview]');
    const photo = preview?.querySelector('.summary-pizza-photo');
    const rect = photo?.getBoundingClientRect();
    return Boolean(
      preview?.classList.contains('has-photo') &&
      photo?.naturalWidth > 0 &&
      Number.parseFloat(getComputedStyle(photo).opacity) >= 0.99 &&
      rect && rect.width > 100 && rect.height > 100
    );
  }, null, { timeout: 5000 });
  pass('builder reference photo is visibly rendered, not only downloaded');
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
    background: getComputedStyle(el).backgroundColor,
    rowBackground: getComputedStyle(el.querySelector('.page-endcap-item')).backgroundColor,
    afterContent: getComputedStyle(el, '::after').content,
    eyebrowIcons: el.querySelectorAll('.page-endcap-main .eyebrow svg').length,
  }));
  const usesPremiumNavyGradient = builderEndcapNight.backgroundImage.includes('linear-gradient') &&
      builderEndcapNight.backgroundImage.includes('rgb(16, 36, 51)') &&
      builderEndcapNight.backgroundImage.includes('rgb(11, 26, 38)');
  if (!usesPremiumNavyGradient ||
      builderEndcapNight.rowBackground !== 'rgba(0, 0, 0, 0)' ||
      builderEndcapNight.afterContent !== 'none' ||
      builderEndcapNight.eyebrowIcons !== 0) {
    throw new Error('Builder lower-page endcap is not using the premium navy gradient with restrained editorial rows: ' + JSON.stringify(builderEndcapNight));
  }
  pass('custom builder uses a premium navy gradient, editorial helper rows and no sparkle/ring decoration');
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
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-home-builder-promo] .button-light');
    return document.documentElement.dataset.theme === 'dark' &&
      button && getComputedStyle(button).backgroundColor === 'rgb(255, 210, 122)';
  }, null, { timeout: 5_000 });
  const homePromoNight = await page.locator('[data-home-builder-promo]').evaluate((el) => ({
    titleColor: getComputedStyle(el.querySelector('h3')).color,
    iconBackground: getComputedStyle(el.querySelector('.callout-icon')).backgroundColor,
    ctaBackground: getComputedStyle(el.querySelector('.button-light')).backgroundColor,
    ctaColor: getComputedStyle(el.querySelector('.button-light')).color,
    proofCount: el.querySelectorAll('.custom-callout-proof span').length,
  }));
  // The current dark-theme CSS token is #ffd27a (rgb 255, 210, 122).
  if (homePromoNight.titleColor !== 'rgb(247, 249, 250)' ||
      homePromoNight.iconBackground !== 'rgb(27, 51, 66)' ||
      homePromoNight.ctaBackground !== 'rgb(255, 210, 122)' ||
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

  await page.locator('.hero').getByRole('button', { name: 'Explore the menu', exact: true }).click();
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
    surface: getComputedStyle(el).backgroundColor,
    surfaceImage: getComputedStyle(el).backgroundImage,
    rowBackground: getComputedStyle(el.querySelector('.page-endcap-item')).backgroundColor,
    rowBorder: getComputedStyle(el.querySelector('.page-endcap-item')).borderTopColor,
    cardText: getComputedStyle(el.querySelector('.page-endcap-item h3')).color,
    detailText: getComputedStyle(el.querySelector('.page-endcap-item p')).color,
    afterContent: getComputedStyle(el, '::after').content,
    eyebrowIcons: el.querySelectorAll('.page-endcap-main .eyebrow svg').length,
  }));
  const menuUsesPremiumNavyGradient = menuEndcapNight.surfaceImage.includes('linear-gradient') &&
      menuEndcapNight.surfaceImage.includes('rgb(16, 36, 51)') &&
      menuEndcapNight.surfaceImage.includes('rgb(11, 26, 38)');
  if (!menuUsesPremiumNavyGradient ||
      menuEndcapNight.surface !== 'rgb(16, 36, 51)' ||
      menuEndcapNight.rowBackground !== 'rgba(0, 0, 0, 0)' ||
      menuEndcapNight.rowBorder !== 'rgb(43, 67, 83)' ||
      menuEndcapNight.cardText !== 'rgb(237, 243, 246)' ||
      menuEndcapNight.detailText !== 'rgb(168, 186, 197)' ||
      menuEndcapNight.afterContent !== 'none' ||
      menuEndcapNight.eyebrowIcons !== 0) {
    throw new Error('Menu lower-page rows are not readable over the premium navy gradient: ' + JSON.stringify(menuEndcapNight));
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

  const inspectCartCheckoutTheme = async () => page.locator('[data-cart-page="premium-checkout-v1"]').evaluate((section) => {
    const line = section.querySelector('.cart-line');
    const delivery = section.querySelector('.delivery-details-panel');
    const summary = section.querySelector('.order-summary');
    const checkout = summary?.querySelector('.full-button');
    return {
      theme: document.documentElement.dataset.theme,
      summaryTitle: summary?.querySelector('h2')?.textContent?.trim() || '',
      summaryCopy: summary?.querySelector('.order-summary-copy')?.textContent?.trim() || '',
      lineBackground: line ? getComputedStyle(line).backgroundImage : '',
      lineRadius: line ? getComputedStyle(line).borderRadius : '',
      deliveryBackground: delivery ? getComputedStyle(delivery).backgroundImage : '',
      summaryBackground: summary ? getComputedStyle(summary).backgroundImage : '',
      summaryTitleColor: summary ? getComputedStyle(summary.querySelector('h2')).color : '',
      checkoutHeight: checkout?.getBoundingClientRect().height || 0,
      lineRight: line?.getBoundingClientRect().right || 0,
      summaryRight: summary?.getBoundingClientRect().right || 0,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  const cartLightVisual = await inspectCartCheckoutTheme();
  if (cartLightVisual.theme !== 'light' ||
      cartLightVisual.summaryTitle !== 'Order summary' ||
      !cartLightVisual.summaryCopy.includes('your full total') ||
      !cartLightVisual.lineBackground.includes('linear-gradient') ||
      !cartLightVisual.deliveryBackground.includes('linear-gradient') ||
      !cartLightVisual.summaryBackground.includes('linear-gradient') ||
      cartLightVisual.checkoutHeight < 51.5 ||
      cartLightVisual.lineRight > cartLightVisual.viewportWidth + 1 ||
      cartLightVisual.summaryRight > cartLightVisual.viewportWidth + 1) {
    throw new Error('Light-theme cart/checkout hierarchy or mobile fit failed: ' + JSON.stringify(cartLightVisual));
  }
  pass('cart and checkout show clear order-summary copy, premium item/address/total surfaces and a full-size CTA in light mode');
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
  const cartEndcapNight = await cartEndcap.evaluate((el) => ({
    surface: getComputedStyle(el).backgroundColor,
    surfaceImage: getComputedStyle(el).backgroundImage,
    rowText: getComputedStyle(el.querySelector('.page-endcap-item h3')).color,
    afterContent: getComputedStyle(el, '::after').content,
    eyebrowIcons: el.querySelectorAll('.page-endcap-main .eyebrow svg').length,
  }));
  const cartUsesPremiumNavyGradient = cartEndcapNight.surfaceImage.includes('linear-gradient') &&
      cartEndcapNight.surfaceImage.includes('rgb(16, 36, 51)') &&
      cartEndcapNight.surfaceImage.includes('rgb(11, 26, 38)');
  if (!cartUsesPremiumNavyGradient ||
      cartEndcapNight.surface !== 'rgb(16, 36, 51)' ||
      cartEndcapNight.rowText !== 'rgb(237, 243, 246)' ||
      cartEndcapNight.afterContent !== 'none' ||
      cartEndcapNight.eyebrowIcons !== 0) {
    throw new Error('Bag lower-page rows are not readable over the premium navy gradient: ' + JSON.stringify(cartEndcapNight));
  }
  await captureScreenshot(page, '10-bag-night-mobile.png');
  await auditResponsiveState(page, 'bag-night');

  const cartCheckoutNight = await inspectCartCheckoutTheme();
  if (cartCheckoutNight.theme !== 'dark' ||
      cartCheckoutNight.summaryTitleColor !== 'rgb(243, 246, 248)' ||
      !cartCheckoutNight.lineBackground.includes('rgb(20, 38, 53)') ||
      !cartCheckoutNight.deliveryBackground.includes('rgb(20, 38, 53)') ||
      !cartCheckoutNight.summaryBackground.includes('rgb(20, 38, 53)') ||
      cartCheckoutNight.checkoutHeight < 51.5 ||
      cartCheckoutNight.lineRight > cartCheckoutNight.viewportWidth + 1 ||
      cartCheckoutNight.summaryRight > cartCheckoutNight.viewportWidth + 1) {
    throw new Error('Night-theme cart/checkout contrast or mobile fit failed: ' + JSON.stringify(cartCheckoutNight));
  }
  pass('cart, delivery form and order summary retain premium navy surfaces and readable hierarchy in night mode');
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

  // The resend probe uses a unique nonexistent address, so production data and inboxes are untouched.
  const resendVerificationButton = dialog.getByRole('button', { name: 'Resend verification email', exact: true });
  await resendVerificationButton.waitFor({ state: 'visible', timeout: 5_000 });
  const resendVerificationResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/resend-verification' &&
    response.request().method() === 'POST',
  );
  await resendVerificationButton.click();
  const resendVerificationResponse = await resendVerificationResponsePromise;
  if (resendVerificationResponse.status() !== 200) {
    throw new Error('Resend verification probe returned HTTP ' + resendVerificationResponse.status() + '.');
  }
  const resendVerificationPayload = await resendVerificationResponse.json();
  if (!/If an account exists and requires email verification/i.test(resendVerificationPayload.message || '')) {
    throw new Error('Resend verification did not return the generic privacy-preserving response.');
  }
  pass('sign-in exposes the verification-resend action and API avoids account enumeration for a nonexistent address');

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
    await page.route('**/api/orders/browser-smoke-ops-order/confirm-delivery', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      if (activeMockedUser?.role !== 'user' || qaOpsOrder?.status !== 'sent_to_delivery' || !qaOpsOrder?.deliveryConfirmationRequestedAt) {
        await route.fulfill({ status: 409, json: { error: 'Customer confirmation is not available for this order.' } });
        return;
      }
      const now = new Date().toISOString();
      qaOpsOrder = { ...qaOpsOrder, status: 'delivered', deliveredAt: now, deliveryConfirmedAt: now };
      await route.fulfill({
        status: 200,
        json: { order: { id: qaOpsOrder.id, orderNumber: qaOpsOrder.orderNumber, status: 'delivered', deliveredAt: now, deliveryConfirmedAt: now, paymentMode: 'test' } },
      });
    });
    await page.route('**/api/orders/my', async (route) => {
      const confirmationIsPending = qaOpsOrder?.status === 'sent_to_delivery' && Boolean(qaOpsOrder?.deliveryConfirmationRequestedAt);
      const customerOpsOrderIsVisible = qaOpsOrder?.status === 'delivered' || confirmationIsPending;
      const visibleOrder = activeMockedUser?.role === 'user'
        ? customerOpsOrderIsVisible ? qaOpsOrder : qaCheckoutOrder?.paymentStatus === 'paid' ? qaCheckoutOrder : null
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
      if (pathname === '/api/ops/orders/browser-smoke-ops-order/request-delivery-confirmation' && request.method() === 'POST') {
        if (role !== 'delivery' || qaOpsOrder?.status !== 'sent_to_delivery' || qaOpsOrder?.deliveryConfirmationRequestedAt) {
          await route.fulfill({ status: 409, json: { error: 'The mocked customer-confirmation request is not allowed.' } });
          return;
        }
        qaOpsOrder = { ...qaOpsOrder, deliveryConfirmationRequestedAt: new Date().toISOString() };
        await route.fulfill({
          status: 200,
          json: { order: { id: qaOpsOrder.id, orderNumber: qaOpsOrder.orderNumber, status: qaOpsOrder.status, deliveryConfirmationRequestedAt: qaOpsOrder.deliveryConfirmationRequestedAt, fulfillmentMode: 'simulated' } },
        });
        return;
      }
      if (pathname === '/api/ops/orders/browser-smoke-ops-order/status' && request.method() === 'PATCH') {
        const body = request.postDataJSON();
        const allowed = role === 'kitchen' && (
          (qaOpsOrder?.status === 'order_received' && body?.status === 'in_kitchen') ||
          (qaOpsOrder?.status === 'in_kitchen' && body?.status === 'sent_to_delivery')
        );
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
    const sandboxNotice = page.getByText('The OTP screen is simulated. No SMS is sent and no real money is charged.', { exact: true });
    await sandboxNotice.waitFor({ state: 'visible', timeout: 10_000 });
    if (!(await sandboxNotice.isVisible())) throw new Error('Checkout must clearly disclose that Test Mode does not send an SMS or charge real money.');
    pass('checkout makes the Test Mode OTP/no-real-charge boundary visible');
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

    // A payment-review hold must remain blocked from fulfillment but still expose a customer support route.
    qaCheckoutOrder = {
      ...qaCheckoutOrder,
      status: 'payment_review',
      paymentStatus: 'paid',
      paymentReviewRequired: true,
    };
    const customerOrderRefresh = page.getByRole('button', { name: 'Refresh', exact: true });
    await customerOrderRefresh.click();
    const paymentSupportButton = page.getByRole('button', { name: 'Get payment support', exact: true });
    await paymentSupportButton.waitFor({ state: 'visible', timeout: 10_000 });
    await paymentSupportButton.click();
    const paymentSupportDialog = page.locator('.issue-report-modal');
    await paymentSupportDialog.waitFor({ state: 'visible', timeout: 10_000 });
    const paymentCategory = paymentSupportDialog.locator('[data-payment-review-support="payment-support-v1"]');
    await paymentCategory.waitFor({ state: 'visible', timeout: 5_000 });
    const paymentCategoryState = await paymentCategory.evaluate((select) => ({
      value: select.value,
      options: Array.from(select.options).map((option) => ({ value: option.value, label: option.textContent.trim() })),
    }));
    if (paymentCategoryState.value !== 'payment_refund' ||
        paymentCategoryState.options.length !== 1 ||
        paymentCategoryState.options[0].value !== 'payment_refund' ||
        !(await paymentSupportDialog.getByText(/does not automatically issue a refund/i).count())) {
      throw new Error('Payment-review support must default to the only valid category and must not promise an automatic refund: ' + JSON.stringify(paymentCategoryState));
    }
    pass('payment-review customer can open a payment-only support case without unlocking fulfillment or promising a refund');
    await page.keyboard.press('Escape');
    await paymentSupportDialog.waitFor({ state: 'hidden', timeout: 5_000 });
    qaCheckoutOrder = { ...qaCheckoutOrder, status: 'order_received', paymentReviewRequired: false };
    await customerOrderRefresh.click();

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
    await deliveryOrder.getByRole('button', { name: 'Request customer confirmation', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await captureScreenshot(page, '17-mocked-delivery-run-light.png');
    await auditResponsiveState(page, 'mocked-delivery-run-light');

    const deliveryRequestPromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/ops/orders/browser-smoke-ops-order/request-delivery-confirmation' &&
      response.request().method() === 'POST',
    );
    await deliveryOrder.getByRole('button', { name: 'Request customer confirmation', exact: true }).click();
    const deliveryRequestResponse = await deliveryRequestPromise;
    if (deliveryRequestResponse.status() !== 200 || qaOpsOrder.status !== 'sent_to_delivery' || !qaOpsOrder.deliveryConfirmationRequestedAt || qaOpsOrder.deliveredAt) {
      throw new Error('Delivery partner request should notify the customer without marking the order delivered.');
    }
    await deliveryOrder.locator('.fulfillment-waiting-note').waitFor({ state: 'visible', timeout: 10_000 });
    pass('delivery partner requests customer receipt confirmation; the order remains on the way until the customer confirms');

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
    await customerQaOrder.locator('.delivery-confirmation-card[data-delivery-confirmation="requested"]').waitFor({ state: 'visible', timeout: 10_000 });
    const customerConfirmResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/orders/browser-smoke-ops-order/confirm-delivery' &&
      response.request().method() === 'POST',
    );
    await customerQaOrder.getByRole('button', { name: 'I received my order', exact: true }).click();
    const customerConfirmResponse = await customerConfirmResponsePromise;
    if (customerConfirmResponse.status() !== 200 || qaOpsOrder.status !== 'delivered' || !qaOpsOrder.deliveryConfirmedAt || !qaOpsOrder.deliveredAt) {
      throw new Error('Only the authenticated customer confirmation should mark the synthetic order delivered.');
    }
    await customerQaOrder.locator('.delivery-confirmation-card').waitFor({ state: 'hidden', timeout: 10_000 });
    pass('authenticated customer confirms receipt; delivery is marked complete only after their action');
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
      counts: { queued: 2, sending: 0, sentLast24Hours: 1, dead: 1, retrying: 1 },
      oldestQueuedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      recentFailures: [{
        orderNumber: 'PH-NOTIFY-RETRY',
        attempts: 2,
        deliveryStatus: 'queued',
        lastError: 'Email provider rejected the request (HTTP 422)',
        lastAttemptAt: new Date(Date.now() - 2 * 60_000).toISOString(),
        nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
        updatedAt: new Date().toISOString(),
      }],
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
    await page.locator('.main-nav.open').getByRole('button', { name: 'Sign in', exact: true }).click();
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
      { label: 'Retrying', count: '1' },
      { label: 'Sending', count: '0' },
      { label: 'Sent · 24h', count: '1' },
      { label: 'Needs attention', count: '1' },
    ];
    if (JSON.stringify(queueMetrics) !== JSON.stringify(expectedMetrics)) {
      throw new Error('Admin notification metrics do not match the mocked health response: ' + JSON.stringify(queueMetrics));
    }
    await notificationPanel.getByText('PH-NOTIFY-RETRY', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await notificationPanel.getByText('Email provider rejected the request (HTTP 422)', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await notificationPanel.getByText(/2 attempts/).waitFor({ state: 'visible', timeout: 10_000 });
    await notificationPanel.getByText('PH-NOTIFY-QA', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await notificationPanel.getByText('Email provider delivery failed', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await notificationPanel.getByText(/8 attempts/).waitFor({ state: 'visible', timeout: 10_000 });
    pass('admin notification panel separates retryable provider failures from dead letters, with safe error details and queue metrics');

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
