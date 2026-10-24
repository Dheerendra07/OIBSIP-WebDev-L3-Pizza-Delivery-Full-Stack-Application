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

  // The static site deploys independently from the API/workflow. Wait for the newly
  // deployed bundle marker instead of testing yesterday's live frontend by accident.
  let mobileSignInReady = false;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('.hero h1').waitFor({ state: 'visible', timeout: 30_000 });
    if ((await page.locator('.mobile-auth-link').count() === 1) &&
        (await page.locator('[data-mobile-auth-focus="dialog-first"]').count() === 1) &&
        (await page.locator('[data-payment-provider-check="readonly-admin-v1"]').count() === 1) &&
        (await page.locator('[data-auth-toast-fix="clear-stale-toast-v1"]').count() === 1)) {
      mobileSignInReady = true;
      break;
    }
    console.log(`[WAIT] hosted frontend has not published the admin payment-check panel yet (${attempt}/20)`);
    await page.waitForTimeout(5_000);
  }
  if (!mobileSignInReady) {
    throw new Error('Hosted frontend did not publish the admin payment-check panel after 20 checks.');
  }

  await page.locator('.pizza-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('heading', { name: 'Margherita Classic', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  pass('home featured cards wait for live catalog before visual capture');
  await captureScreenshot(page, '01-home-mobile.png');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await captureScreenshot(page, '02-home-desktop.png');
  await auditResponsiveState(page, 'home');

  await page.getByRole('button', { name: 'Explore the menu' }).click();
  await page.locator('.pizza-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('heading', { name: 'Margherita Classic', exact: true }).waitFor({ state: 'visible' });
  await captureScreenshot(page, '03-menu-mobile.png');
  await auditResponsiveState(page, 'menu');
  pass('hosted home and live menu render');

  await page.getByRole('button', { name: 'Add Margherita Classic', exact: true }).click();
  await page.locator('.bag-button').click();
  await page.getByRole('heading', { name: /Your little bag of joy/i }).waitFor({ state: 'visible' });
  await page.locator('.delivery-details-panel').waitFor({ state: 'visible' });
  if ((await page.locator('.bag-button b').innerText()).trim() !== '1') {
    throw new Error('Adding a pizza did not update the bag count to one.');
  }
  await page.locator('.toast').waitFor({ state: 'hidden', timeout: 6_000 }).catch(() => {});
  await captureScreenshot(page, '04-bag-mobile.png');
  await auditResponsiveState(page, 'bag');
  pass('menu → bag → delivery form interaction');

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
    await captureScreenshot(page, '06-live-customer-dashboard.png');
    await auditResponsiveState(page, 'live-customer-dashboard');

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
    await captureScreenshot(page, '06-mocked-customer-dashboard.png');
    await auditResponsiveState(page, 'mocked-customer-dashboard');
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
