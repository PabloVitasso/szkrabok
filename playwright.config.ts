import { defineConfig, chromium } from 'playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
import { parse } from 'smol-toml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Read TOML config directly — independent of src/config.js to avoid coupling
// playwright's loader to the MCP module graph.
// Base:  szkrabok.config.toml       (committed, repo defaults)
// Local: szkrabok.config.local.toml (gitignored, machine-specific overrides)
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const deepMerge = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    result[key] =
      isPlainObject(base[key]) && isPlainObject(override[key])
        ? deepMerge(base[key] as Record<string, unknown>, override[key] as Record<string, unknown>)
        : override[key]
  }
  return result
}

const tomlPath = path.join(__dirname, 'szkrabok.config.toml')
const tomlLocalPath = path.join(__dirname, 'szkrabok.config.local.toml')
const tomlBase = fs.existsSync(tomlPath) ? parse(fs.readFileSync(tomlPath, 'utf8')) : {}
const tomlLocal = fs.existsSync(tomlLocalPath) ? parse(fs.readFileSync(tomlLocalPath, 'utf8')) : {}
const toml = deepMerge(tomlBase as Record<string, unknown>, tomlLocal as Record<string, unknown>)
const tomlDefault = (toml.default as Record<string, unknown>) ?? {}
const tomlPresets = (toml.preset as Record<string, unknown>) ?? {}

// Resolve preset: merge [default] → [preset.<name>] (preset wins on conflict)
const presetName = process.env.SZKRABOK_PRESET || 'default'
const override = presetName !== 'default' ? (tomlPresets[presetName] ?? {}) : {}
const preset = {
  userAgent: override.userAgent ?? tomlDefault.userAgent ?? undefined,
  viewport:  (override.viewport  ?? tomlDefault.viewport)  ? { width: (override.viewport ?? tomlDefault.viewport).width, height: (override.viewport ?? tomlDefault.viewport).height } : undefined,
  locale:    override.locale    ?? tomlDefault.locale    ?? undefined,
  timezone:  override.timezone  ?? tomlDefault.timezone  ?? undefined,
}

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

const sessionResultsDir = path.resolve(__dirname, 'sessions', sessionId, 'test-results')

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  timeout: 60000,
  outputDir: sessionResultsDir,
  reporter: [
    ['list'],
    ['json', { outputFile: path.resolve(__dirname, 'sessions', sessionId, 'last-run.json') }],
  ],

  projects: [
    {
      name: 'selftest',
      testDir: './selftest/playwright',
      testMatch: '**/*.spec.js',
      // No browser — tests run Playwright as test runner against an MCP subprocess.
    },
    {
      name: 'automation',
      testDir: './automation',
      testMatch: '**/*.spec.js',
      use: {
        // Load existing session state when launching a new browser.
        // Skipped when SZKRABOK_CDP_ENDPOINT is set (live browser already has state).
        storageState: (!cdpEndpoint && fs.existsSync(stateFile)) ? stateFile : undefined,
        // Apply preset identity for standalone runs (CDP mode reuses live session).
        ...(!cdpEndpoint ? {
          userAgent: preset.userAgent ?? undefined,
          viewport:  preset.viewport  ?? undefined,
          locale:    preset.locale    ?? undefined,
          timezoneId: preset.timezone ?? undefined,
        } : {}),
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
        },
      },
    },
  ],

  // automation-only global options (only apply when running that project)
  globalSetup: process.env.PLAYWRIGHT_PROJECT === 'automation'
    ? './automation/setup.js'
    : undefined,
  globalTeardown: process.env.PLAYWRIGHT_PROJECT === 'automation'
    ? './automation/teardown.js'
    : undefined,
})
