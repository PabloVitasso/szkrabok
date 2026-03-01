/*
 * rebrowser-check — bot-detection test (bot-detector.rebrowser.net)
 *
 * Opens the rebrowser bot detector page, runs the required triggers, and
 * asserts that each check shows a passing result.
 *
 * Checks covered:
 *   dummyFn, sourceUrlLeak, mainWorldExecution, runtimeEnableLeak,
 *   exposeFunctionLeak, navigatorWebdriver, viewport, pwInitScripts, bypassCsp,
 *   useragent
 *
 * Required triggers (per the page instructions):
 *   - page.evaluate(() => window.dummyFn())          — dummyFn
 *   - page.exposeFunction('exposedFn', fn)            — exposeFunctionLeak
 *   - page.evaluate(() => document.getElementById('detections-json')) — sourceUrlLeak
 *   - page.evaluate(() => document.getElementsByClassName('div'))     — mainWorldExecution
 *
 * ── HEADED ONLY ──────────────────────────────────────────────────────────────
 *
 * bot-detector.rebrowser.net aborts navigation in headless mode (ERR_ABORTED).
 * Always open the session with headless: false.
 *
 * ── Run via MCP (recommended) ────────────────────────────────────────────────
 *
 *   1. Open a session (launches Chrome with a persistent profile + CDP port):
 *        session.open { "sessionName": "rebrowser", "launchOptions": { "headless": false } }
 *
 *   2. Run the test (connects to that Chrome via CDP):
 *        browser.run_test { "sessionName": "rebrowser", "grep": "rebrowser-check" }
 *
 *   Expected score via MCP: 8/10. Permanent failures:
 *     - mainWorldExecution: needs rebrowser-patches alwaysIsolated mode (conflicts with dummyFn)
 *     - exposeFunctionLeak: page.exposeFunction is unfixable, no patch exists
 *
 * ── Run via Playwright CLI (standalone) ──────────────────────────────────────
 *
 *   SZKRABOK_SESSION=rebrowser \
 *     npx playwright test --project=automation --grep "rebrowser-check"
 *
 *   Expected score standalone: 7/10. The useragent check additionally fails because
 *   applyStealthToExistingPage (which injects the userAgentData.brands JS override)
 *   is only called by wrapper.js after launchPersistentContext — it does not run
 *   in the standalone browser.launch() path. The user-agent-override stealth plugin
 *   spoofs navigator.userAgent (old string API) but not userAgentData.brands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from './fixtures.js';

const BASE_URL = 'https://bot-detector.rebrowser.net/';

// Checks that must pass (green). Keys match the test names on the page.
// dummyFn / sourceUrlLeak / mainWorldExecution stay grey until triggered below.
const EXPECTED_PASS = [
  'dummyFn',
  'sourceUrlLeak',
  'mainWorldExecution',
  'runtimeEnableLeak',
  'exposeFunctionLeak',
  'navigatorWebdriver',
  'viewport',
  'pwInitScripts',
  'bypassCsp',
  'useragent',
];

// Permanent failures — unfixable without rebrowser-patches or browser changes.
// Tracked here so regressions in currently-passing checks are caught.
const KNOWN_FAILURES = new Set([
  'mainWorldExecution', // needs rebrowser-patches alwaysIsolated mode (conflicts with dummyFn)
  'exposeFunctionLeak', // page.exposeFunction is unfixable, no patch exists
]);

test('rebrowser-check', async ({ page }, testInfo) => {
  // Expose the function before navigation so it's present when the page loads
  console.log('step 1. expose function for exposeFunctionLeak test');
  await page.exposeFunction('exposedFn', () => {
    console.log('exposedFn call');
  });

  console.log('step 2. navigate to', BASE_URL);
  await page.goto(BASE_URL);

  console.log('step 3. trigger required checks');
  // dummyFn — call main-world object
  await page.evaluate(() => window.dummyFn());
  // sourceUrlLeak — getElementById call that leaks sourceURL
  await page.evaluate(() => document.getElementById('detections-json'));
  // mainWorldExecution — getElementsByClassName in main world
  await page.evaluate(() => document.getElementsByClassName('div'));

  console.log('step 4. wait for results to settle');
  await page.waitForTimeout(3000);

  console.log('step 5. read detections JSON from page');
  const detectionsJson = await page.evaluate(() => {
    const el = document.getElementById('detections-json');
    return el ? el.textContent : null;
  });

  let detections = null;
  if (detectionsJson) {
    try {
      detections = JSON.parse(detectionsJson);
    } catch {}
  }

  if (detections) {
    console.log('detections JSON:', JSON.stringify(detections, null, 2));
  } else {
    console.log('detections JSON not available, falling back to DOM scrape');
  }

  console.log('step 6. collect check results from DOM');
  const results = await page.evaluate(checks => {
    // Each check row has a data-test-id or similar; fall back to text matching.
    // The page renders rows with the test name and an emoji/color indicator.
    // We look for elements that contain the check name and determine pass/fail
    // from the presence of green (🟢) vs other indicators in the row.
    const rows = [];
    document
      .querySelectorAll('tr, [class*="test"], [class*="row"], [class*="detection"]')
      .forEach(el => {
        const text = el.textContent ?? '';
        for (const name of checks) {
          if (text.includes(name)) {
            // Green circle emoji or "passed"/"safe" text = pass
            const passed =
              text.includes('🟢') ||
              text.includes('passed') ||
              text.includes('No leak') ||
              text.includes('No webdriver') ||
              text.includes('No window.__pw');
            const failed =
              text.includes('🔴') || text.includes('failed') || text.includes('Leak detected');
            rows.push({ name, passed, failed, snippet: text.replace(/\s+/g, ' ').slice(0, 120) });
            break;
          }
        }
      });
    return rows;
  }, EXPECTED_PASS);

  // Deduplicate by name (keep first match)
  const seen = new Set();
  const deduped = results.filter(r => (seen.has(r.name) ? false : (seen.add(r.name), true)));

  console.log(`step 7. results (${deduped.filter(r => r.passed).length}/${deduped.length} passed)`);
  for (const r of deduped) {
    const status = r.failed ? 'FAIL' : r.passed ? 'pass' : 'unknown';
    console.log(`  [${status}] ${r.name}: ${r.snippet}`);
  }

  // ── attach result ─────────────────────────────────────────────────────────
  const result = {
    checks: deduped,
    detections,
    passed: deduped.filter(r => r.passed).length,
    failed: deduped.filter(r => r.failed).length,
    unknown: deduped.filter(r => !r.passed && !r.failed).length,
  };
  await testInfo.attach('result', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });

  // ── assertions ────────────────────────────────────────────────────────────
  const unexpectedFailures = deduped.filter(r => r.failed && !KNOWN_FAILURES.has(r.name));
  expect(unexpectedFailures.map(r => r.name), 'unexpected rebrowser failures').toHaveLength(0);

  const passed = deduped.filter(r => r.passed).length;
  expect(passed, 'expected 8/10 rebrowser checks to pass').toBe(EXPECTED_PASS.length - KNOWN_FAILURES.size);

  console.log('step 8. done');
});
