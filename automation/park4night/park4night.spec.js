/**
 * park4night — page object model spec
 *
 * Uses the new POM structure:
 *   - Pages are in pages/
 *   - Page objects own their selectors (no static selectors)
 *   - Core utilities in core/
 *
 * ── Run via MCP ──────────────────────────────────────────────────────────────
 *
 *   1. Open a session:
 *        session.open { "sessionName": "p4n-test" }
 *
 *   2. Run a test:
 *        browser.run_test { "sessionName": "p4n-test", "files": ["automation/park4night/park4night.spec.js"] }
 *
 *   3. Run search with custom coords:
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
import { loadToml } from '../../config/toml.js';
import { paths } from '../../config/paths.js';
import fs from 'fs';

const toml = loadToml(paths.config);
const creds = /** @type {any} */ (toml.raw?.credentials);
const p4nCreds = /** @type {{email: string, password: string}} */ (creds?.park4night);
if (!p4nCreds?.email || !p4nCreds?.password) {
  throw new Error(
    '[credentials.park4night] email= , password= missing in szkrabok.config.local.toml'
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

/**
 * Block noisy requests that are irrelevant to test logic:
 * tracking (Sentry) and image assets (jpg, jpeg, png).
 * Call once per page before any navigation.
 * @param {import('playwright').Page} page
 * @returns {Promise<void>}
 */
async function blockNoise(page) {
  await page.route('**sentry**', route => route.abort());
  await page.route('**/*.jpg', route => route.abort());
  await page.route('**/*.jpeg', route => route.abort());
  await page.route('**/*.png', route => route.abort());
}

/**
 * Navigate to the park4night main page and wait for it to load.
 * @param {import('playwright').Page} page
 * @returns {Promise<void>}
 */
async function openMainPage(page) {
  await blockNoise(page);
  await page.goto(BASE_URL);
  await humanizeOnLoad(page);
}

/**
 * Dismiss the cookie consent banner if present.
 * @param {import('playwright').Page} page
 * @returns {Promise<{ action: string, dismissed?: boolean, reason?: string }>}
 */
async function acceptCookies(page) {
  const banner = new CookieBannerPage(page);
  return banner.dismiss();
}

/**
 * Ensure the user is logged in. Performs login with stored credentials if not already.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} true if logged in after the call
 */
async function ensureLoggedIn(page) {
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
  return isLogged;
}

/**
 * Navigate to the park4night search page for the given coord, intercept the
 * /api/places/around response, decode and return the JSON body, and write it
 * to a timestamped dump file in /tmp.
 *
 * The response listener is registered before navigation and removed after the
 * capture lands so it does not bleed into subsequent calls on the same page.
 *
 * @param {import('playwright').Page} page
 * @param {Coord} coord
 * @returns {Promise<{ coord: Coord, body: string, dumpPath: string }>}
 */
async function fetchPlacesAround(page, coord) {
  const { lat, lng, z, label } = coord;

  /** @type {string|null} */
  let captured = null;

  /** @param {import('playwright').Response} response */
  const listener = async response => {
    if (!response.url().includes('/api/places/around')) return;
    const raw = await response.text();
    // CDP returns the body base64-encoded; decode to get the actual UTF-8 JSON
    captured = Buffer.from(raw, 'base64').toString('utf-8');
    console.log(`[places/around] captured for "${label}": ${response.url()}`);
  };

  page.on('response', listener);

  try {
    await page.goto(`https://park4night.com/en/search?lat=${lat}&lng=${lng}&z=${z}`);
    await humanizeOnLoad(page);

    if (!captured) {
      await page.waitForResponse(resp => resp.url().includes('/api/places/around'), {
        timeout: 15000,
      });
    }
  } finally {
    page.removeListener('response', listener);
  }

  if (!captured) throw new Error(`[places/around] no response captured for "${label}"`);

  const dumpPath = timestampedPath(`p4n-dump-${label.replace(/\s+/g, '-').toLowerCase()}`);
  fs.writeFileSync(dumpPath, captured, 'utf8');
  console.log(`[places/around] dump saved to ${dumpPath} for "${label}"`);

  return { coord, body: captured, dumpPath };
}

// ── Tests ────────────────────────────────────────────────────────────────────

/**
 * Verifies that the cookie banner is handled and the user can log in.
 * Accepts the cookie banner if present (or skips if already dismissed).
 * Logs in with stored credentials if not already authenticated.
 *
 * Result: { cookieResult, isLogged }
 */
test('accept cookies and login', async ({ page }, testInfo) => {
  await openMainPage(page);

  const cookieResult = await acceptCookies(page);
  expect(['clicked', 'skipped']).toContain(cookieResult.action);

  const isLogged = await ensureLoggedIn(page);
  expect(isLogged).toBe(true);

  await attachResult(testInfo, { cookieResult, isLogged });
});

/**
 * Navigates to the park4night search page for each coord in the list,
 * intercepts the /api/places/around response, and writes the JSON body
 * to a timestamped dump file in /tmp.
 *
 * Cookie acceptance and login are performed once before the coord loop.
 *
 * Coords source (in priority order):
 *   1. TEST_COORDS env var — JSON array of Coord, set via browser.run_test params
 *   2. DEFAULT_COORDS — hardcoded fallback at the top of this file
 *
 * Result: { isLogged, cookieResult, results: [{ label, dumpPath }] }
 */
test('search by gps', async ({ page }, testInfo) => {
  /**
   * Resolve coords from TEST_COORDS env var (set via browser.run_test params)
   * or fall back to the built-in DEFAULT_COORDS defined in this file.
   * @type {Coord[]}
   */
  const coords = process.env.TEST_COORDS
    ? (() => {
        console.log('[search] using coords from TEST_COORDS env');
        return /** @type {Coord[]} */ (JSON.parse(process.env.TEST_COORDS));
      })()
    : (() => {
        console.log('[search] TEST_COORDS not set — using built-in default coords');
        return DEFAULT_COORDS;
      })();

  await blockNoise(page);

  const cookieResult = await acceptCookies(page);
  expect(['clicked', 'skipped']).toContain(cookieResult.action);

  const isLogged = await ensureLoggedIn(page);
  expect(isLogged).toBe(true);

  /** @type {{ coord: Coord, body: string, dumpPath: string }[]} */
  const results = [];

  for (const coord of coords) {
    console.log(`[search] processing coord "${coord.label}" lat=${coord.lat} lng=${coord.lng}`);
    const result = await fetchPlacesAround(page, coord);
    results.push(result);
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
