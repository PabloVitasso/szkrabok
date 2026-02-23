/*
 * stealthcheck — bot-detection fingerprint test (bot.sannysoft.com)
 *
 * Covers two tables on the page:
 *
 *   1. Intoli.com tests — each row has a result td that gets class "passed",
 *      "failed", or "warn". Named checks asserted individually:
 *        User Agent, WebDriver, WebDriver Advanced, Chrome, Permissions,
 *        Plugins Length, Plugins is of type PluginArray, Languages,
 *        WebGL Vendor, WebGL Renderer, Broken Image Dimensions
 *
 *   2. Fingerprint Scanner (fp-collect) — each row: | name | status | json |
 *      The middle status td gets class "passed" when value is "ok".
 *      Checks: PHANTOM_UA, PHANTOM_PROPERTIES, PHANTOM_ETSL, PHANTOM_LANGUAGE,
 *        PHANTOM_WEBSOCKET, MQ_SCREEN, PHANTOM_OVERFLOW, PHANTOM_WINDOW_HEIGHT,
 *        HEADCHR_UA, HEADCHR_CHROME_OBJ, HEADCHR_PERMISSIONS, HEADCHR_PLUGINS,
 *        HEADCHR_IFRAME, CHR_DEBUG_TOOLS, SELENIUM_DRIVER, CHR_BATTERY,
 *        CHR_MEMORY, TRANSPARENT_PIXEL, SEQUENTUM, VIDEO_CODECS
 *
 *   Iframes: 5 iframes (canvas3/4/5-iframe + 2 srcdoc) are about:blank /
 *   about:srcdoc used only for canvas fingerprint rendering — they contain
 *   no bot-detection tds and are not checked here.
 *
 * ── Run via MCP ──────────────────────────────────────────────────────────────
 *
 *   1. Open a session (launches Chrome with a persistent profile + CDP port):
 *        session.open { "id": "intoli" }
 *
 *   2. Run the test (connects to that Chrome via CDP):
 *        browser.run_test { "id": "intoli", "grep": "intoli-check" }
 *
 *   Expected result on a clean stealth session:
 *     { "intoli": { passed: 11, failed: 0, warned: 0 },
 *       "fpCollect": { passed: 20, failed: 0 } }
 *
 * ── Run via Playwright CLI ───────────────────────────────────────────────────
 *
 *   SZKRABOK_SESSION=intoli \
 *     npx playwright test --config playwright-tests/playwright.config.ts \
 *     --grep "intoli-check"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from './fixtures.js';

const BASE_URL = 'https://bot.sannysoft.com/';

// Intoli table: the result td is the last td in each row and carries
// class "result passed" | "result failed" | "result warn"
// WebGL Renderer is excluded: it reports the hardware GPU string (SwiftShader on
// machines without a GPU), which stealth cannot spoof — it's a hardware limit, not
// a detection evasion issue. WebGL Vendor covers the GL identity check.
const INTOLI_CHECKS = [
  'User Agent',
  'WebDriver',
  'WebDriver Advanced',
  'Chrome',
  'Permissions',
  'Plugins Length',
  'Plugins is of type PluginArray',
  'Languages',
  'WebGL Vendor',
  'Broken Image Dimensions',
];

// fp-collect table: the status td is the 2nd td in each row and carries
// class "passed" when value is "ok", "failed" otherwise
const FP_CHECKS = [
  'PHANTOM_UA',
  'PHANTOM_PROPERTIES',
  'PHANTOM_ETSL',
  'PHANTOM_LANGUAGE',
  'PHANTOM_WEBSOCKET',
  'MQ_SCREEN',
  'PHANTOM_OVERFLOW',
  'PHANTOM_WINDOW_HEIGHT',
  'HEADCHR_UA',
  'HEADCHR_CHROME_OBJ',
  'HEADCHR_PERMISSIONS',
  'HEADCHR_PLUGINS',
  'HEADCHR_IFRAME',
  'CHR_DEBUG_TOOLS',
  'SELENIUM_DRIVER',
  'CHR_BATTERY',
  'CHR_MEMORY',
  'TRANSPARENT_PIXEL',
  'SEQUENTUM',
  'VIDEO_CODECS',
];

test('intoli-check', async ({ page }, testInfo) => {
  console.log('step 1. navigate to', BASE_URL);
  await page.goto(BASE_URL);

  console.log('step 2. wait for results tables to settle');
  await page.waitForSelector('td.passed, td.failed, td.warn', { timeout: 30000 });
  await page.waitForTimeout(2000);

  // ── Intoli table ────────────────────────────────────────────────────────
  console.log('step 3. collect Intoli check results');
  const intoliResults = await page.evaluate(checks => {
    const results = [];
    document.querySelectorAll('tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) return;
      const name = tds[0].textContent?.trim() ?? '';
      if (!checks.some(c => name.startsWith(c))) return;
      const r = tds[tds.length - 1];
      results.push({ name, cls: r.className.trim(), value: r.textContent?.trim() ?? '' });
    });
    return results;
  }, INTOLI_CHECKS);

  const intoliFailures = intoliResults.filter(r => r.cls.includes('failed'));
  const intoliWarnings = intoliResults.filter(r => r.cls.includes('warn'));
  const intoliPassed = intoliResults.filter(r => r.cls.includes('passed'));

  console.log(`step 4. Intoli (${intoliPassed.length}/${intoliResults.length} passed)`);
  for (const r of intoliResults) {
    const status = r.cls.includes('failed') ? 'FAIL' : r.cls.includes('warn') ? 'WARN' : 'pass';
    console.log(`  [${status}] ${r.name}: ${r.value.replace(/\s+/g, ' ').slice(0, 80)}`);
  }

  // ── fp-collect table ─────────────────────────────────────────────────────
  console.log('step 5. collect fp-collect check results (status = 2nd td, class "passed" when ok)');
  const fpResults = await page.evaluate(checks => {
    const results = [];
    document.querySelectorAll('tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) return;
      const name = tds[0].textContent?.trim() ?? '';
      if (!checks.includes(name)) return;
      // status is the 2nd td (index 1)
      const statusTd = tds[1];
      results.push({
        name,
        cls: statusTd.className.trim(),
        value: statusTd.textContent?.trim() ?? '',
      });
    });
    return results;
  }, FP_CHECKS);

  const fpFailures = fpResults.filter(r => !r.cls.includes('passed'));
  const fpPassed = fpResults.filter(r => r.cls.includes('passed'));

  console.log(`step 6. fp-collect (${fpPassed.length}/${fpResults.length} passed)`);
  for (const r of fpResults) {
    const status = r.cls.includes('passed') ? 'pass' : 'FAIL';
    console.log(`  [${status}] ${r.name}: ${r.value}`);
  }

  // ── attach result ─────────────────────────────────────────────────────────
  const result = {
    intoli: {
      passed: intoliPassed.length,
      failed: intoliFailures.length,
      warned: intoliWarnings.length,
      failures: intoliFailures,
    },
    fpCollect: { passed: fpPassed.length, failed: fpFailures.length, failures: fpFailures },
  };
  await testInfo.attach('result', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });

  // ── assertions ────────────────────────────────────────────────────────────
  expect(intoliPassed.length, 'expected all Intoli checks to pass').toBe(INTOLI_CHECKS.length);
  expect(intoliFailures, 'expected no Intoli td.failed').toHaveLength(0);
  expect(intoliWarnings, 'expected no Intoli td.warn').toHaveLength(0);
  expect(fpPassed.length, 'expected all fp-collect checks to pass').toBe(FP_CHECKS.length);
  expect(fpFailures, 'expected no fp-collect failures').toHaveLength(0);

  console.log('step 7. done — all intoli checks clean');
});
