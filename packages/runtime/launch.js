// launch.js — the one true browser bootstrap entry point.
// Only this file calls launchPersistentContext.

import { rm } from 'fs/promises';
import { chromium } from 'playwright';
import {
  resolvePreset,
  findChromiumPath,
  getConfig,
} from './config.js';
import { enhanceWithStealth, applyStealthToExistingPage } from './stealth.js';
import * as storage from './storage.js';
import * as pool from './pool.js';
import { log } from './logger.js';

let _gcRegistered = false;
const ensureGcOnExit = () => {
  if (_gcRegistered) return;
  _gcRegistered = true;
  // once: cleanupClones schedules I/O which re-empties the loop — process.on
  // would fire again indefinitely. once fires exactly once then self-removes.
  process.once('beforeExit', () => storage.cleanupClones().catch(() => {}));
};

// ── waitForExit ───────────────────────────────────────────────────────────────
//
// Wait for a Chromium PID to fully exit and release its file locks.
// Chromium is multi-process — the browser process exits when Playwright calls
// context.close(), but the actual Chrome process may linger briefly while
// releasing locks on the user data dir. Without this wait, rm() of the
// user data dir can race with a straggling Chrome process and get ENOTEMPTY.
//
// Retries every 100 ms up to timeoutMs. Logs each attempt so the failure
// mode is diagnostic rather than silent.
//
const CHROME_EXIT_POLL_MS  = 100;
const CHROME_EXIT_TIMEOUT_MS = 15_000;

const isPidAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
};

const waitForExit = async (pid, { timeoutMs = CHROME_EXIT_TIMEOUT_MS } = {}) => {
  if (!pid) return;
  if (!isPidAlive(pid)) {
    log(`waitForExit: PID ${pid} already dead`);
    return;
  }

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    await new Promise(r => setTimeout(r, CHROME_EXIT_POLL_MS));

    if (!isPidAlive(pid)) {
      log(`waitForExit: PID ${pid} exited after ${attempt} attempt(s)`);
      return;
    }

    const remaining = Math.max(0, deadline - Date.now());
    if (remaining < CHROME_EXIT_POLL_MS * 2) {
      log(`waitForExit: PID ${pid} still alive — ${remaining}ms remaining, continuing to poll`);
    }
  }

  // Timed out. Chrome is either hung or taking unusually long.
  log(`waitForExit: PID ${pid} still alive after ${timeoutMs}ms (${attempt} attempts) — proceeding anyway`);
};

// ── _resetGcForTesting ────────────────────────────────────────────────────────
//
// Resets the _gcRegistered guard so that ensureGcOnExit re-registers the
// beforeExit handler. Required for tests that call launchClone() multiple
// times across describe blocks in the same module instance.
//
export const _resetGcForTesting = () => { _gcRegistered = false; };

// _launchPersistentContext — internal, not exported.
// Only called by launch() below.
const _launchPersistentContext = async (userDataDir, options = {}) => {
  const presetConfig = options.presetConfig ?? {};
  const pw = options.stealth ? enhanceWithStealth(chromium, presetConfig) : chromium;
  const executablePath = await findChromiumPath();

  if (executablePath) {
    log('Using existing Chromium for persistent context', { path: executablePath });
  }

  const launchOptions = {
    ...options,
    headless: options.headless ?? getConfig().headless,
    executablePath,
    viewport: options.viewport,
    locale: options.locale,
    timezoneId: options.timezoneId,
    userAgent: options.userAgent,
  };

  delete launchOptions.stealth;
  delete launchOptions.presetConfig;

  launchOptions.args = [
    '--hide-crash-restore-bubble',
    '--disable-features=PortalActivationDelegate',
    ...(launchOptions.args || []),
  ];

  if (launchOptions.cdpPort !== undefined) {
    launchOptions.args = [
      ...launchOptions.args,
      `--remote-debugging-port=${launchOptions.cdpPort}`,
    ];
    delete launchOptions.cdpPort;
  }

  const context = await pw.launchPersistentContext(userDataDir, launchOptions);

  if (options.stealth) {
    const pages = context.pages();
    if (pages.length > 0) {
      await applyStealthToExistingPage(pages[0], presetConfig);
    }
  }

  return context;
};

