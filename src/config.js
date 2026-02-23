import { homedir } from 'os'
import { join, resolve, dirname } from 'path'
import { readdirSync, existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { parse } from 'smol-toml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// ── TOML config ───────────────────────────────────────────────────────────────

const TOML_PATH = join(REPO_ROOT, 'szkrabok.config.toml')
const toml = existsSync(TOML_PATH) ? parse(readFileSync(TOML_PATH, 'utf8')) : {}

const tomlDefault = toml.default ?? {}
const tomlPresets = toml.preset ?? {}

// Resolve a preset by name: merge [default] → [preset.<name>]
// Returns the fully resolved config object plus the preset name and label.
export const resolvePreset = name => {
  const base = {
    label:     tomlDefault.label     ?? 'Default',
    userAgent: tomlDefault.userAgent ?? null,
    viewport:  tomlDefault.viewport  ?? null,
    locale:    tomlDefault.locale    ?? null,
    timezone:  tomlDefault.timezone  ?? null,
    headless:  tomlDefault.headless  ?? null,
  }

  if (!name || name === 'default') {
    return { preset: 'default', ...base }
  }

  const override = tomlPresets[name]
  if (!override) {
    return { preset: 'default', ...base }
  }

  return {
    preset:    name,
    label:     override.label     ?? base.label,
    userAgent: override.userAgent ?? base.userAgent,
    viewport:  override.viewport  ?? base.viewport,
    locale:    override.locale    ?? base.locale,
    timezone:  override.timezone  ?? base.timezone,
    headless:  override.headless  ?? base.headless,
  }
}

export const PRESETS = Object.keys(tomlPresets)
export const STEALTH_ENABLED = toml.stealth?.enabled ?? true

// ── Resolved defaults (env vars still override TOML) ─────────────────────────

const defaults = resolvePreset('default')

export const DEFAULT_TIMEOUT = 30000
export const TIMEOUT = parseInt(process.env.TIMEOUT) || DEFAULT_TIMEOUT

// Headless priority:
// 1. HEADLESS env var (explicit override)
// 2. No DISPLAY → always headless (environment fact, cannot run headed without X)
// 3. TOML [default].headless (local machine preference, only applies when DISPLAY exists)
export const HEADLESS = process.env.HEADLESS !== undefined
  ? process.env.HEADLESS === 'true'
  : process.env.DISPLAY
    ? (defaults.headless ?? false)
    : true

export const DISABLE_WEBGL = process.env.DISABLE_WEBGL === 'true'

export const VIEWPORT = defaults.viewport ?? {
  width:  parseInt(process.env.VIEWPORT_WIDTH)  || 1280,
  height: parseInt(process.env.VIEWPORT_HEIGHT) || 800,
}

export const USER_AGENT =
  process.env.USER_AGENT ||
  defaults.userAgent ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const LOCALE   = process.env.LOCALE   || defaults.locale   || 'en-US'
export const TIMEZONE = process.env.TIMEZONE || defaults.timezone || 'America/New_York'

// ── Chromium path resolution ──────────────────────────────────────────────────

export const findChromiumPath = () => {
  const playwrightCache = join(homedir(), '.cache', 'ms-playwright')

  if (existsSync(playwrightCache)) {
    const dirs = readdirSync(playwrightCache)
      .filter(d => d.startsWith('chromium-'))
      .sort()
      .reverse() // latest first

    for (const dir of dirs) {
      const paths = [
        join(playwrightCache, dir, 'chrome-linux', 'chrome'),
        join(playwrightCache, dir, 'chrome-linux64', 'chrome'),
      ]

      for (const path of paths) {
        if (existsSync(path)) {
          return path
        }
      }
    }
  }

  // Fallback to system chromium
  const systemChromiums = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ]

  for (const path of systemChromiums) {
    if (existsSync(path)) {
      return path
    }
  }

  return null
}
