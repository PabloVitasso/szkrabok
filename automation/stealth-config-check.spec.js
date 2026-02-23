/*
 * stealth-config-check — puppeteer-extra-plugin-stealth evasion verification
 *
 * Collects the actual browser-reported value for every property affected by
 * each stealth evasion and prints them as a JSON report. No fixed assertions —
 * use this to verify that your szkrabok.config.toml settings are reaching the
 * browser as expected.
 *
 * Compare the JSON output against your active TOML config to confirm each
 * evasion is working correctly.
 *
 * ── Run via MCP — default config (chromium-honest, no UA spoof) ──────────────
 *
 *   1. session.open { "id": "stealth-test" }
 *   2. browser.run_test { "id": "stealth-test", "grep": "stealth-config-check" }
 *
 * ── Run via MCP — specific preset ────────────────────────────────────────────
 *
 *   1. session.open { "id": "stealth-test", "config": { "preset": "desktop-chrome-win" } }
 *   2. browser.run_test { "id": "stealth-test", "grep": "stealth-config-check" }
 *
 * ── Run via MCP — stealth disabled (baseline headless Chromium) ───────────────
 *
 *   1. session.open { "id": "stealth-off", "config": { "stealth": false } }
 *   2. browser.run_test { "id": "stealth-off", "grep": "stealth-config-check" }
 *
 * ── Run via MCP — custom userAgent ───────────────────────────────────────────
 *
 *   1. session.open {
 *        "id": "stealth-custom",
 *        "config": {
 *          "userAgent": "Mozilla/5.0 (Macintosh; ...) Chrome/120.0.0.0 Safari/537.36",
 *          "locale": "fr-FR"
 *        }
 *      }
 *   2. browser.run_test { "id": "stealth-custom", "grep": "stealth-config-check" }
 *
 * ── Run via Playwright CLI ───────────────────────────────────────────────────
 *
 *   SZKRABOK_SESSION=stealth-test \
 *     npx playwright test automation/stealth-config-check.spec.js
 *
 * ── Reading results ──────────────────────────────────────────────────────────
 *
 *   The test prints a JSON report to stdout with one section per evasion:
 *
 *   {
 *     "user-agent-override": {
 *       "navigator.userAgent": "...",
 *       "navigator.platform": "...",
 *       "navigator.userAgentData.platform": "...",
 *       "navigator.userAgentData.brands": [...],
 *       "navigator.userAgentData.mobile": false
 *     },
 *     "navigator.vendor": { "navigator.vendor": "Google Inc." },
 *     "navigator.hardwareConcurrency": { "navigator.hardwareConcurrency": 4 },
 *     "navigator.languages": { "navigator.languages": ["en-US", "en"] },
 *     "navigator.webdriver": { "navigator.webdriver": false },
 *     "navigator.plugins": { "navigator.plugins.length": 5 },
 *     "webgl.vendor": { "webgl.vendor": "Intel Inc.", "webgl.renderer": "Intel Iris OpenGL Engine" },
 *     "window.outerdimensions": { "window.outerWidth": 1280, "window.outerHeight": 800 },
 *     "chrome.runtime": { "chrome.app": true, "chrome.runtime": true, "chrome.csi": true, "chrome.loadTimes": true },
 *     "Accept-Language header": "en-US,en;q=0.9"
 *   }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test } from './fixtures.js';

test('stealth-config-check', async ({ page }, testInfo) => {
  // Navigate to a neutral page that echoes request headers so we can read
  // Accept-Language. httpbin is reliable and returns JSON.
  console.log('step 1. navigate to httpbin for header inspection');
  const headerResponse = await page.goto('https://httpbin.org/headers');
  let acceptLanguage = null;
  try {
    const body = await page.evaluate(() => JSON.parse(document.body.innerText));
    acceptLanguage = body?.headers?.['Accept-Language'] ?? null;
  } catch {
    acceptLanguage = '(could not read — httpbin unavailable)';
  }

  // Navigate to a blank page for the rest of the checks — avoids any
  // site-specific overrides interfering with navigator properties.
  console.log('step 2. navigate to blank page for navigator property checks');
  await page.goto('about:blank');

  console.log('step 3. collect all stealth-evasion-affected browser properties');
  const browserProps = await page.evaluate(() => {
    // WebGL vendor / renderer
    let webglVendor = null;
    let webglRenderer = null;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbgInfo) {
          webglVendor = gl.getParameter(dbgInfo.UNMASKED_VENDOR_WEBGL);
          webglRenderer = gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch {}

    // navigator.userAgentData (only available in Chromium)
    let uaData = null;
    try {
      if (navigator.userAgentData) {
        uaData = {
          platform: navigator.userAgentData.platform,
          mobile: navigator.userAgentData.mobile,
          brands: navigator.userAgentData.brands,
        };
      }
    } catch {}

    // chrome object checks
    const chromeObj = {
      'chrome exists': typeof window.chrome !== 'undefined',
      'chrome.app': typeof window.chrome?.app !== 'undefined',
      'chrome.csi': typeof window.chrome?.csi === 'function',
      'chrome.loadTimes': typeof window.chrome?.loadTimes === 'function',
      'chrome.runtime': typeof window.chrome?.runtime !== 'undefined',
    };

    return {
      'navigator.userAgent': navigator.userAgent,
      'navigator.platform': navigator.platform,
      'navigator.vendor': navigator.vendor,
      'navigator.hardwareConcurrency': navigator.hardwareConcurrency,
      'navigator.languages': Array.from(navigator.languages),
      'navigator.webdriver': navigator.webdriver,
      'navigator.plugins.length': navigator.plugins.length,
      'navigator.userAgentData': uaData,
      'window.outerWidth': window.outerWidth,
      'window.outerHeight': window.outerHeight,
      'webgl.vendor': webglVendor,
      'webgl.renderer': webglRenderer,
      chrome: chromeObj,
    };
  });

  // ── Build evasion-grouped report ──────────────────────────────────────────
  // Grouped by evasion name so output maps directly to TOML config sections.

  const report = {
    // puppeteer-extra-plugin-stealth."user-agent-override"
    'user-agent-override': {
      'navigator.userAgent': browserProps['navigator.userAgent'],
      'navigator.platform': browserProps['navigator.platform'],
      'navigator.userAgentData': browserProps['navigator.userAgentData'],
    },

    // puppeteer-extra-plugin-stealth."navigator.vendor"
    'navigator.vendor': {
      'navigator.vendor': browserProps['navigator.vendor'],
    },

    // puppeteer-extra-plugin-stealth."navigator.hardwareConcurrency"
    'navigator.hardwareConcurrency': {
      'navigator.hardwareConcurrency': browserProps['navigator.hardwareConcurrency'],
    },

    // puppeteer-extra-plugin-stealth."navigator.languages"
    'navigator.languages': {
      'navigator.languages': browserProps['navigator.languages'],
      'Accept-Language header': acceptLanguage,
    },

    // puppeteer-extra-plugin-stealth."navigator.webdriver"
    'navigator.webdriver': {
      'navigator.webdriver': browserProps['navigator.webdriver'],
    },

    // puppeteer-extra-plugin-stealth."navigator.plugins"
    'navigator.plugins': {
      'navigator.plugins.length': browserProps['navigator.plugins.length'],
    },

    // puppeteer-extra-plugin-stealth."webgl.vendor"
    'webgl.vendor': {
      'webgl.vendor': browserProps['webgl.vendor'],
      'webgl.renderer': browserProps['webgl.renderer'],
    },

    // puppeteer-extra-plugin-stealth."window.outerdimensions"
    'window.outerdimensions': {
      'window.outerWidth': browserProps['window.outerWidth'],
      'window.outerHeight': browserProps['window.outerHeight'],
    },

    // puppeteer-extra-plugin-stealth."chrome.*" evasions
    'chrome-apis': browserProps['chrome'],
  };

  // ── Print report ──────────────────────────────────────────────────────────
  console.log('step 4. stealth evasion report:');
  console.log(JSON.stringify(report, null, 2));

  // Attach as a test artifact for browser.run_test JSON output
  await testInfo.attach('stealth-config-check', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });

  console.log('step 5. done — compare report against szkrabok.config.toml settings');
});
