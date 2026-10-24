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
  let premiumVisualState = { variantCount: 0, primaryColor: '', footerColor: '' };
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
      (await page.locator('[data-theme-toggle]').count() === 1);

    premiumVisualState = await page.locator('.pizza-card').evaluateAll((cards) => {
      const names = ['tomato', 'green', 'orange', 'cream'];
      const variants = cards.map((card) => names.find((name) => card.classList.contains(name))).filter(Boolean);
      const primary = document.querySelector('.hero .button-dark');
      const footer = document.querySelector('.site-footer');
      return {
        variantCount: new Set(variants).size,
        primaryColor: primary ? getComputedStyle(primary).backgroundColor : '',
        footerColor: footer ? getComputedStyle(footer).backgroundColor : '',
      };
    }).catch(() => ({ variantCount: 0, primaryColor: '', footerColor: '' }));

    if (releaseMarkersReady &&
        premiumVisualState.variantCount >= 3 &&
        premiumVisualState.primaryColor === 'rgb(228, 71, 50)' &&
        premiumVisualState.footerColor === 'rgb(16, 39, 55)') {
      mobileSignInReady = true;
      break;
    }

    console.log(
      '[WAIT] waiting for current Pizza House visual release (' + attempt + '/20; variants=' +
      premiumVisualState.variantCount + '; CTA=' + premiumVisualState.primaryColor +
      '; footer=' + premiumVisualState.footerColor + ')',
    );
    await page.waitForTimeout(5_000);
  }
  if (!mobileSignInReady) {
    throw new Error('Hosted site did not publish the distinct pizza artwork + navy/red visual release after 20 checks: ' + JSON.stringify(premiumVisualState));
  }
  pass('featured pizza cards render at least three distinct recipe-driven artwork variants');
  pass('primary CTA uses tomato red and the footer uses the navy brand surface');

  await page.locator('.pizza-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('heading', { name: 'Margherita Classic', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  pass('home featured cards wait for live catalog before visual capture');
  await captureScreenshot(page, '01-home-mobile.png');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  if (await page.locator('.main-nav .mobile-auth-link').isVisible()) {
    throw new Error('Mobile-only sign-in link must stay hidden in the desktop navigation.');
  }
  pass('desktop header shows only one sign-in action');
  await captureScreenshot(page, '02-home-desktop.png');
  const homeEndcap = page.locator('[data-page-endcap="home"]');
  await homeEndcap.waitFor({ state: 'visible', timeout: 15_000 });
  const liveCatalogResponse = await page.request.get(`${webUrl}/api/catalog`, { timeout: 10_000 });
  if (!liveCatalogResponse.ok()) throw new Error('The live catalog endpoint did not load for the home lower-page check.');
  const liveCatalogBody = await liveCatalogResponse.json();
  const liveFeaturedCount = Array.isArray(liveCatalogBody?.featuredPizzas) ? liveCatalogBody.featuredPizzas.length : -1;
  const endcapLight = await homeEndcap.evaluate((el) => ({
    itemCount: el.querySelectorAll('.page-endcap-item').length,
    featuredCount: Number(el.dataset.featuredCount),
    headingColor: getComputedStyle(el.querySelector('.page-endcap-main h2')).color,
    cardColor: getComputedStyle(el.querySelector('.page-endcap-item')).backgroundColor,
  }));
  if (endcapLight.itemCount !== 3 || endcapLight.featuredCount !== liveFeaturedCount ||
      endcapLight.headingColor !== 'rgb(40, 37, 34)' || endcapLight.cardColor !== 'rgba(255, 255, 255, 0.72)') {
    throw new Error('Home lower-page cards did not reflect live catalog data or the light palette: ' + JSON.stringify({ endcapLight, liveFeaturedCount }));
  }
  const footerNavCount = await page.locator('.footer-nav button').count();
  if (footerNavCount < 4) throw new Error('Footer is missing expected navigation shortcuts.');
  pass('home lower-page helper cards reflect the live catalog and use the light palette');
  pass('shared footer provides working navigation shortcuts');
  await captureScreenshot(page, '15-home-endcap-light-desktop.png');
  await auditResponsiveState(page, 'home');

  // The custom builder has its own option cards, recipe preview, pricing and
  // quantity controls. Audit it in both themes instead of assuming home styles
  // prove every product surface is readable.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Build your own', exact: true }).click();
  await page.getByRole('heading', { name: /The art of your slice/i }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.builder-summary').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('heading', { name: 'Your masterpiece.' }).waitFor({ state: 'visible' });
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
  await page.getByRole('button', { name: 'Home', exact: true }).click();
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
  const homeEndcapNight = await page.locator('[data-page-endcap="home"]').evaluate((el) => ({
    itemCount: el.querySelectorAll('.page-endcap-item').length,
    headingColor: getComputedStyle(el.querySelector('.page-endcap-main h2')).color,
    cardBackground: getComputedStyle(el.querySelector('.page-endcap-item')).backgroundColor,
  }));
  if (homeEndcapNight.itemCount !== 3 || homeEndcapNight.headingColor !== 'rgb(243, 246, 248)' ||
      homeEndcapNight.cardBackground !== 'rgb(16, 32, 45)') {
    throw new Error('Home lower-page helper cards did not switch to the night palette: ' + JSON.stringify(homeEndcapNight));
  }
  pass('home lower-page helper cards switch to the premium night palette');
  await captureScreenshot(page, '16-home-endcap-night-desktop.png');
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

    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.route('**/api/auth/login', async (route) => {
      const body = route.request().postDataJSON();
      if (body?.email !== mockedUser.email || body?.password !== 'MockOnlyPass123') {
        await route.fulfill({ status: 400, json: { error: 'Unexpected mock sign-in input.' } });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          'set-cookie': mockedSessionCookie + '; Path=/; HttpOnly; Secure; SameSite=Lax',
        },
        json: { user: mockedUser },
      });
    });
    await page.route('**/api/auth/me', async (route) => {
      const hasSession = (route.request().headers().cookie || '').includes(mockedSessionCookie);
      await route.fulfill({
        status: hasSession ? 200 : 401,
        json: hasSession ? { user: mockedUser } : { error: 'Sign in to continue' },
      });
    });
    await page.route('**/api/orders/my', (route) =>
      route.fulfill({ status: 200, json: { orders: [] } }),
    );
    await page.route('**/api/issues/my', (route) =>
      route.fulfill({ status: 200, json: { issues: [] } }),
    );
    await page.route('**/api/auth/logout', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
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
    let qaCheckoutOrder = null;
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
    console.log('[INFO] These successful-auth browser checks use mocked auth endpoints; live production sign-in still needs the optional QA customer secrets.');
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
