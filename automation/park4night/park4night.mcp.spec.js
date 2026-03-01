/**
 * park4night MCP harness
 *
 * Runs park4night tests via the MCP client library.
 * Owns the full session lifecycle — open, run_test, close — in one spec.
 *
 * The `search by gps` test accepts coords via TEST_COORDS (passed through
 * browser.run_test params). The MCP harness always supplies coords explicitly
 * so the built-in defaults in park4night.spec.js are never used from here.
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *
 *   npm run test:clientmcp
 *   npx playwright test --project=client
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from 'playwright/test';
import { mcpConnect } from '../../mcp-client/mcp-tools.js';

/**
 * @typedef {{ lat: number, lng: number, z: number, label: string }} Coord
 */

const SESSION = 'park4night-mcp-harness2';

/**
 * Open an MCP session, run fn(mcp), then close the session regardless of outcome.
 * @param {(mcp: any) => Promise<void>} fn
 * @returns {Promise<void>}
 */
async function withMcp(fn) {
  const mcp = await mcpConnect(SESSION, undefined, { launchOptions: { headless: false } });
  try {
    await fn(mcp);
  } finally {
    await mcp.close();
  }
}

/**
 * Coords supplied by the MCP harness for the search test.
 * To test different regions, change this array — the spec file stays untouched.
 * @type {Coord[]}
 */
const HARNESS_COORDS = [
  { lat: 53.380051797385555, lng: 24.4610595703125, z: 9, label: 'Poland East' },
];

/**
 * MCP harness for the 'accept cookies and login' spec.
 * Opens a session, delegates to the spec via browser.run_test, then closes.
 * Asserts that the cookie banner was handled and the user is logged in.
 */
test('accept cookies and login via MCP', async () => {
  await withMcp(async mcp => {
    const result = await mcp.browser.run_test({
      grep: 'accept cookies and login',
      files: ['automation/park4night/park4night.spec.js'],
    });

    const test0 = result.tests[0];
    if (!test0) throw new Error(`no tests in result — inner run may have failed to start. log:\n${result.log?.slice(-10).join('\n')}`);
    const parsedResult = test0.result;
    if (!parsedResult) throw new Error(`no result attachment — inner test may have failed before attachResult. status=${test0.status} error=${test0.error}`);
    console.log('accept cookies and login result:', JSON.stringify(parsedResult));

    const { cookieResult, isLogged } = parsedResult;

    expect(['clicked', 'skipped'], `unexpected cookie action: ${JSON.stringify(cookieResult)}`).toContain(cookieResult.action);
    if (cookieResult.action === 'clicked') {
      expect(cookieResult.dismissed, 'banner click did not dismiss').toBe(true);
    } else {
      expect(cookieResult.reason, 'unexpected skip reason').toBe('banner_not_present');
    }

    expect(isLogged, 'login failed — check credentials in szkrabok.config.local.toml').toBe(true);
  });
});

/**
 * MCP harness for the 'search by gps' spec.
 * Passes HARNESS_COORDS to the spec via TEST_COORDS (browser.run_test params).
 * Asserts that each coord produced a captured response and a dump file.
 *
 * To vary coords from outside, modify HARNESS_COORDS in this file — the spec
 * itself is not touched.
 */
test('search by gps via MCP', async () => {
  await withMcp(async mcp => {
    const result = await mcp.browser.run_test({
      grep: 'search by gps',
      files: ['automation/park4night/park4night.spec.js'],
      params: { coords: JSON.stringify(HARNESS_COORDS) },
    });

    const test0 = result.tests[0];
    if (!test0) throw new Error(`no tests in result — inner run may have failed to start. log:\n${result.log?.slice(-10).join('\n')}`);
    const parsedResult = test0.result;
    if (!parsedResult) throw new Error(`no result attachment — inner test may have failed before attachResult. status=${test0.status} error=${test0.error}`);
    console.log('search by gps result:', JSON.stringify(parsedResult));

    expect(parsedResult.isLogged, 'login failed — check credentials in szkrabok.config.local.toml').toBe(true);

    /** @type {{ label: string, dumpPath: string }[]} */
    const results = parsedResult.results;
    expect(results, `expected ${HARNESS_COORDS.length} coord results, got: ${JSON.stringify(results)}`).toHaveLength(HARNESS_COORDS.length);
    results.forEach(r => {
      expect(r.dumpPath, `missing dumpPath for "${r.label}"`).toBeTruthy();
      console.log(`search by gps: "${r.label}" -> ${r.dumpPath}`);
    });
  });
});
