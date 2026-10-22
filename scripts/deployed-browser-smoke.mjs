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

  await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.locator('.hero h1').waitFor({ state: 'visible', timeout: 30_000 });
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

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
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
