/**
 * Custom fixtures for szkrabok test suite.
 *
 * Path A — MCP / CDP mode (SZKRABOK_CDP_ENDPOINT set):
 *   Connects to the live MCP session browser via runtime.connect().
 *
 * Path B — Dev mode (VSCode, standalone):
 *   Launches a new stealth browser via runtime.launch().
 *
 * No direct stealth imports. No direct browser launch. No config parsing.
 */
import { test as base } from 'playwright/test';
import { launch, connect } from '@szkrabok/runtime';

export { expect } from 'playwright/test';

const cdpEndpoint = process.env.SZKRABOK_CDP_ENDPOINT || '';

export const test = base.extend({
  // Worker-scoped: one browser connection per worker, reused across tests.
  _runtimeHandle: [
    async ({}, use) => {
      if (cdpEndpoint) {
        // Path A: connect to running MCP session
        const handle = await connect(cdpEndpoint);
        await use(handle);
        // Do NOT close — MCP session owns this browser.
      } else {
        // Path B: launch standalone with full stealth + persistence
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
    // Do NOT close — handle lifecycle manages it
  },

  page: async ({ _runtimeHandle }, use) => {
    const ctx = _runtimeHandle.context;
    const pages = ctx.pages();
    const pg = pages[0] ?? (await ctx.newPage());
    await use(pg);
    // Do NOT close — MCP session or handle lifecycle manages it
  },
});
