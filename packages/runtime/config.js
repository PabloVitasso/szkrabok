import { join, resolve, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { parse } from 'smol-toml';
import { ConfigNotInitializedError, ConfigNotFinalError } from './errors.js';

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Arrays replace (not merge). null sets null (does not delete). See docs for full semantics.
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

const loadTomlFromDir = dir => {
  const base = join(dir, 'szkrabok.config.toml');
  const local = join(dir, 'szkrabok.config.local.toml');
  const hasBase = existsSync(base);
  const hasLocal = existsSync(local);
  if (!hasBase && !hasLocal) return null;
  const baseData = hasBase ? parse(readFileSync(base, 'utf8')) : {};
  const localData = hasLocal ? parse(readFileSync(local, 'utf8')) : {};
  return deepMerge(baseData, localData);
};

const walkUp = (startDir, rootBoundary) => {
  let dir = resolve(startDir);
  const boundary = rootBoundary ? resolve(rootBoundary) : null;
  while (true) {
    const data = loadTomlFromDir(dir);
    if (data) return data;
    if (boundary && dir === boundary) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

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

// ── State ──────────────────────────────────────────────────────────────────────

let _phase = null;       // null | 'provisional' | 'final'
let _config = null;
let _configMeta = null;  // { phase, source, previousSource }

// ── Discovery ─────────────────────────────────────────────────────────────────

const _discover = ({ roots = [], explicitConfigPath = null } = {}) => {
  let toml = null;
  let source = null;

  // Each step appends one entry to `searched` via spread (no .push — lint rule).
  let searched = [];

  // 0. Explicit path injected by caller (replaces process.env write from CLI)
  if (explicitConfigPath) {
    const found = existsSync(explicitConfigPath);
    searched = [...searched, { step: 'explicit', paths: [explicitConfigPath], found }];
    if (!toml && found) {
      toml = parse(readFileSync(explicitConfigPath, 'utf8'));
      source = `explicit (${explicitConfigPath})`;
    }
  }

  // 1. SZKRABOK_CONFIG env var (absolute path)
  const configEnv = process.env.SZKRABOK_CONFIG;
  if (configEnv) {
    const found = existsSync(configEnv);
    searched = [...searched, { step: 'env:SZKRABOK_CONFIG', paths: [configEnv], found }];
    if (!toml && found) {
      toml = parse(readFileSync(configEnv, 'utf8'));
      source = `env:SZKRABOK_CONFIG (${configEnv})`;
    }
  }

  // 2. SZKRABOK_ROOT env var — walk-up bounded by root
  const rootEnv = process.env.SZKRABOK_ROOT;
  if (rootEnv) {
    const data = !toml && walkUp(rootEnv, rootEnv);
    searched = [...searched, {
      step: 'env:SZKRABOK_ROOT',
      paths: [join(rootEnv, 'szkrabok.config.toml'), join(rootEnv, 'szkrabok.config.local.toml')],
      found: !!data,
    }];
    if (!toml && data) { toml = data; source = `env:SZKRABOK_ROOT (${rootEnv})`; }
  }

  // 3. MCP roots — check each independently, use first hit
  searched = [
    ...searched,
    ...roots.map(root => {
      const data = !toml && walkUp(root, root);
      if (!toml && data) { toml = data; source = `mcp-root (${root})`; }
      return {
        step: 'mcp-root',
        paths: [join(root, 'szkrabok.config.toml'), join(root, 'szkrabok.config.local.toml')],
        found: !!data,
      };
    }),
  ];

  // 4. process.cwd() — exact dir only, no walk-up (§2: unbounded walk-up removed)
  {
    const cwd = process.cwd();
    const data = !toml && loadTomlFromDir(cwd);
    searched = [...searched, {
      step: 'cwd',
      paths: [join(cwd, 'szkrabok.config.toml'), join(cwd, 'szkrabok.config.local.toml')],
      found: !!data,
    }];
    if (!toml && data) { toml = data; source = `cwd (${cwd})`; }
  }

  // 5. User config dir (XDG on Linux/macOS, %APPDATA% on Windows)
  {
    const configDir = process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'szkrabok')
      : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'szkrabok');
    const xdgBase = join(configDir, 'config.toml');
    const xdgLocal = join(configDir, 'config.local.toml');
    const hasBase = existsSync(xdgBase);
    const hasLocal = existsSync(xdgLocal);
    searched = [...searched, { step: 'xdg', paths: [xdgBase, xdgLocal], found: hasBase || hasLocal }];
    if (!toml && (hasBase || hasLocal)) {
      const baseData = hasBase ? parse(readFileSync(xdgBase, 'utf8')) : {};
      const localData = hasLocal ? parse(readFileSync(xdgLocal, 'utf8')) : {};
      toml = deepMerge(baseData, localData);
      source = `xdg (${configDir})`;
    }
  }

  return { toml, source: source ?? 'none (no config file found — using built-in defaults)', searched };
};

// ── Test seam ──────────────────────────────────────────────────────────────────

export const _resetConfigForTesting = () => {
  _phase = null;
  _config = null;
  _configMeta = null;
};

// ── Public API ─────────────────────────────────────────────────────────────────

// Backward-compat one-shot init. Sets phase to 'final' directly.
// Used by tests, CLI commands, and any code doing a single-step initialization.
export const initConfig = (roots = [], { explicitConfigPath = null } = {}) => {
  const { toml, source, searched } = _discover({ roots, explicitConfigPath });
  const previous = _configMeta?.source ?? null;
  _config = Object.freeze(buildConfig(toml ?? {}));
  _phase = 'final';
  _configMeta = { phase: 'final', source, previousSource: previous, searched };
};

// Server provisional phase — runs immediately on startup, before MCP roots arrive.
export const initConfigProvisional = ({ explicitConfigPath = null } = {}) => {
  const { toml, source, searched } = _discover({ roots: [], explicitConfigPath });
  _config = Object.freeze(buildConfig(toml ?? {}));
  _phase = 'provisional';
  _configMeta = { phase: 'provisional', source, previousSource: null, searched };
};

// Server finalize phase — runs after MCP roots arrive via oninitialized.
export const finalizeConfig = (roots = [], { explicitConfigPath = null } = {}) => {
  const { toml, source, searched } = _discover({ roots, explicitConfigPath });
  const previous = _configMeta?.source ?? null;
  _config = Object.freeze(buildConfig(toml ?? {}));
  _phase = 'final';
  _configMeta = { phase: 'final', source, previousSource: previous, searched };
};

// Default blocks provisional reads. Pass { allowProvisional: true } only for
// code that is explicitly designed to tolerate provisional config (e.g. logger).
export const getConfig = ({ allowProvisional = false } = {}) => {
  if (!_config) throw new ConfigNotInitializedError();
  if (!allowProvisional && _phase !== 'final') throw new ConfigNotFinalError();
  return _config;
};

export const getConfigSource = () => _configMeta?.source ?? null;
export const getConfigMeta = () => _configMeta;

export const resolvePreset = name => {
  if (!_config) throw new ConfigNotInitializedError();
  return _config._resolvePreset(name);
};

export const getPresets = () => {
  if (!_config) throw new ConfigNotInitializedError();
  return Object.keys(_config._presetsMap);
};

// ── Chromium path resolution ────────────────────────────────────────────────

// resolveBrowserPath — legacy pure finder. Kept for backward compat.
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

// Backward-compat wrapper. Delegates to resolve.js.
// New code should use resolve.js directly.
export const findChromiumPath = async () => {
  const { resolveChromium, buildCandidates, populateCandidates } = await import('./resolve.js');
  let cfg;
  try { cfg = getConfig({ allowProvisional: true }); } catch { cfg = {}; }
  const candidates = buildCandidates({ executablePath: cfg.executablePath });
  const populated = await populateCandidates(candidates);
  const result = resolveChromium(populated);
  return result.found ? result.path : null;
};
