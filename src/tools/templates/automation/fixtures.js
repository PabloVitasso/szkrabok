/**
 * Szkrabok automation fixtures.
 *
 * Path A — MCP mode (browser_run_test): connects to the live session via CDP.
 * Path B — Standalone mode (npx playwright test): launches a stealth browser.
 *
 * To add project-specific fixtures, extend instead of re-exporting:
 *   import { test as szkrabokTest, expect } from '@pablovitasso/szkrabok/fixtures';
 *   export { expect };
 *   export const test = szkrabokTest.extend({ runtime: [...], ... });
 */
export { test, expect } from '@pablovitasso/szkrabok/fixtures';
