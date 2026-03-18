/**
 * Custom Playwright fixtures for szkrabok automation.
 *
 * Path A — MCP / CDP mode (SZKRABOK_CDP_ENDPOINT set by browser.run_test):
 *   Connects to the live MCP session browser via runtime.connect().
 *   Use when running specs via: browser.run_test { "sessionName": "..." }
 *
 * Path B — Standalone / dev mode (no env var):
 *   Launches a new stealth browser via runtime.launch().
 *   Use when running specs directly: npx playwright test
 *
 * No direct stealth imports. No direct browser launch. No config parsing.
 */
import { test as base } from '@playwright/test';
import { initConfig, launch, connect } from '@pablovitasso/szkrabok/runtime';

export { expect } from '@playwright/test';

const cdpEndpoint = process.env.SZKRABOK_CDP_ENDPOINT || '';

export const test = base.extend({
  // Worker-scoped: one browser connection per worker, reused across tests.
  _runtimeHandle: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixture API requires destructuring even when no fixtures are used
async ({}, use) => {
      initConfig();
      if (cdpEndpoint) {
        // Path A: connect to the MCP session browser via CDP
        const handle = await connect(cdpEndpoint);
        await use(handle);
        // Do NOT close — the MCP session owns this browser.
      } else {
        // Path B: launch standalone with stealth + persistent profile
        const handle = await launch({ profile: 'dev', reuse: true });
        await use(handle);
        await handle.close();
      }
    },
    { scope: 'worker' },
  ],

  browser: [
    async ({ _runtimeHandle }, use) => {
      await use(_runtimeHandle.browser);
    },
    { scope: 'worker' },
  ],

  context: async ({ _runtimeHandle }, use) => {
    await use(_runtimeHandle.context);
    // Do NOT close — handle lifecycle manages it.
  },

  page: async ({ _runtimeHandle }, use) => {
    const ctx = _runtimeHandle.context;
    const pages = ctx.pages();
    const pg = pages[0] ?? (await ctx.newPage());
    await use(pg);
    // Do NOT close — MCP session or handle lifecycle manages it.
  },
});
