/**
 * Custom fixtures for szkrabok test suite.
 *
 * Path A — MCP / CDP mode (SZKRABOK_CDP_ENDPOINT set):
 *   Connects to the live MCP session browser via plain CDP — no runtime import needed.
 *   Stealth is already applied at session launch time (session_manage open).
 *
 * Path B — Dev mode (VSCode, standalone):
 *   Launches a new stealth browser via runtime.launch().
 *
 * No static runtime import — MCP path has zero runtime dependency.
 */
import { test as base, chromium } from 'playwright/test';
import { writeFile } from 'fs/promises';

export { expect } from 'playwright/test';

const cdpEndpoint = process.env.SZKRABOK_CDP_ENDPOINT || '';

// Memoized per worker — avoids repeated dynamic import evaluation across tests.
let _runtimeP;
const getRuntime = () => _runtimeP ??= import('@szkrabok/runtime');

export const test = base.extend({
  // Worker-scoped: one browser connection per worker, reused across tests.
  _runtimeHandle: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixture API requires destructuring even when no fixtures are used
    async ({}, use) => {
      if (cdpEndpoint) {
        // Path A: plain CDP connect — no runtime import needed.
        // The MCP session browser already has stealth applied at launch time.
        const browser  = await chromium.connectOverCDP(cdpEndpoint);
        const contexts = browser.contexts();
        const context  = contexts[0] ?? await browser.newContext();
        await use({ browser, context });
        // Do NOT close — MCP session owns this browser.
        if (process.env.SZKRABOK_ATTACH_SIGNAL) {
          await writeFile(process.env.SZKRABOK_ATTACH_SIGNAL, '').catch(() => {});
        }
      } else {
        // Path B: launch standalone with full stealth + persistence
        const { initConfig, launch } = await getRuntime();
        initConfig();
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
