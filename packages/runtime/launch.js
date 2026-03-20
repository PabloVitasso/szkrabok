// launch.js — the one true browser bootstrap entry point.
// Only this file calls launchPersistentContext.

import { chromium } from 'playwright';
import {
  resolvePreset,
  findChromiumPath,
  getConfig,
} from './config.js';
import { enhanceWithStealth, applyStealthToExistingPage } from './stealth.js';
import * as storage from './storage.js';
import { rmWithRetry } from './storage.js';
import * as pool from './pool.js';
import { computeConfigHash } from './sessions.js';
import { log } from './logger.js';

let _gcRegistered = false;
const ensureGcOnExit = () => {
  if (_gcRegistered) return;
  _gcRegistered = true;
  // once: cleanupClones schedules I/O which re-empties the loop — process.on
  // would fire again indefinitely. once fires exactly once then self-removes.
  process.once('beforeExit', () => storage.cleanupClones().catch(() => {}));
};

// ── tryBrowserPid ─────────────────────────────────────────────────────────────
//
// Attempts to extract the real Chromium OS process PID from the Playwright
// Browser object. This is inherently best-effort — the public API
// (browser.process()) only exists when the browser was launched via
// launchServer(); the private API (osProcess()._process.pid) may not exist
// in all Playwright versions or browser forks.
//
// Guards against the Node.js global `process` shadowing a non-existent
// browser.process method in ES module scope (process is a free variable).
//
// Returns a pid number or null.

const tryBrowserPid = browser => {
  try {
    if ('process' in browser) {
      const p = browser.process;
      if (typeof p === 'function') {
        let result;
        try {
          const ret = p();
          if (ret !== null && ret !== undefined && ret.pid !== null && ret.pid !== undefined) {
            result = ret.pid;
          } else {
            result = null;
          }
        } catch {
          result = null;
        }
        return result;
      }
    }
  } catch { /* not a browser.process() instance */ }
  try {
    let osProc;
    try {
      osProc = browser.osProcess();
    } catch {
      osProc = null;
    }
    if (osProc === null || osProc === undefined) {
      return null;
    }
    let proc;
    if (osProc._process !== null && osProc._process !== undefined) {
      proc = osProc._process;
    } else {
      return null;
    }
    if (proc.pid !== null && proc.pid !== undefined) {
      return proc.pid;
    } else {
      return null;
    }
  } catch {
    return null;
  }
};

// ── waitForExit ───────────────────────────────────────────────────────────────
//
// Defence-in-depth safety net. The primary directory-removal guard is
// rmWithRetry (storage.js) — a retry loop that does not depend on Chrome PID
// lifecycle and handles child processes (gpu, utility, network service) that
// may hold file locks after the root PID exits. waitForExit shortens the
// typical case where Chrome does exit promptly.
//
// Chromium is multi-process — the browser process exits when Playwright calls
// context.close(), but the actual Chrome process may linger briefly while
// releasing locks on the user data dir.
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
  const pw = (() => { if (options.stealth) return enhanceWithStealth(chromium, presetConfig); return chromium; })();
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
        const pid = existing.pid;
        await existing.context.close();
        if (pid) await waitForExit(pid);
        pool.remove(profile);
      },
    };
  }

  await storage.ensureSessionsDir();

  const savedMeta = await storage.loadMeta(profile);
  let savedConfig;
  if (savedMeta !== null && savedMeta !== undefined && savedMeta.config !== null && savedMeta.config !== undefined) {
    savedConfig = savedMeta.config;
  } else {
    savedConfig = {};
  }

  // If an explicit preset is given, it resets the baseline — savedConfig is bypassed
  // for preset-derived fields. Individual field overrides (userAgent etc.) always win.
  let presetArg;
  if (presetName !== null && presetName !== undefined) {
    presetArg = presetName;
  } else {
    if (savedMeta !== null && savedMeta !== undefined && savedMeta.preset !== null && savedMeta.preset !== undefined) {
      presetArg = savedMeta.preset;
    } else {
      presetArg = null;
    }
  }
  const resolved = resolvePreset(presetArg);
  const base = (() => { if (presetName) return {}; return savedConfig; })();

  const effectiveViewport = viewport || base.viewport || resolved.viewport || cfg.viewport;
  const effectiveUserAgent = userAgent || base.userAgent || resolved.userAgent || cfg.userAgent;
  const effectiveLocale = locale || base.locale || resolved.locale || cfg.locale;
  const effectiveTimezone = timezone || base.timezone || resolved.timezone || cfg.timezone;
  const effectiveStealth = stealth ?? savedConfig.stealth ?? cfg.stealthEnabled;
  const effectiveHeadless = headless ?? savedConfig.headless ?? cfg.headless;

  // Compute stable config hash for mismatch detection (enforceLaunchOptionsMatch).
  const effectiveConfig = {
    userAgent: effectiveUserAgent,
    viewport: effectiveViewport,
    locale: effectiveLocale,
    timezone: effectiveTimezone,
    stealth: effectiveStealth,
    headless: effectiveHeadless,
    preset: presetName ?? savedMeta?.preset ?? null,
  };
  const configHash = computeConfigHash(effectiveConfig);

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
    let savedStateCookiesLength;
    if (savedState.cookies !== null && savedState.cookies !== undefined) {
      savedStateCookiesLength = savedState.cookies.length;
    } else {
      savedStateCookiesLength = 0;
    }
    if (savedStateCookiesLength > 0) {
      try {
        await context.addCookies(savedState.cookies);
        log(`Restored ${savedStateCookiesLength} cookies for ${profile}`);
      } catch (err) {
        log(`Cookie restore failed for ${profile}: ${err.message}`);
      }
    }
    let savedStateOriginsLength;
    if (savedState.origins !== null && savedState.origins !== undefined) {
      savedStateOriginsLength = savedState.origins.length;
    } else {
      savedStateOriginsLength = 0;
    }
    if (savedStateOriginsLength > 0) {
      const page = await context.newPage();
      for (const { origin, localStorage: items } of savedState.origins) {
        let itemsLength;
        if (items !== null && items !== undefined) {
          itemsLength = items.length;
        } else {
          itemsLength = 0;
        }
        if (itemsLength === 0) continue;
        await page.goto(origin + '/favicon.ico', { waitUntil: 'commit', timeout: 10_000 });
        await page.evaluate(itms => {
          for (const { name, value } of itms) {
            // eslint-disable-next-line no-empty -- cross-origin setItem throws; no Node logging
            try { localStorage.setItem(name, value); } catch {}
          }
        }, items);
        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      }
      await page.close();
      log(`Restored localStorage for ${savedStateOriginsLength} origin(s) in ${profile}`);
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
  let page;
  if (pages.length > 0) {
    page = pages[0];
  } else {
    page = await context.newPage();
  }

  pool.add(profile, context, page, cdpPort, resolved.preset, resolved.label, false, null, null, null,
    tryBrowserPid(context.browser()), configHash);

  const meta = {
    sessionName: profile,
    created: (savedMeta !== null && savedMeta !== undefined && savedMeta.created !== null && savedMeta.created !== undefined) ? savedMeta.created : Date.now(),
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
      const pid = pool.get(profile).pid;
      await context.close();
      if (pid) await waitForExit(pid);
      pool.remove(profile);
    },
  };
};

