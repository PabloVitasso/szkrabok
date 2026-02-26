/**
 * park4night — page object model spec
 *
 * Uses the new POM structure:
 *   - Pages are in pages/
 *   - Page objects own their selectors (no static selectors)
 *   - Site config in sites/park4night.js provides baseUrl only
 *   - Core utilities in core/
 *
 * ── Run via MCP ──────────────────────────────────────────────────────────────
 *
 *   1. Open a session:
 *        session.open { "sessionName": "p4n-test" }
 *
 *   2. Run the test:
 *        browser.run_test { "sessionName": "p4n-test", "files": ["automation/park4night/park4night.spec.js"] }
 *
 *   Session behaviour:
 *     NEW session  — profile directory is empty; park4night will show the
 *                    cookie banner. Expected result:
 *                      { "action": "clicked", "dismissed": true }
 *
 *     REUSED session — cookies are already persisted; banner will not appear.
 *                    Expected result:
 *                      { "action": "skipped", "reason": "banner_not_present" }
 *
 * ── Run via Playwright CLI ───────────────────────────────────────────────────
 *
 *   npx playwright test automation/park4night/park4night.spec.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect }      from '../fixtures.js';
import { humanizeOnLoad }     from '../core/human.js';
import { CookieBannerPage }  from './pages/CookieBannerPage.js';
import { MenuPage }          from './pages/MenuPage.js';
import { AuthPromptPage }    from './pages/AuthPromptPage.js';

const BASE_URL = 'https://park4night.com/en';

test('acceptCookies', async ({ page }, testInfo) => {
  await page.goto(BASE_URL);
  await humanizeOnLoad(page);

  const banner = new CookieBannerPage(page);
  await banner.dismiss(testInfo);
});

test('full flow', async ({ page }, testInfo) => {
  await page.goto(BASE_URL);
  await humanizeOnLoad(page);

  const banner = new CookieBannerPage(page);
  const menu   = new MenuPage(page);
  const auth   = new AuthPromptPage(page);

  await banner.dismiss(testInfo);
  await menu.open('Login');
  await auth.login('user@example.com', 'password123');
  expect(await auth.isLoggedIn()).toBe(true);
});