/**
 * Launch a browser session.
 *
 * @param {object} [options]
 * @param {string} [options.profile]    Session name / profile dir key
 * @param {string} [options.preset]     TOML preset name (default: "default")
 * @param {boolean} [options.headless]  Overrides TOML + env
 * @param {boolean} [options.stealth]   Overrides TOML stealth setting
 * @param {string} [options.userAgent]  Overrides TOML + preset userAgent
 * @param {object} [options.viewport]   Overrides TOML + preset viewport { width, height }
 * @param {string} [options.locale]     Overrides TOML + preset locale
 * @param {string} [options.timezone]   Overrides TOML + preset timezone
 * @param {boolean} [options.reuse]     Return existing if profile already open (default: true)
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, cdpEndpoint: string, close(): Promise<void> }>}
 */
export const checkBrowser = async () => {
  const found = await findChromiumPath();
  if (!found) {
    throw new Error(
      'Chromium browser not found.\n\n' +
      'Run:\n' +
      '  npx playwright install chromium\n\n' +
      'Or:\n' +
      '  szkrabok install-browser\n'
    );
  }
  return found;
};

export const launch = async (options = {}) => {
  const { profile = 'default', preset: presetName, headless, stealth, userAgent, viewport, locale, timezone, reuse = true, _launchImpl } = options;
  const cfg = getConfig();

  ensureGcOnExit();
  await checkBrowser();
  await storage.cleanupClones();

  // Idempotency: return existing handle when reuse=true and profile is open
  if (reuse && pool.has(profile)) {
    log(`Reusing existing session: ${profile}`);
    const existing = pool.get(profile);
    const cdpEndpoint = `http://localhost:${existing.cdpPort}`;
    return {
      browser: existing.context.browser(),
      context: existing.context,
      cdpEndpoint,
      close: async () => {
        const state = await existing.context.storageState();
        await storage.saveState(profile, state);
        await storage.updateMeta(profile, { lastUsed: Date.now() });
        const pid = existing.context.browser().osProcess()?._process?.pid ?? null;
        await existing.context.close();
        if (pid) await waitForExit(pid);
        pool.remove(profile);
      },
    };
  }

  await storage.ensureSessionsDir();

  const savedMeta = await storage.loadMeta(profile);
  const savedConfig = savedMeta?.config ?? {};

  // If an explicit preset is given, it resets the baseline — savedConfig is bypassed
  // for preset-derived fields. Individual field overrides (userAgent etc.) always win.
  const resolved = resolvePreset(presetName ?? savedMeta?.preset);
  const base = presetName ? {} : savedConfig;

  const effectiveViewport = viewport || base.viewport || resolved.viewport || cfg.viewport;
  const effectiveUserAgent = userAgent || base.userAgent || resolved.userAgent || cfg.userAgent;
  const effectiveLocale = locale || base.locale || resolved.locale || cfg.locale;
  const effectiveTimezone = timezone || base.timezone || resolved.timezone || cfg.timezone;
  const effectiveStealth = stealth ?? savedConfig.stealth ?? cfg.stealthEnabled;
  const effectiveHeadless = headless ?? savedConfig.headless ?? cfg.headless;

  const presetConfig = {
    userAgent: effectiveUserAgent,
    locale: effectiveLocale,
    overrideUserAgent: resolved.overrideUserAgent,
  };

  const userDataDir = storage.getUserDataDir(profile);

  const launchFn = _launchImpl ?? _launchPersistentContext;
  const context = await launchFn(userDataDir, {
    stealth: effectiveStealth,
    presetConfig,
    viewport: effectiveViewport,
    userAgent: effectiveUserAgent,
    locale: effectiveLocale,
    timezoneId: effectiveTimezone,
    headless: effectiveHeadless,
    cdpPort: 0,
  });

  const cdpPort = await storage.readDevToolsPort(userDataDir);

  // Restore saved state (cookies + localStorage)
  const savedState = await storage.loadState(profile);
  if (savedState) {
    if (savedState.cookies?.length) {
      try {
        await context.addCookies(savedState.cookies);
        log(`Restored ${savedState.cookies.length} cookies for ${profile}`);
      } catch (err) {
        log(`Cookie restore failed for ${profile}: ${err.message}`);
      }
    }
    if (savedState.origins?.length) {
      const origins = savedState.origins;
      await context.addInitScript(savedOrigins => {
        const origin = location.origin;
        const entry = savedOrigins.find(o => o.origin === origin);
        if (!entry?.localStorage?.length) return;
        for (const { name, value } of entry.localStorage) {
          // eslint-disable-next-line no-empty -- runs in browser init script; cross-origin setItem throws, no Node logging available
          try { localStorage.setItem(name, value); } catch {}
        }
      }, origins);
      log(`Restored localStorage for ${savedState.origins.length} origin(s) in ${profile}`);
    }
  }

  // Mask iframe fingerprints
  await context.addInitScript(() => {
    const originalCreateElement = document.createElement;
    document.createElement = function (tag) {
      return originalCreateElement.call(document, tag);
    };
  });

  context.on('close', () => {
    log(`Context ${profile} was closed`);
    if (pool.has(profile)) pool.remove(profile);
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  pool.add(profile, context, page, cdpPort, resolved.preset, resolved.label, false, null);

  const meta = {
    sessionName: profile,
    created: savedMeta?.created ?? Date.now(),
    lastUsed: Date.now(),
    preset: resolved.preset,
    label: resolved.label,
    config: {
      userAgent: effectiveUserAgent,
      viewport: effectiveViewport,
      locale: effectiveLocale,
      timezone: effectiveTimezone,
      stealth: effectiveStealth,
      headless: effectiveHeadless,
    },
    userDataDir,
  };
  await storage.saveMeta(profile, meta);

  const cdpEndpoint = `http://localhost:${cdpPort}`;


  return {
    browser: context.browser(),
    context,
    cdpEndpoint,
    close: async () => {
      const state = await context.storageState();
      await storage.saveState(profile, state);
      await storage.updateMeta(profile, { lastUsed: Date.now() });
      const pid = context.browser().osProcess()?._process?.pid ?? null;
      await context.close();
      if (pid) await waitForExit(pid);
      pool.remove(profile);
    },
  };
};

/**
 * Launch an ephemeral clone of a template session.
 * No state is saved on close; the clone dir is deleted.
 *
 * @param {object} [options]
 * @param {string} [options.profile]       Template session name to clone
 * @param {Function} [options._launchImpl] Test seam — replaces _launchPersistentContext
 * @returns {Promise<{ browser, context, cdpEndpoint, cloneId, close(): Promise<void> }>}
 */
export const launchClone = async (options = {}) => {
  const { profile = 'default', _launchImpl, ...launchOpts } = options;

  ensureGcOnExit();
  await checkBrowser();
  await storage.cleanupClones();
  await storage.ensureSessionsDir();

  const templateDir = storage.getUserDataDir(profile);
  const { cloneId, dir: cloneDir, lease } = await storage.cloneProfileAtomic(templateDir, profile);

  const launchFn = _launchImpl ?? _launchPersistentContext;
  const context = await launchFn(cloneDir, { ...launchOpts, cdpPort: 0 });

  const cdpPort    = await storage.readDevToolsPort(cloneDir);
  const cdpEndpoint = `http://localhost:${cdpPort}`;

  const pages = context.pages();
  const page  = pages.length > 0 ? pages[0] : await context.newPage();

  pool.add(cloneId, context, page, cdpPort, null, null, true, cloneDir, profile, lease);

  return {
    browser: context.browser(),
    context,
    cdpEndpoint,
    cloneId,
    close: async () => {
      const pid = context.browser().osProcess()?._process?.pid ?? null;
      await context.close();
      if (pid) await waitForExit(pid);
      pool.remove(cloneId);
      await lease.close().catch(() => {});
      await rm(cloneDir, { recursive: true, force: true });
    },
  };
};

/**
 * Connect to an already-running browser via CDP endpoint.
 *
 * @param {string} cdpEndpoint
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext }>}
 */
export const connect = async cdpEndpoint => {
  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const contexts = browser.contexts();
  const context = contexts[0] ?? (await browser.newContext());
  return { browser, context };
};
