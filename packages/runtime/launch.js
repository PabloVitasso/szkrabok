// launch.js — the one true browser bootstrap entry point.
// Only this file calls launchPersistentContext.

import { chromium, firefox } from 'playwright';
import {
  resolvePreset,
  getConfig,
  getConfigSource,
  getConfigMeta,
} from './config.js';
import { resolveChromium, buildCandidates, populateCandidates, resolveFirefox } from './resolve.js';
import { BrowserNotFoundError } from './errors.js';
import { enhanceWithStealth, applyStealthToExistingPage } from './stealth.js';
import * as storage from './storage.js';
import { rmWithRetry } from './storage.js';
import * as pool from './pool.js';
import { computeConfigHash } from './sessions.js';
import { tryBrowserPid } from './pid.js';
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
// executablePath is passed in (resolved by checkBrowser before this is called).
const _launchPersistentContext = async (userDataDir, options = {}) => {
  const engine = options.browserEngine ?? 'chromium';
  const isFirefox = engine === 'firefox';
  const presetConfig = options.presetConfig ?? {};

  if (isFirefox && options.headless) {
    log('WARNING: headless:true with Firefox uses a detectable rendering path. ' +
        'For stealth use, set headless:false and provide a DISPLAY (Xvfb on Linux).');
  }

  const pw = (() => {
    if (isFirefox) return firefox;
    if (options.stealth) return enhanceWithStealth(chromium, presetConfig);
    return chromium;
  })();

  if (options.executablePath) {
    log(`Using ${isFirefox ? 'Firefox' : 'Chromium'} for persistent context`, { path: options.executablePath });
  }

  const launchOptions = {
    ...options,
    headless: options.headless ?? getConfig().headless,
    executablePath: options.executablePath,
    viewport: options.viewport,
    locale: options.locale,
    timezoneId: options.timezoneId,
    userAgent: options.userAgent,
  };

  delete launchOptions.stealth;
  delete launchOptions.presetConfig;
  delete launchOptions.browserEngine;

  if (isFirefox) {
    // Firefox: no Chromium-specific flags, no CDP port, no stealth shims.
    // Prefs suppress the about:newtab startup navigation that races with goto()
    // on invisible_playwright and some Firefox builds.
    launchOptions.firefoxUserPrefs = {
      'browser.startup.page': 0,        // blank page (not homepage or last session)
      'browser.newtabpage.enabled': false,
    };
    delete launchOptions.cdpPort;
    delete launchOptions.args;
  } else {
    launchOptions.args = [
      '--hide-crash-restore-bubble',
      '--disable-features=PortalActivationDelegate',
      '--password-store=basic',
      ...(launchOptions.args || []),
    ];
    if (launchOptions.cdpPort !== undefined) {
      launchOptions.args = [
        ...launchOptions.args,
        `--remote-debugging-port=${launchOptions.cdpPort}`,
      ];
      delete launchOptions.cdpPort;
    }
  }

  const context = await pw.launchPersistentContext(userDataDir, launchOptions);

  if (!isFirefox && options.stealth) {
    const pages = context.pages();
    if (pages.length > 0) {
      await applyStealthToExistingPage(pages[0], presetConfig);
    }
  }

  if (isFirefox) {
    // On a fresh (cold-start) profile, invisible_playwright/Firefox 150 fires an
    // internal about:newtab navigation shortly after launch that tears down the
    // initial page's browsingContext at the Juggler protocol level — invisible to
    // Playwright's own page/frame tracking (page.url() still reports "about:blank").
    // Any goto() on that initial page then fails, permanently, with either
    // "browsingContext is undefined" or "interrupted by another navigation to
    // about:newtab" — retrying goto() on the same page object does not recover it.
    // A page created *after* the race has already torn down the initial one is
    // unaffected. Swap the initial page out before any caller can get a reference
    // to it. See docs/features/20260526-firefox-engine-support-done.md.
    const initialPage = context.pages()[0];
    await context.newPage();
    await initialPage?.close().catch(() => {});
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
/**
 * Resolve the browser executable path for the configured engine.
 * For Firefox, uses resolveFirefox(). For Chromium, uses the existing candidate chain.
 * @returns {Promise<string>} resolved executable path
 */
export const checkBrowser = async () => {
  const config = getConfig();
  const configSource = getConfigSource();

  if (config.browserEngine === 'firefox') {
    const result = await resolveFirefox({ cacheDir: undefined, executablePath: config.executablePath });
    if (result.found) return result.path;
    throw new BrowserNotFoundError(
      { candidates: (result.checked ?? []).map(p => ({ source: 'firefox', path: p, ok: false })),
        configSource, configMeta: getConfigMeta() },
    );
  }

  const candidates = buildCandidates(config);
  const populated = await populateCandidates(candidates);
  const result = resolveChromium(populated);

  if (!result.found) {
    throw new BrowserNotFoundError(
      { candidates: result.candidates, configSource, configMeta: getConfigMeta() },
    );
  }
  return result.path;
};

/**
 * Resolve the effective launch config for a profile: merges per-call overrides,
 * saved meta from a previous launch, the resolved preset, and TOML defaults
 * (in that priority order), and derives the mismatch-detection config hash.
 */
const resolveEffectiveConfig = (cfg, savedMeta, { presetName, headless, stealth, userAgent, viewport, locale, timezone }) => {
  const savedConfig = savedMeta?.config ?? {};

  // If an explicit preset is given, it resets the baseline — savedConfig is bypassed
  // for preset-derived fields. Individual field overrides (userAgent etc.) always win.
  const presetArg = presetName ?? savedMeta?.preset ?? null;
  const resolved = resolvePreset(presetArg);
  const base = presetName ? {} : savedConfig;

  const effectiveViewport = viewport || base.viewport || resolved.viewport || cfg.viewport;
  const effectiveUserAgent = userAgent || base.userAgent || resolved.userAgent || cfg.userAgent;
  const effectiveLocale = locale || base.locale || resolved.locale || cfg.locale;
  const effectiveTimezone = timezone || base.timezone || resolved.timezone || cfg.timezone;
  const effectiveStealth = stealth ?? savedConfig.stealth ?? cfg.stealthEnabled;
  const effectiveHeadless = headless ?? savedConfig.headless ?? cfg.headless;

  // Compute stable config hash for mismatch detection (enforceLaunchOptionsMatch).
  const configHash = computeConfigHash({
    userAgent: effectiveUserAgent,
    viewport: effectiveViewport,
    locale: effectiveLocale,
    timezone: effectiveTimezone,
    stealth: effectiveStealth,
    headless: effectiveHeadless,
    preset: presetName ?? savedMeta?.preset ?? null,
  });

  const presetConfig = {
    userAgent: effectiveUserAgent,
    locale: effectiveLocale,
    overrideUserAgent: resolved.overrideUserAgent,
  };

  return {
    resolved, presetConfig, configHash,
    effectiveViewport, effectiveUserAgent, effectiveLocale, effectiveTimezone,
    effectiveStealth, effectiveHeadless,
  };
};

/**
 * Restore saved cookies and localStorage onto a freshly launched context.
 * Best-effort: a cookie/localStorage restore failure is logged, not thrown.
 */
const restoreSessionState = async (context, profile) => {
  const savedState = await storage.loadState(profile);
  if (!savedState) return;

  const cookiesLength = savedState.cookies?.length ?? 0;
  if (cookiesLength > 0) {
    try {
      await context.addCookies(savedState.cookies);
      log(`Restored ${cookiesLength} cookies for ${profile}`);
    } catch (err) {
      // addCookies is all-or-nothing — one malformed/expired cookie fails the
      // whole batch. Retry individually so the rest of the jar isn't lost.
      log(`Cookie batch restore failed for ${profile}: ${err.message} — retrying individually`);
      let restored = 0;
      for (const cookie of savedState.cookies) {
        try {
          await context.addCookies([cookie]);
          restored++;
        } catch (cookieErr) {
          log(`Skipping unrestorable cookie "${cookie.name}" for ${profile}: ${cookieErr.message}`);
        }
      }
      log(`Restored ${restored}/${cookiesLength} cookies individually for ${profile}`);
    }
  }

  const originsLength = savedState.origins?.length ?? 0;
  if (originsLength === 0) return;

  const page = await context.newPage();
  for (const { origin, localStorage: items } of savedState.origins) {
    const itemsLength = items?.length ?? 0;
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
  log(`Restored localStorage for ${originsLength} origin(s) in ${profile}`);
};

/**
 * Build the close() handle shared by the reuse-path and fresh-launch returns
 * from launch(). getPid is a thunk (not a value) so the fresh-launch path can
 * do a live pool lookup at close-time while the reuse path can use its
 * already-captured pid — preserving each path's original lookup timing.
 */
const makeCloseHandle = (profile, context, getPid) => async () => {
  const state = await context.storageState();
  await storage.saveState(profile, state);
  await storage.updateMeta(profile, { lastUsed: Date.now() });
  const pid = getPid();
  await context.close();
  if (pid) await waitForExit(pid);
  pool.remove(profile);
};

export const launch = async (options = {}) => {
  const { profile = 'default', preset: presetName, headless, stealth, userAgent, viewport, locale, timezone, reuse = true, _launchImpl } = options;
  const cfg = getConfig();
  const browserEngine = cfg.browserEngine ?? 'chromium';

  ensureGcOnExit();
  const executablePath = await checkBrowser();
  await storage.cleanupClones();

  // Idempotency: return existing handle when reuse=true and profile is open
  if (reuse && pool.has(profile)) {
    log(`Reusing existing session: ${profile}`);
    const existing = pool.get(profile);
    const cdpEndpoint = existing.cdpPort !== null ? `http://localhost:${existing.cdpPort}` : null;
    return {
      browser: existing.context.browser(),
      context: existing.context,
      cdpEndpoint,
      close: makeCloseHandle(profile, existing.context, () => existing.pid),
    };
  }

  await storage.ensureSessionsDir();

  const savedMeta = await storage.loadMeta(profile);
  const {
    resolved, presetConfig, configHash,
    effectiveViewport, effectiveUserAgent, effectiveLocale, effectiveTimezone,
    effectiveStealth, effectiveHeadless,
  } = resolveEffectiveConfig(cfg, savedMeta, { presetName, headless, stealth, userAgent, viewport, locale, timezone });

  const userDataDir = storage.getUserDataDir(profile);

  const launchFn = _launchImpl ?? _launchPersistentContext;
  const context = await launchFn(userDataDir, {
    browserEngine,
    stealth: browserEngine === 'firefox' ? false : effectiveStealth,
    presetConfig,
    viewport: effectiveViewport,
    userAgent: effectiveUserAgent,
    locale: effectiveLocale,
    timezoneId: effectiveTimezone,
    headless: effectiveHeadless,
    executablePath,
    cdpPort: browserEngine === 'firefox' ? undefined : 0,
  });

  const cdpPort = browserEngine === 'firefox' ? null : await storage.readDevToolsPort(userDataDir);

  await restoreSessionState(context, profile);

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

  pool.add({
    id: profile, context, page, cdpPort, preset: resolved.preset, label: resolved.label,
    pid: tryBrowserPid(context.browser()), configHash, browserEngine,
  });

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

  const cdpEndpoint = cdpPort !== null ? `http://localhost:${cdpPort}` : null;

  return {
    browser: context.browser(),
    context,
    cdpEndpoint,
    close: makeCloseHandle(profile, context, () => pool.get(profile).pid),
  };
};

/**
 * Register a launched clone in the pool and return the standard close handle.
 * Shared by both launchClone and cloneFromLive.
 */
const _addCloneToPool = async (context, cloneId, cloneDir, templateName, lease, browserEngine = 'chromium') => {
  const cdpPort     = browserEngine === 'firefox' ? null : await storage.readDevToolsPort(cloneDir);
  const cdpEndpoint = cdpPort !== null ? `http://localhost:${cdpPort}` : null;

  const pages = context.pages();
  const page  = pages.length > 0 ? pages[0] : await context.newPage();

  pool.add({
    id: cloneId, context, page, cdpPort, preset: null, label: null,
    isClone: true, cloneDir, templateName, leaseHandle: lease,
    pid: tryBrowserPid(context.browser()), browserEngine,
  });

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
 * Shared tail for launchClone and cloneFromLive: resolve the browser, copy the
 * template profile dir, launch a context from the copy, and register it in the pool.
 */
const _cloneAndLaunch = async (templateDir, templateName, launchOpts, _launchImpl, storageState) => {
  const browserEngine = getConfig().browserEngine ?? 'chromium';

  ensureGcOnExit();
  const executablePath = await checkBrowser();
  await storage.cleanupClones();
  await storage.ensureSessionsDir();

  const { cloneId, dir: cloneDir, lease } = await storage.cloneProfileAtomic(templateDir, templateName);

  const launchFn = _launchImpl ?? _launchPersistentContext;
  const context  = await launchFn(cloneDir, {
    ...launchOpts,
    executablePath,
    browserEngine,
    cdpPort: browserEngine === 'firefox' ? undefined : 0,
    ...(storageState !== undefined ? { storageState } : {}),
  });

  return _addCloneToPool(context, cloneId, cloneDir, templateName, lease, browserEngine);
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
  await storage.ensureProfileDir(profile);
  const templateDir = storage.getUserDataDir(profile);
  return _cloneAndLaunch(templateDir, profile, launchOpts, _launchImpl);
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

  // Capture in-memory state from the live browser context before copying.
  // This includes cookies and localStorage that may not have been flushed to disk.
  const liveState = await template.context.storageState();

  const templateDir = storage.getUserDataDir(templateName);
  return _cloneAndLaunch(templateDir, templateName, launchOpts, _launchImpl, liveState);
};

/**
 * Connect to an already-running browser via CDP endpoint. Chromium only — Firefox has no CDP.
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
