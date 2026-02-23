/**
 * Custom fixtures for szkrabok test suite.
 *
 * When SZKRABOK_CDP_ENDPOINT is set (injected by browser.run_test via MCP),
 * the browser/context/page fixtures connect to the live MCP session browser
 * via CDP instead of launching a new one.
 *
 * Without SZKRABOK_CDP_ENDPOINT the fixtures fall through to Playwright defaults,
 * so tests work standalone too (using storageState from playwright.config.ts).
 */
import { test as base, chromium, Browser, BrowserContext, Page } from '@playwright/test'

export { expect } from '@playwright/test'

const cdpEndpoint = process.env.SZKRABOK_CDP_ENDPOINT || ''

export const test = base.extend<{}, { _cdpBrowser: Browser | null }>({
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

  // Override browser fixture to return the CDP-connected browser when available.
  browser: async ({ _cdpBrowser, browser }, use) => {
    await use(_cdpBrowser ?? browser)
  },

  // Reuse the existing context from the live session; create new one otherwise.
  context: async ({ _cdpBrowser, context }, use) => {
    if (!_cdpBrowser) {
      await use(context)
      return
    }
    const contexts = _cdpBrowser.contexts()
    const ctx: BrowserContext = contexts[0] ?? await _cdpBrowser.newContext()
    await use(ctx)
    // Do NOT close — MCP session owns this context.
  },

  // Reuse the existing page from the live session; create new one otherwise.
  page: async ({ _cdpBrowser, context, page }, use) => {
    if (!_cdpBrowser) {
      await use(page)
      return
    }
    const pages = context.pages()
    const pg: Page = pages[0] ?? await context.newPage()
    await use(pg)
    // Do NOT close — MCP session owns this page.
  },
})
