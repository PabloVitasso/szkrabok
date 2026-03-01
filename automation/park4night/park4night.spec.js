/**
 * park4night — page object model spec
 *
 * Uses the new POM structure:
 *   - Pages are in pages/
 *   - Page objects own their selectors (no static selectors)
 *   - Core utilities in core/
 *
 * Both tests are independently runnable — each navigates and handles
 * cookies/login on its own. Running both together is safe (serial mode).
 *
 * ── Run via MCP ──────────────────────────────────────────────────────────────
 *
 *   1. Open a session:
 *        session.open { "sessionName": "p4n-test" }
 *
 *   2. Run all tests:
 *        browser.run_test { "sessionName": "p4n-test", "files": ["automation/park4night/park4night.spec.js"] }
 *
 *   3. Run search only with custom coords:
 *        browser.run_test {
 *          "sessionName": "p4n-test",
 *          "files": ["automation/park4night/park4night.spec.js"],
 *          "grep": "search by gps",
 *          "params": { "coords": "[{\"lat\":53.38,\"lng\":24.46,\"z\":9,\"label\":\"Poland East\"}]" }
 *        }
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

import { test, expect } from '../fixtures.js';
import { humanizeOnLoad } from '../core/human.js';
import { CookieBannerPage } from './pages/CookieBannerPage.js';
import { AuthPromptPage } from './pages/AuthPromptPage.js';
import { attachResult } from '../core/result.js';
import { timestampedPath } from '../core/utils.js';
import fs from 'fs';

// Tests share one page via CDP — must run serially to avoid modal race conditions.
test.describe.configure({ mode: 'serial' });

const p4nCreds = {
  email: process.env.P4N_EMAIL,
  password: process.env.P4N_PASSWORD,
};
if (!p4nCreds.email || !p4nCreds.password) {
  throw new Error(
    'P4N_EMAIL and P4N_PASSWORD environment variables are required'
  );
}

/**
 * @typedef {{ lat: number, lng: number, z: number, label: string }} Coord
 */

/**
 * Built-in coords used when TEST_COORDS env var is not set.
 * Override at runtime by passing TEST_COORDS as a JSON array via browser.run_test params.
 * @type {Coord[]}
 */
const DEFAULT_COORDS = [
  { lat: 53.380051797385555, lng: 24.4610595703125, z: 9, label: 'Poland East' },
];

const BASE_URL = 'https://park4night.com/en';

// Tracks pages that already have noise routes registered — prevents duplicate
// route handlers when both tests run serially on the same CDP page.
const noiseRegistered = new WeakSet();

/**
 * Block noisy requests: Sentry tracking and image assets (jpg, jpeg, png).
 * Idempotent — safe to call multiple times on the same page.
 * @param {import('playwright').Page} page
 */
async function blockNoise(page) {
  if (noiseRegistered.has(page)) return;
  noiseRegistered.add(page);
  await page.route('**sentry**', route => route.abort());
  await page.route('**/*.jpg', route => route.abort());
  await page.route('**/*.jpeg', route => route.abort());
  await page.route('**/*.png', route => route.abort());
}

/**
 * Navigate to the park4night main page and wait for it to load.
 * @param {import('playwright').Page} page
 */
async function openMainPage(page) {
  await blockNoise(page);
  await page.goto(BASE_URL);
  await humanizeOnLoad(page);
}

/**
 * Navigate, dismiss cookie banner if present, ensure login.
 * Called at the start of every test so each test is independently runnable.
 * @param {import('playwright').Page} page
 * @returns {Promise<{ cookieResult: object, isLogged: boolean }>}
 */
