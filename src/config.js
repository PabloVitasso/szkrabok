import { homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { readdirSync, existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { parse } from 'smol-toml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── TOML config ───────────────────────────────────────────────────────────────
// Base:  szkrabok.config.toml       (committed, repo defaults)
// Local: szkrabok.config.local.toml (gitignored, machine-specific overrides)
// Local is deep-merged on top of base — only keys present in local override base.

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

const deepMerge = (base, override) => {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    result[key] =
      isPlainObject(base[key]) && isPlainObject(override[key])
        ? deepMerge(base[key], override[key])
        : override[key];
  }
  return result;
};

const TOML_PATH = join(REPO_ROOT, 'szkrabok.config.toml');
const TOML_LOCAL_PATH = join(REPO_ROOT, 'szkrabok.config.local.toml');
const tomlBase = existsSync(TOML_PATH) ? parse(readFileSync(TOML_PATH, 'utf8')) : {};
const tomlLocal = existsSync(TOML_LOCAL_PATH) ? parse(readFileSync(TOML_LOCAL_PATH, 'utf8')) : {};
const toml = deepMerge(tomlBase, tomlLocal);

const tomlDefault = toml.default ?? {};
const tomlPresets = toml.preset ?? {};

// Resolve a preset by name: merge [default] → [preset.<name>]
// Returns the fully resolved config object plus the preset name and label.
export const resolvePreset = name => {
  const base = {
    label: tomlDefault.label ?? 'Default',
    userAgent: tomlDefault.userAgent ?? null,
    overrideUserAgent: tomlDefault.overrideUserAgent ?? null,
    viewport: tomlDefault.viewport ?? null,
    locale: tomlDefault.locale ?? null,
    timezone: tomlDefault.timezone ?? null,
    headless: tomlDefault.headless ?? null,
  };

  if (!name || name === 'default') {
    return { preset: 'chromium-honest', ...base };
  }

  const override = tomlPresets[name];
  if (!override) {
    return { preset: 'chromium-honest', ...base };
  }

  return {
    preset: name,
    label: override.label ?? base.label,
    userAgent: override.userAgent ?? base.userAgent,
    overrideUserAgent: override.overrideUserAgent ?? base.overrideUserAgent,
    viewport: override.viewport ?? base.viewport,
    locale: override.locale ?? base.locale,
    timezone: override.timezone ?? base.timezone,
    headless: override.headless ?? base.headless,
  };
};

export const PRESETS = Object.keys(tomlPresets);

// ── puppeteer-extra-plugin-stealth config ─────────────────────────────────────

const tomlStealth = toml['puppeteer-extra-plugin-stealth'] ?? {};
const tomlStealthEvasions = tomlStealth.evasions ?? {};

export const STEALTH_ENABLED = tomlStealth.enabled ?? true;

// Full stealth config passed to szkrabok_stealth.js.
// Each key maps to a named evasion in puppeteer-extra-plugin-stealth.
export const STEALTH_CONFIG = {
  // Flat boolean map of simple headless-fix evasions (no options)
  evasions: tomlStealthEvasions,
  // Configurable evasions — each has an enabled flag plus options
  'user-agent-override': tomlStealth['user-agent-override'] ?? { enabled: true, mask_linux: true },
  'navigator.vendor': tomlStealth['navigator.vendor'] ?? { enabled: true, vendor: 'Google Inc.' },
  'navigator.hardwareConcurrency': tomlStealth['navigator.hardwareConcurrency'] ?? {
    enabled: true,
    hardware_concurrency: 4,
  },
  'navigator.languages': tomlStealth['navigator.languages'] ?? { enabled: true },
  'webgl.vendor': tomlStealth['webgl.vendor'] ?? {
    enabled: true,
    vendor: 'Intel Inc.',
    renderer: 'Intel Iris OpenGL Engine',
  },
};

// ── Resolved defaults (from TOML) ─────────────────────────────────────────────

const defaults = resolvePreset('default');

export const DEFAULT_TIMEOUT = 30000;
export const TIMEOUT = tomlDefault.timeout ?? DEFAULT_TIMEOUT;

// Headless priority:
// 1. HEADLESS env var (explicit CI override)
// 2. No DISPLAY → always headless (environment fact, cannot run headed without X)
// 3. TOML [default].headless (local machine preference, only applies when DISPLAY exists)
export const HEADLESS =
  process.env.HEADLESS !== undefined
    ? process.env.HEADLESS === 'true'
    : process.env.DISPLAY
      ? (defaults.headless ?? false)
      : true;

export const DISABLE_WEBGL = tomlDefault.disable_webgl ?? false;
export const LOG_LEVEL = tomlDefault.log_level ?? 'info';

export const VIEWPORT = defaults.viewport ?? { width: 1280, height: 800 };

export const USER_AGENT =
  defaults.userAgent ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const LOCALE = defaults.locale || 'en-US';
export const TIMEZONE = defaults.timezone || 'America/New_York';

// ── Chromium path resolution ──────────────────────────────────────────────────

export const findChromiumPath = () => {
  // TOML executablePath takes priority over auto-detection
  if (tomlDefault.executablePath) {
    return tomlDefault.executablePath;
  }

  const playwrightCache = join(homedir(), '.cache', 'ms-playwright');

  if (existsSync(playwrightCache)) {
    const dirs = readdirSync(playwrightCache)
      .filter(d => d.startsWith('chromium-'))
      .sort()
      .reverse(); // latest first

    for (const dir of dirs) {
      const paths = [
        join(playwrightCache, dir, 'chrome-linux', 'chrome'),
        join(playwrightCache, dir, 'chrome-linux64', 'chrome'),
      ];

      for (const path of paths) {
        if (existsSync(path)) {
          return path;
        }
      }
    }
  }

  // Fallback to system chromium
  const systemChromiums = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];

  for (const path of systemChromiums) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
};
