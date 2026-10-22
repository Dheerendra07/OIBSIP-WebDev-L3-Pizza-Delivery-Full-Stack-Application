import { chromium } from 'playwright';

const webUrl = (process.env.CLIENT_WEB_URL || 'https://pizza-house-web-n75h.onrender.com').replace(/\/$/, '');
const checks = [];
let browser;

function pass(label) {
  checks.push(label);
  console.log(`[PASS] ${label}`);
}

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'en-IN',
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // The static site deploys independently from the API/workflow. Wait for the newly
  // deployed bundle marker instead of testing yesterday's live frontend by accident.
  let mobileSignInReady = false;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('.hero h1').waitFor({ state: 'visible', timeout: 30_000 });
    if (await page.locator('.mobile-auth-link').count() === 1) {
      mobileSignInReady = true;
      break;
    }
    console.log(`[WAIT] hosted frontend has not published the mobile sign-in fix yet (${attempt}/12)`);
    await page.waitForTimeout(5_000);
  }
  if (!mobileSignInReady) {
    throw new Error('Hosted frontend did not publish the mobile sign-in fix after 12 checks.');
  }
  await page.getByRole('button', { name: 'Explore the menu' }).click();
  await page.locator('.pizza-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('heading', { name: 'Margherita Classic', exact: true }).waitFor({ state: 'visible' });
  pass('hosted home and live menu render');

  await page.getByRole('button', { name: 'Add Margherita Classic', exact: true }).click();
  await page.locator('.bag-button').click();
  await page.getByRole('heading', { name: /Your little bag of joy/i }).waitFor({ state: 'visible' });
  await page.locator('.delivery-details-panel').waitFor({ state: 'visible' });
  if ((await page.locator('.bag-button b').innerText()).trim() !== '1') {
    throw new Error('Adding a pizza did not update the bag count to one.');
  }
  pass('menu → bag → delivery form interaction');

  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const mobileNav = page.locator('.main-nav.open');
  await mobileNav.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByLabel('Email address').fill(`qa-smoke-${Date.now()}@example.invalid`);
  await dialog.getByLabel('Password').fill('NotARealPassword123');

  const loginResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  if (loginResponse.status() !== 401) {
    throw new Error(`A sign-in probe for a deliberately nonexistent account returned HTTP ${loginResponse.status()}, expected 401.`);
  }
  await page.getByRole('alert').filter({ hasText: /Email or password is incorrect/i })
    .waitFor({ state: 'visible', timeout: 10_000 });
  pass('live sign-in API error reaches the browser accessibly');

  // Inspect signup UI only. Do not create a production account or send an email.
  await dialog.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByRole('heading', { name: 'Make yourself at home.' }).waitFor({ state: 'visible' });
  await dialog.getByLabel('Your name').waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Create my account', exact: true }).waitFor({ state: 'visible' });
  pass('signup form renders without creating a production account');

  if (pageErrors.length) {
    throw new Error(`Browser page errors detected: ${pageErrors.join(' | ')}`);
  }
  pass('no uncaught browser page errors');
  console.log(`Live browser smoke checks passed: ${checks.length}/${checks.length}`);
} catch (error) {
  console.error('Live browser smoke failed:', error?.stack || error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
