/*
 * rebrowser-check MCP harness
 *
 * Runs the rebrowser bot-detection test via the MCP client library.
 * Owns the full session lifecycle — open, run_test, close — in one spec.
 *
 * This is the recommended way to run rebrowser-check because:
 *   - Session is opened via launchPersistentContext, which triggers
 *     applyStealthToExistingPage — including the userAgentData.brands JS override.
 *   - That gives 8/10 (useragent passes). Standalone Playwright mode gives 7/10
 *     because applyStealthToExistingPage never runs in browser.launch() path.
 *
 * Expected result: 8/10. Two permanent failures:
 *   - mainWorldExecution — needs rebrowser-patches alwaysIsolated (conflicts dummyFn)
 *   - exposeFunctionLeak — page.exposeFunction is unfixable, no patch exists
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *
 *   npm run test:clientmcp
 *   npx playwright test --project=client
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from 'playwright/test';
import { mcpConnect } from '@szkrabok/mcp-client';

const SESSION = 'rebrowser-mcp-harness';

// Checks that are permanent failures — excluded from assertion.
// Tracked here so regressions in currently-passing checks are caught.
const KNOWN_FAILURES = new Set([
  'mainWorldExecution', // needs rebrowser-patches alwaysIsolated mode
  'exposeFunctionLeak', // page.exposeFunction is unfixable
]);

test('rebrowser-check via MCP — 8/10', async () => {
  const mcp = await mcpConnect(SESSION, undefined, { launchOptions: { headless: true } });
  try {
    // invoker already unwraps and JSON-parses the MCP text content
    const result = await mcp.browser.run_test({ files: ['automation/rebrowser-check.spec.js'] });

    // browser.run_test returns { passed, failed, tests: [{ result: { checks } }] }
    const checks = result?.tests?.[0]?.result?.checks;
    expect(Array.isArray(checks), `expected checks array, got: ${JSON.stringify(result)}`).toBe(
      true
    );

    const unexpectedFailures = checks.filter(c => c.failed && !KNOWN_FAILURES.has(c.name));

    const passed = checks.filter(c => c.passed).length;
    console.log(`rebrowser score: ${passed}/${checks.length}`);
    for (const c of checks) {
      const status = c.passed ? 'pass' : KNOWN_FAILURES.has(c.name) ? 'known-fail' : 'FAIL';
      console.log(`  [${status}] ${c.name}`);
    }

    expect(
      unexpectedFailures.map(c => c.name),
      'unexpected rebrowser failures'
    ).toHaveLength(0);

    expect(passed).toBe(checks.length - KNOWN_FAILURES.size);
  } finally {
    await mcp.close();
  }
});
