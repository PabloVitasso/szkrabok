/*
 * navigator-properties — external site view of navigator properties
 *
 * Navigates to whatismybrowser.com's navigator properties page and reads
 * every property the site detects and displays. Useful as a complement to
 * rebrowser-check: this shows what a real external site sees when it reads
 * navigator properties from the main world, including userAgentData.brands.
 *
 * ── Run via MCP ───────────────────────────────────────────────────────────────
 *
 *   1. session.open { "sessionName": "nav-props" }
 *   2. browser.run_test { "sessionName": "nav-props", "grep": "navigator-properties" }
 *
 * ── Run via Playwright CLI ────────────────────────────────────────────────────
 *
 *   SZKRABOK_SESSION=nav-props \
 *     npx playwright test automation/navigator-properties.spec.js
 *
 * ── Reading results ───────────────────────────────────────────────────────────
 *
 *   The test prints a JSON report of all properties the page detected, plus
 *   direct JS evaluations of userAgentData.brands and getHighEntropyValues.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test } from './fixtures.js';

const URL = 'https://www.whatismybrowser.com/detect/what-are-my-browsers-navigator-properties/';

test('navigator-properties', async ({ page }, testInfo) => {
  console.log('step 1. navigate to whatismybrowser navigator properties page');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // Page renders properties as <span class="key">name</span>: <span class="value">val</span>
  await page.waitForSelector('span.key', { timeout: 15000 });

  console.log('step 2. scrape displayed property rows');
  const displayed = await page.evaluate(() => {
    const result = {};
    // Each property is rendered as:
    //   <span class="key">name</span>: <span class="value">val</span>
    // Both spans are direct children of the same container div, separated by
    // a text node ": ". Walk siblings to find the matching value span.
    document.querySelectorAll('span.key').forEach(keyEl => {
      let node = keyEl.nextSibling;
      while (node) {
        if (node.nodeType === 1 && node.classList.contains('value')) {
          result[keyEl.textContent.trim()] = node.textContent.trim();
          break;
        }
        // Stop if we hit another key (next property)
        if (node.nodeType === 1 && node.classList.contains('key')) break;
        node = node.nextSibling;
      }
    });
    return result;
  });

  console.log('step 3. evaluate navigator.userAgentData.brands directly');
  const brands = await page.evaluate(() => {
    try {
      return JSON.parse(JSON.stringify(navigator.userAgentData?.brands ?? null));
    } catch {
      return null;
    }
  });

  console.log('step 4. evaluate userAgentData high-entropy values');
  const highEntropy = await page.evaluate(async () => {
    try {
      return await navigator.userAgentData?.getHighEntropyValues([
        'brands',
        'mobile',
        'platform',
        'platformVersion',
        'architecture',
        'bitness',
        'model',
        'uaFullVersion',
        'fullVersionList',
      ]);
    } catch (e) {
      return { error: e.message };
    }
  });

  const report = {
    displayed,
    'userAgentData.brands (evaluated)': brands,
    'userAgentData.getHighEntropyValues (evaluated)': highEntropy,
  };

  console.log('step 5. report:');
  console.log(JSON.stringify(report, null, 2));

  await testInfo.attach('navigator-properties', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });

  console.log('step 6. done');
});
