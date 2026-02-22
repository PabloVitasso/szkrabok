import { defineConfig, chromium } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

// Session id injected by browser.run_test via env var, or set manually:
//   SZKRABOK_SESSION=my-session npx playwright test
const sessionId = process.env.SZKRABOK_SESSION ?? 'playwright-default'

// storageState JSON lives alongside the szkrabok session.
// If present, tests start pre-authenticated (cookies + localStorage loaded).
// After the test run a globalTeardown saves updated state back to this file.
const stateFile = path.resolve(
  __dirname, '..', 'sessions', sessionId, 'storageState.json'
)

// Resolve executable path for any browser type.
//
// Strategy: call browserType.executablePath() to get what *this* @playwright/test
// version expects. If that file exists → return undefined (playwright handles it).
// If not → parse the expected path to extract:
//   - the cache root  (e.g. ~/.cache/ms-playwright)
//   - the dir prefix  (e.g. "chromium-", "firefox-", "webkit-", "chromium_headless_shell-")
//   - the relative exe path inside that dir  (e.g. "chrome-linux64/chrome")
// Then scan installed dirs with the same prefix, sorted by version descending,
// and return the first candidate that exists on disk.
//
// Works for chromium, firefox, webkit, chromium_headless_shell — and future browsers —
// without any hardcoded names or versions.
function resolveExecutable(expectedPath: string): string | undefined {
  if (fs.existsSync(expectedPath)) return undefined // already installed, no override needed

  const cacheDir = process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(os.homedir(), '.cache', 'ms-playwright')

  if (!fs.existsSync(cacheDir)) return undefined

  // e.g. expectedPath = /home/user/.cache/ms-playwright/chromium-1210/chrome-linux64/chrome
  // relative to cacheDir:  chromium-1210/chrome-linux64/chrome
  const rel = path.relative(cacheDir, expectedPath)   // "chromium-1210/chrome-linux64/chrome"
  const parts = rel.split(path.sep)                   // ["chromium-1210", "chrome-linux64", "chrome"]
  if (parts.length < 2) return undefined

  const expectedDir = parts[0]                        // "chromium-1210"
  const exeRelPath  = parts.slice(1).join(path.sep)   // "chrome-linux64/chrome"

  // Strip trailing version digits to get the prefix: "chromium-" or "firefox-" etc.
  const prefix = expectedDir.replace(/-?\d+$/, '-')   // "chromium-", "firefox-", "webkit-"

  const installed = fs.readdirSync(cacheDir)
    .filter(d => d.startsWith(prefix))
    .map(d => {
      const num = parseInt(d.replace(prefix, ''), 10)
      return { dir: d, num }
    })
    .filter(e => !isNaN(e.num))
    .sort((a, b) => b.num - a.num) // highest version first

  for (const entry of installed) {
    const candidate = path.join(cacheDir, entry.dir, exeRelPath)
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

const executablePath = resolveExecutable(chromium.executablePath())

// When SZKRABOK_CDP_ENDPOINT is set, connect to the existing MCP session browser
// via CDP instead of launching a new one. This lets tests share the same browser as the MCP session.
// The endpoint is deterministic: derived from the session id at launch time.
const cdpEndpoint = process.env.SZKRABOK_CDP_ENDPOINT || ''

export default defineConfig({
  testDir: './tests',

  // globalTeardown saves storageState after all tests complete.
  globalTeardown: './teardown',

  // Serial - one browser at a time per session.
  workers: 1,

  use: {
    // Load existing session state if available (only when launching a new browser).
    // When SZKRABOK_CDP_ENDPOINT is set the fixtures.ts fixture handles connection;
    // storageState is skipped because the live browser already has its state.
    storageState: (!cdpEndpoint && fs.existsSync(stateFile)) ? stateFile : undefined,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
    },
  },

  reporter: [
    ['list'],
    // JSON report goes to the session dir so run_test can read it by path
    ['json', { outputFile: path.resolve(
      __dirname, '..', 'sessions', sessionId, 'last-run.json'
    )}],
  ],
})
