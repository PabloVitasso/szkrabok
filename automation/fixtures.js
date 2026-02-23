/**
 * Custom fixtures for szkrabok test suite.
 *
 * When SZKRABOK_CDP_ENDPOINT is set (injected by browser.run_test via MCP),
 * the browser/context/page fixtures connect to the live MCP session browser
 * via CDP instead of launching a new one.
 *
 * Without SZKRABOK_CDP_ENDPOINT the fixtures launch a stealth browser standalone,
 * so tests work standalone too (using storageState from playwright.config.ts).
 */
import { test as base, chromium } from 'playwright/test'
import { enhanceWithStealth } from '../src/core/szkrabok_stealth.js'

const stealthChromium = enhanceWithStealth(chromium)

export { expect } from 'playwright/test'

const cdpEndpoint = process.env.SZKRABOK_CDP_ENDPOINT || ''

export const test = base.extend({
  // Worker-scoped: one CDP connection per worker process, reused across tests.
  _cdpBrowser: [
    async ({}, use) => {
      if (!cdpEndpoint) {
        await use(null)
        return
      }
      const browser = await chromium.connectOverCDP(cdpEndpoint)
      await use(browser)
      // Do NOT close — MCP session owns this browser.
    },
    { scope: 'worker' },
  ],

  // Override browser fixture: CDP browser when available, stealth browser standalone.
  browser: [
    async ({ _cdpBrowser }, use) => {
      if (_cdpBrowser) {
        await use(_cdpBrowser)
        return
      }
      const browser = await stealthChromium.launch()
      await use(browser)
      await browser.close()
    },
    { scope: 'worker' },
  ],

  // Reuse the existing context from the live session; create new one from stealth browser otherwise.
  context: async ({ _cdpBrowser, browser }, use) => {
    if (_cdpBrowser) {
      const contexts = _cdpBrowser.contexts()
      const ctx = contexts[0] ?? (await _cdpBrowser.newContext())
      await use(ctx)
      // Do NOT close — MCP session owns this context.
      return
    }
    const ctx = await browser.newContext()
    await use(ctx)
    await ctx.close()
  },

  // Reuse the existing page from the live session; create new one otherwise.
  // NOTE: base `page` fixture is NOT listed as a dependency — doing so would
  // cause Playwright to open an extra blank tab in the CDP-connected browser.
  page: async ({ _cdpBrowser, context }, use) => {
    if (_cdpBrowser) {
      const pages = context.pages()
      const pg = pages[0] ?? (await context.newPage())
      await use(pg)
      // Do NOT close — MCP session owns this page.
      return
    }
    const pg = await context.newPage()
    await use(pg)
    await pg.close()
  },
})
