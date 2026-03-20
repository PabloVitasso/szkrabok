/**
 * example.spec.js — direct CDP spec
 *
 * Runs inside the MCP session browser via browser_run_test.
 * Also runnable standalone via: npx playwright test
 *
 * ── Run via MCP (Claude Code) ────────────────────────────────────────────────
 *
 *   1. Open a session:
 *        session.open { "sessionName": "my-session" }
 *
 *   2. Run this spec:
 *        browser_run_test {
 *          "sessionName": "my-session",
 *          "files": ["automation/example.spec.js"]
 *        }
 *
 * ── Run standalone ───────────────────────────────────────────────────────────
 *
 *   npx playwright test automation/example.spec.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, expect } from './fixtures.js';

test('example page title', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example Domain/);
});