async function setupPage(page) {
  await openMainPage(page);

  const cookieResult = await new CookieBannerPage(page).dismiss();
  expect(
    ['clicked', 'skipped'],
    `unexpected cookie action: ${JSON.stringify(cookieResult)}`
  ).toContain(cookieResult.action);
  console.log(`[cookies] action=${cookieResult.action}${cookieResult.reason ? ` reason=${cookieResult.reason}` : ''}`);

  const auth = new AuthPromptPage(page);
  const wasAlreadyLogged = await auth.isLoggedIn();
  console.log(`[ensureLoggedIn] wasAlreadyLogged=${wasAlreadyLogged}`);
  if (!wasAlreadyLogged) {
    console.log('[ensureLoggedIn] attempting login...');
    await auth.login(p4nCreds.email, p4nCreds.password);
    console.log('[ensureLoggedIn] login() completed, waiting for state...');
  }
  const isLogged = await auth.isLoggedIn({ timeout: 10000 });
  console.log(`[ensureLoggedIn] isLogged=${isLogged}`);
  expect(isLogged, 'login failed — check credentials in szkrabok.config.local.toml').toBe(true);

  return { cookieResult, isLogged };
}

/**
 * Navigate to the search page for a coord, intercept /api/places/around,
 * and write the response body to a timestamped dump file in /tmp.
 * @param {import('playwright').Page} page
 * @param {Coord} coord
 * @returns {Promise<{ coord: Coord, body: string, dumpPath: string }>}
 */
async function fetchPlacesAround(page, coord) {
  const { lat, lng, z, label } = coord;

  // Register before goto so the promise catches the response regardless of timing.
  const responsePromise = page.waitForResponse(
    resp => resp.url().includes('/api/places/around'),
    { timeout: 15000 }
  );

  await page.goto(`https://park4night.com/en/search?lat=${lat}&lng=${lng}&z=${z}`);
  await humanizeOnLoad(page);

  const response = await responsePromise;
  console.log(`[places/around] captured for "${label}": ${response.url()}`);

  const raw = await response.text();
  // CDP returns the body base64-encoded; decode to get the actual UTF-8 JSON
  const captured = Buffer.from(raw, 'base64').toString('utf-8');

  if (!captured) throw new Error(`[places/around] no response captured for "${label}"`);

  const dumpPath = timestampedPath(`p4n-dump-${label.replace(/\s+/g, '-').toLowerCase()}`);
  fs.writeFileSync(dumpPath, captured, 'utf8');
  console.log(`[places/around] dump saved to ${dumpPath} for "${label}"`);

  return { coord, body: captured, dumpPath };
}

// ── Tests ────────────────────────────────────────────────────────────────────

/**
 * Verifies that the cookie banner is handled and the user can log in.
 * Result: { cookieResult, isLogged }
 */
test('accept cookies and login', async ({ page }, testInfo) => {
  const { cookieResult, isLogged } = await setupPage(page);
  await attachResult(testInfo, { cookieResult, isLogged });
});

/**
 * Navigates to the search page for each coord, intercepts /api/places/around,
 * and writes the JSON body to a timestamped dump file in /tmp.
 *
 * Coords source (in priority order):
 *   1. TEST_COORDS env var — JSON array of Coord, set via browser.run_test params
 *   2. DEFAULT_COORDS — hardcoded fallback at the top of this file
 *
 * Result: { isLogged, cookieResult, results: [{ label, dumpPath }] }
 */
test('search by gps', async ({ page }, testInfo) => {
  const coords = process.env.TEST_COORDS
    ? (() => {
        console.log('[search] using coords from TEST_COORDS env');
        return /** @type {Coord[]} */ (JSON.parse(process.env.TEST_COORDS));
      })()
    : (() => {
        console.log('[search] TEST_COORDS not set — using built-in default coords');
        return DEFAULT_COORDS;
      })();

  const { cookieResult, isLogged } = await setupPage(page);

  /** @type {{ coord: Coord, body: string, dumpPath: string }[]} */
  const results = [];
  for (const coord of coords) {
    console.log(`[search] processing coord "${coord.label}" lat=${coord.lat} lng=${coord.lng}`);
    results.push(await fetchPlacesAround(page, coord));
  }

  expect(results).toHaveLength(coords.length);
  results.forEach(r => expect(r.body, `no body for "${r.coord.label}"`).toBeTruthy());
  console.log(`[search] completed ${results.length}/${coords.length} coords`);

  await attachResult(testInfo, {
    isLogged,
    cookieResult,
    results: results.map(r => ({ label: r.coord.label, dumpPath: r.dumpPath })),
  });
});
