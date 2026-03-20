/**
 * example.mcp.spec.js — MCP harness spec
 *
 * Drives example.spec.js through the szkrabok MCP server.
 * Owns the full session lifecycle: open → run_test → close.
 *
 * Use this pattern when you want an outer Playwright spec to orchestrate
 * inner specs via MCP — useful for CI pipelines, multi-step flows, or
 * asserting on structured result attachments returned by inner tests.
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *
 *   npx playwright test automation/example.mcp.spec.js
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 *   mcpConnect(sessionName, options?)
 *     Opens a szkrabok MCP session and returns a typed handle.
 *     All MCP tools are available as: mcp.session.*, mcp.browser.*, etc.
 *
 *   mcp.browser_run_test({ files, grep?, params? })
 *     Runs inner Playwright specs against the open session via CDP.
 *     Returns { passed, failed, tests: [{ title, status, result }] }.
 *     `result` is the value passed to attachResult() in the inner spec.
 *
 *   mcp.close()
 *     Closes the MCP session (saves cookies + localStorage to profile).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, expect } from '@playwright/test';
import { mcpConnect } from '@pablovitasso/szkrabok/runtime';

const SESSION = 'example-mcp-harness';

async function withMcp(fn) {
  const mcp = await mcpConnect(SESSION, { launchOptions: { headless: false } });
  try {
    await fn(mcp);
  } finally {
    await mcp.close();
  }
}

test('example via MCP', async () => {
  await withMcp(async mcp => {
    const result = await mcp.browser_run_test({
      files: ['automation/example.spec.js'],
    });

    expect(result.failed, `inner spec failed:\n${result.log?.slice(-5).join('\n')}`).toBe(0);
    expect(result.passed).toBeGreaterThan(0);
  });
});
