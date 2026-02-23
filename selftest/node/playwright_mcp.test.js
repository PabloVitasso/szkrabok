import { test } from 'node:test'
import assert from 'node:assert'
import * as session from '../../src/tools/szkrabok_session.js'
import * as playwrightMcp from '../../src/tools/playwright_mcp.js'
import { closeBrowser } from '../../src/upstream/wrapper.js'

const TEST_TIMEOUT = 60_000
const SESSION_ID = 'test-mcp'
const START_URL = 'https://example.com'
const LINK_REGEX = /- a "(.*?)" \[ref=(e\d+)\]/

// ---- helpers ---------------------------------------------------------------

const withTimeout = (promise, ms, label = 'operation') => {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)

  return Promise.race([
    promise,
    new Promise((_, reject) =>
      ac.signal.addEventListener('abort', () =>
        reject(new Error(`${label} timed out after ${ms}ms`))
      )
    ),
  ]).finally(() => clearTimeout(timer))
}

const openSession = () =>
  withTimeout(
    session.open({ id: SESSION_ID, url: START_URL }),
    10_000,
    'open session'
  )

const closeSession = () =>
  withTimeout(
    session.close({ id: SESSION_ID }),
    10_000,
    'close session'
  )

const getSnapshot = async () => {
  const res = await withTimeout(
    playwrightMcp.snapshot({ id: SESSION_ID }),
    10_000,
    'snapshot'
  )
  assert.ok(res?.snapshot, 'Empty snapshot')
  return res.snapshot
}

const extractFirstLink = (snapshot) => {
  const match = snapshot.match(LINK_REGEX)
  assert.ok(match, 'No link found in snapshot')
  return { text: match[1], ref: match[2] }
}

const clickRef = (ref) =>
  withTimeout(
    playwrightMcp.click({ id: SESSION_ID, ref }),
    10_000,
    'click'
  )

const navigateTo = (url) =>
  withTimeout(
    playwrightMcp.navigate({ id: SESSION_ID, url }),
    10_000,
    'navigate'
  )

// ---- test ------------------------------------------------------------------

test('playwright mcp features', { timeout: TEST_TIMEOUT }, async () => {
  await openSession()

  try {
    const snapshot = await getSnapshot()
    const { text, ref } = extractFirstLink(snapshot)

    console.log(`Found link: "${text}" (${ref})`)

    const clickResult = await clickRef(ref)
    assert.ok(
      clickResult.url.includes('iana.org'),
      `Unexpected URL after click: ${clickResult.url}`
    )

    const navResult = await navigateTo(START_URL)
    assert.strictEqual(
      navResult.url,
      'https://example.com/',
      'Navigation URL mismatch'
    )
  } finally {
    try {
      await closeSession()
    } catch (err) {
      console.error('Error closing session:', err.message)
    }

    try {
      await closeBrowser()
    } catch (err) {
      console.error('Error closing browser:', err.message)
    }
  }
})