/**
 * Register a launched clone in the pool and return the standard close handle.
 * Shared by both launchClone and cloneFromLive.
 */
const _addCloneToPool = async (context, cloneId, cloneDir, templateName, lease) => {
  const cdpPort     = await storage.readDevToolsPort(cloneDir);
  const cdpEndpoint = `http://localhost:${cdpPort}`;

  const pages = context.pages();
  const page  = pages.length > 0 ? pages[0] : await context.newPage();

  pool.add(cloneId, context, page, cdpPort, null, null, true, cloneDir, templateName, lease,
    tryBrowserPid(context.browser()));

  return {
    browser: context.browser(),
    context,
    cdpEndpoint,
    cloneId,
    close: async () => {
      const pid = pool.get(cloneId).pid;
      await context.close();
      if (pid) await waitForExit(pid);
      pool.remove(cloneId);
      // rm first: lease is only scavenger fencing, not our own deletion guard.
      // Reversing the order prevents EPERM storms if both this and cleanupClones
      // race on the same directory.
      await rmWithRetry(cloneDir);
      await lease.close().catch(() => {});
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
  const context  = await launchFn(cloneDir, { ...launchOpts, cdpPort: 0 });

  return _addCloneToPool(context, cloneId, cloneDir, profile, lease);
};

/**
 * Clone a running template session without closing it.
 *
 * Captures in-memory browser state (cookies, localStorage) via CDP, copies the
 * profile directory, then launches a new browser from the copy with the captured
 * state applied. The template browser stays open.
 *
 * Caveats:
 * - Chrome may hold open file handles on the profile directory — the disk copy
 *   is best-effort. Callers needing full consistency should use "close-first".
 * - IndexedDB is not captured (storageState does not include it for non-isolated
 *   origins in this version). Only cookies and localStorage are transferred.
 *
 * @param {string} templateName   - The open template session to clone
 * @param {object} [launchOpts]   - Passed through to _launchPersistentContext
 * @param {Function} [_launchImpl] - Test seam
 * @returns {Promise<{ browser, context, cdpEndpoint, cloneId, close(): Promise<void> }>}
 */
export const cloneFromLive = async (templateName, launchOpts = {}, _launchImpl) => {
  const template = pool.get(templateName); // throws if not open

  ensureGcOnExit();
  await checkBrowser();
  await storage.cleanupClones();
  await storage.ensureSessionsDir();

  // Capture in-memory state from the live browser context before copying.
  // This includes cookies and localStorage that may not have been flushed to disk.
  const liveState = await template.context.storageState();

  const templateDir = storage.getUserDataDir(templateName);
  const { cloneId, dir: cloneDir, lease } = await storage.cloneProfileAtomic(templateDir, templateName);

  const launchFn = _launchImpl ?? _launchPersistentContext;
  const context  = await launchFn(cloneDir, {
    ...launchOpts,
    cdpPort: 0,
    storageState: liveState,
  });

  return _addCloneToPool(context, cloneId, cloneDir, templateName, lease);
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
