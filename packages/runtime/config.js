import { join, resolve, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { parse } from 'smol-toml';

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

// Load szkrabok.config.toml + szkrabok.config.local.toml from a directory.
// Returns merged object, or null if neither file exists.
const loadTomlFromDir = dir => {
  const base = join(dir, 'szkrabok.config.toml');
  const local = join(dir, 'szkrabok.config.local.toml');
  const hasBase = existsSync(base);
  const hasLocal = existsSync(local);
  if (!hasBase && !hasLocal) return null;
  let baseData;
  if (hasBase) {
    baseData = parse(readFileSync(base, 'utf8'));
  } else {
    baseData = {};
  }
  let localData;
  if (hasLocal) {
    localData = parse(readFileSync(local, 'utf8'));
  } else {
    localData = {};
  }
  return deepMerge(baseData, localData);
};

// Walk up from startDir. If rootBoundary is given, stop at that dir (inclusive).
// Returns first toml object found, or null.
const walkUp = (startDir, rootBoundary) => {
  let dir = resolve(startDir);
  const boundary = (() => { if (rootBoundary) return resolve(rootBoundary); return null; })();
  while (true) {
    const data = loadTomlFromDir(dir);
    if (data) return data;
    if (boundary && dir === boundary) return null;
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
};

// Build internal config object from raw toml.
const buildConfig = toml => {
  const d = toml.default ?? {};
  const stealthToml = toml['puppeteer-extra-plugin-stealth'] ?? {};
  const stealthEvasions = stealthToml.evasions ?? {};
  const presetsMap = toml.preset ?? {};

  const _resolvePreset = name => {
    const base = {
      label: d.label ?? 'Default',
      userAgent: d.userAgent ?? null,
      overrideUserAgent: d.overrideUserAgent ?? null,
      viewport: d.viewport ?? null,
      locale: d.locale ?? null,
      timezone: d.timezone ?? null,
      headless: d.headless ?? null,
    };
    if (!name || name === 'default') return { preset: 'chromium-honest', ...base };
    const override = presetsMap[name];
    if (!override) return { preset: 'chromium-honest', ...base };
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

  const defaults = _resolvePreset('default');

  // On Linux, absence of DISPLAY means no desktop. On macOS/Windows a desktop
  // is always present, so default to non-headless on those platforms.
  const hasDisplay =
    process.env.DISPLAY || process.platform === 'darwin' || process.platform === 'win32';
  const headless =
    process.env.HEADLESS !== undefined
      ? process.env.HEADLESS === 'true'
      : hasDisplay
        ? (defaults.headless ?? false)
        : true;

  return {
    _presetsMap: presetsMap,
    _resolvePreset,
    headless,
    userAgent:
      defaults.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: defaults.viewport ?? { width: 1280, height: 800 },
    locale: defaults.locale || 'en-US',
    timezone: defaults.timezone || 'America/New_York',
    timeout: d.timeout ?? 30000,
    logLevel: d.log_level ?? 'info',
    disableWebgl: d.disable_webgl ?? false,
    executablePath: d.executablePath ?? null,
    stealthEnabled: stealthToml.enabled ?? true,
    stealth: {
      evasions: stealthEvasions,
      'user-agent-override': stealthToml['user-agent-override'] ?? { enabled: true, mask_linux: true },
      'navigator.vendor': stealthToml['navigator.vendor'] ?? { enabled: true, vendor: 'Google Inc.' },
      'navigator.hardwareConcurrency': stealthToml['navigator.hardwareConcurrency'] ?? {
        enabled: true,
        hardware_concurrency: 4,
      },
      'navigator.languages': stealthToml['navigator.languages'] ?? { enabled: true },
      'webgl.vendor': stealthToml['webgl.vendor'] ?? {
        enabled: true,
        vendor: 'Intel Inc.',
        renderer: 'Intel Iris OpenGL Engine',
      },
    },
  };
};

let _config = null;

// Discovery algorithm: first match wins.
// roots: array of absolute paths from MCP handshake (may be empty).
export const initConfig = (roots = []) => {
  let toml = null;

  // 1. SZKRABOK_CONFIG env var (absolute path)
  const configEnv = process.env.SZKRABOK_CONFIG;
  if (!toml && configEnv && existsSync(configEnv)) {
    toml = parse(readFileSync(configEnv, 'utf8'));
  }

  // 2. SZKRABOK_ROOT env var — walk-up bounded by root
  if (!toml) {
    const rootEnv = process.env.SZKRABOK_ROOT;
    if (rootEnv) {
      toml = walkUp(rootEnv, rootEnv);
    }
  }

  // 3. MCP roots — check each independently, use first hit
  if (!toml && roots.length > 0) {
    for (const root of roots) {
      const found = walkUp(root, root);
      if (found) { toml = found; break; }
    }
  }

  // 4. process.cwd() — unbounded walk-up (CLI / test fallback)
  if (!toml) {
    toml = walkUp(process.cwd(), null);
  }

  // 5. User config dir fallback (XDG on Linux/macOS, %APPDATA% on Windows)
  if (!toml) {
    const configDir = process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'szkrabok')
      : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'szkrabok');
    const xdgPath = join(configDir, 'config.toml');
    if (existsSync(xdgPath)) {
      toml = parse(readFileSync(xdgPath, 'utf8'));
    }
  }

  // 6. Empty defaults
  _config = buildConfig(toml ?? {});
};

export const getConfig = () => {
  if (!_config) throw new Error('szkrabok: getConfig() called before initConfig()');
  return _config;
};

// resolvePreset reads from current config, falls back to defaults if not initialized.
export const resolvePreset = name => {
  if (_config) return _config._resolvePreset(name);
  return buildConfig({})._resolvePreset(name);
};

export const getPresets = () => { if (_config) return Object.keys(_config._presetsMap); return []; };

// ── Chromium path resolution ────────────────────────────────────────────────

// resolveBrowserPath — legacy pure finder. Kept for backward compat.
// New code should use resolve.js directly.
export const resolveBrowserPath = async finders => {
  for (const finder of finders) {
    try {
      const path = await finder();
      if (path) return path;
    } catch {
      // finder unavailable — try next
    }
  }
  return null;
};

/**
 * Backward-compat wrapper. Delegates to resolve.js.
 */
export const findChromiumPath = async () => {
  const { resolveChromium, buildCandidates, populateCandidates } = await import('./resolve.js');
  // Use getConfig() with the same try/catch fallback as checkBrowser() —
  // consistent initialization handling even if initConfig() was never called.
  let cfg;
  try { cfg = getConfig(); } catch { cfg = {}; }
  const candidates = buildCandidates({ executablePath: cfg.executablePath });
  await populateCandidates(candidates);
  const result = resolveChromium(candidates);
  return result.found ? result.path : null;
};
