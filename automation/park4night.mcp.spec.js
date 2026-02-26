/*
 * park4night MCP harness
 *
 * Runs the park4night cookie banner test via the MCP client library.
 * Owns the full session lifecycle — open, run_test, close — in one spec.
 *
 * Expected result:
 *   - NEW session: { "action": "clicked", "dismissed": true }
 *   - REUSED session: { "action": "skipped", "reason": "banner_not_present" }
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *
 *   npm run test:clientmcp
 *   npx playwright test --project=client
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from 'playwright/test';
import { mcpConnect } from '../mcp-client/mcp-tools.js';

const SESSION = 'park4night-mcp-harness';

test('park4night cookie banner via MCP', async () => {
  const mcp = await mcpConnect(SESSION, undefined, { launchOptions: { headless: false } });
  try {
    // invoker already unwraps and JSON-parses the MCP text content
    const result = await mcp.browser.run_test({ files: ['automation/park4night.spec.js'] });

    // browser.run_test returns { passed, failed, tests: [{ result }] }
    // The result object contains the parsed JSON from console output
    const parsedResult = result?.tests?.[0]?.result;

    console.log('park4night result:', JSON.stringify(parsedResult));

    // Verify the result is valid
    expect(parsedResult, `expected valid result, got: ${JSON.stringify(result)}`).toBeDefined();

    // Check expected actions: 'clicked' (new session) or 'skipped' (reused session)
    const validActions = ['clicked', 'skipped'];
    expect(validActions).toContain(parsedResult.action);

    if (parsedResult.action === 'clicked') {
      expect(parsedResult.dismissed, 'banner should be dismissed after clicking').toBe(true);
    } else if (parsedResult.action === 'skipped') {
      expect(parsedResult.reason).toBe('banner_not_present');
    }
  } finally {
    await mcp.close();
  }
});
