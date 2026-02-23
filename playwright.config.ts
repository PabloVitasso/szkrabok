import { defineConfig, chromium } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Session id injected by browser.run_test via env var, or set manually:
//   SZKRABOK_SESSION=my-session npx playwright test --project=automation
const sessionId = process.env.SZKRABOK_SESSION ?? 'playwright-default'

const stateFile = path.resolve(__dirname, 'sessions', sessionId, 'storageState.json')

// Resolve executable path for any installed browser version when exact version is missing.
function resolveExecutable(expectedPath: string): string | undefined {
  if (fs.existsSync(expectedPath)) return undefined

  const cacheDir = process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(os.homedir(), '.cache', 'ms-playwright')

  if (!fs.existsSync(cacheDir)) return undefined

  const rel = path.relative(cacheDir, expectedPath)
  const parts = rel.split(path.sep)
  if (parts.length < 2) return undefined

  const expectedDir = parts[0]
  const exeRelPath = parts.slice(1).join(path.sep)
  const prefix = expectedDir.replace(/-?\d+$/, '-')

  const installed = fs.readdirSync(cacheDir)
    .filter(d => d.startsWith(prefix))
    .map(d => ({ dir: d, num: parseInt(d.replace(prefix, ''), 10) }))
    .filter(e => !isNaN(e.num))
    .sort((a, b) => b.num - a.num)

  for (const entry of installed) {
    const candidate = path.join(cacheDir, entry.dir, exeRelPath)
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

const executablePath = resolveExecutable(chromium.executablePath())
const cdpEndpoint = process.env.SZKRABOK_CDP_ENDPOINT || ''

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  timeout: 60000,
  reporter: [
    ['list'],
    ['json', { outputFile: path.resolve(__dirname, 'sessions', sessionId, 'last-run.json') }],
  ],

  projects: [
    {
      name: 'selftest',
      testDir: './selftest/playwright',
      testMatch: '**/*.spec.ts',
      // No browser — tests run Playwright as test runner against an MCP subprocess.
    },
    {
      name: 'automation',
      testDir: './automation',
      testMatch: '**/*.spec.ts',
      use: {
        // Load existing session state when launching a new browser.
        // Skipped when SZKRABOK_CDP_ENDPOINT is set (live browser already has state).
        storageState: (!cdpEndpoint && fs.existsSync(stateFile)) ? stateFile : undefined,
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
        },
      },
    },
  ],

  // automation-only global options (only apply when running that project)
  globalTeardown: process.env.PLAYWRIGHT_PROJECT === 'automation'
    ? './automation/teardown'
    : undefined,
})
