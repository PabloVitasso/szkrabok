/*
 * park4night — cookie banner acceptance test
 *
 * ── Run via MCP ──────────────────────────────────────────────────────────────
 *
 *   1. Open a session (launches Chrome with a persistent profile + CDP port):
 *        session.open { "id": "p4n-test" }
 *
 *   2. Run the test (connects to that Chrome via CDP):
 *        browser.run_test { "id": "p4n-test", "grep": "park4night" }
 *
 *   Session behaviour:
 *     NEW session  — profile directory is empty; park4night will show the
 *                    cookie banner. Expected result:
 *                      { "action": "clicked", "dismissed": true }
 *
 *     REUSED session — cookies are already persisted in the profile; the
 *                    banner will not appear. Expected result:
 *                      { "action": "skipped", "reason": "banner_not_present" }
 *
 *   To force a fresh run, delete the session first:
 *        session.delete { "id": "p4n-test" }
 *        session.open   { "id": "p4n-test" }
 *        browser.run_test { "id": "p4n-test", "grep": "park4night" }
 *
 * ── Run via Playwright CLI ───────────────────────────────────────────────────
 *
 *   WITH active MCP session (shares the live browser via CDP — recommended):
 *     SZKRABOK_SESSION=p4n-test \
 *       npx playwright test --config playwright-tests/playwright.config.ts \
 *       --grep "park4night"
 *
 *   WITHOUT active MCP session (Playwright launches its own fresh browser):
 *     - SZKRABOK_CDP_ENDPOINT is not set so fixtures.js falls back to a
 *       standard Playwright-managed browser.
 *     - If sessions/p4n-test/storageState.json exists (written by a previous
 *       run's teardown), cookies are pre-loaded — banner may not appear and
 *       result will be: { "action": "skipped", "reason": "banner_not_present" }
 *     - If no storageState.json exists, browser is clean — banner appears and
 *       result will be: { "action": "clicked", "dismissed": true }
 *     SZKRABOK_SESSION=p4n-test \
 *       npx playwright test --config playwright-tests/playwright.config.ts \
 *       --grep "park4night"
 *     (same command — absence of a running MCP session is handled automatically
 *      by fixtures.js; no error is thrown)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from './fixtures.js'

const BASE_URL    = 'https://park4night.com/en'
const BANNER      = '.cc-section-landing'
const BTN_REJECT  = `${BANNER} .cc-btn.cc-btn-reject`

test('acceptCookies', async ({ page }, testInfo) => {
  console.log('step 1. navigate to', BASE_URL)
  await page.goto(BASE_URL)

  console.log('step 2. probe for cookie banner (8s timeout)')
  const btn = page.locator(BTN_REJECT)
  const appeared = await btn.waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)

  console.log(`step 3. banner appeared: ${appeared}`)

  if (!appeared) {
    console.log('step 4. skipping — cookies already accepted')
    const result = { action: 'skipped', reason: 'banner_not_present' }
    await testInfo.attach('result', { body: JSON.stringify(result), contentType: 'application/json' })
    return
  }

  const isVisible = await btn.isVisible()
  const isEnabled = await btn.isEnabled()
  console.log(`step 4. button state — visible: ${isVisible}, enabled: ${isEnabled}`)

  if (!isVisible || !isEnabled) {
    console.log('step 5. button not interactable — failing')
    const result = { action: 'failed', visible: isVisible, enabled: isEnabled }
    await testInfo.attach('result', { body: JSON.stringify(result), contentType: 'application/json' })
    expect(isVisible && isEnabled, 'Cookie reject button not interactable').toBe(true)
    return
  }

  console.log('step 5. clicking "Only essential cookies"')
  await btn.click()

  console.log('step 6. waiting for banner to disappear')
  await page.locator(BANNER).waitFor({ state: 'hidden', timeout: 5000 })
  const bannerGone = !(await page.locator(BANNER).isVisible())

  console.log(`step 7. banner gone: ${bannerGone}`)
  const result = { action: 'clicked', dismissed: bannerGone }
  await testInfo.attach('result', { body: JSON.stringify(result), contentType: 'application/json' })

  expect(bannerGone, 'Cookie banner should be gone after clicking reject').toBe(true)
  console.log('step 8. done')
})
