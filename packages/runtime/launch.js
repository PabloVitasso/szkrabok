// launch.js — the one true browser bootstrap entry point.
// Only this file calls launchPersistentContext.

import { chromium } from 'playwright';
import {
  resolvePreset,
  findChromiumPath,
  HEADLESS,
  VIEWPORT,
  USER_AGENT,
  LOCALE,
  TIMEZONE,
  STEALTH_ENABLED,
} from './config.js';
import { enhanceWithStealth, applyStealthToExistingPage } from './stealth.js';
import * as storage from './storage.js';
import * as pool from './pool.js';
import { log } from './logger.js';

// Derive a deterministic CDP port from session id.
// Range 20000–29999 — avoids common service ports, gives 10 000 slots.
const cdpPortForId = id => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return 20000 + (Math.abs(h) % 10000);
};

// _launchPersistentContext — internal, not exported.
// Only called by launch() below.
const _launchPersistentContext = async (userDataDir, options = {}) => {
  const presetConfig = options.presetConfig ?? {};
  const pw = options.stealth ? enhanceWithStealth(chromium, presetConfig) : chromium;
  const executablePath = findChromiumPath();

  if (executablePath) {
    log('Using existing Chromium for persistent context', { path: executablePath });
  }

  const launchOptions = {
    ...options,
    headless: options.headless ?? HEADLESS,
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

  if (launchOptions.cdpPort) {
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
export const launch = async (options = {}) => {
  const { profile = 'default', preset: presetName, headless, stealth, userAgent, viewport, locale, timezone, reuse = true } = options;

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
        await existing.context.close();
        pool.remove(profile);
      },
    };
  }

  await storage.ensureSessionsDir();

  const savedMeta = await storage.loadMeta(profile);
  const savedConfig = savedMeta?.config ?? {};

  const resolved = resolvePreset(presetName ?? savedMeta?.preset);

  const effectiveViewport = viewport || savedConfig.viewport || resolved.viewport || VIEWPORT;
  const effectiveUserAgent = userAgent || savedConfig.userAgent || resolved.userAgent || USER_AGENT;
  const effectiveLocale = locale || savedConfig.locale || resolved.locale || LOCALE;
  const effectiveTimezone = timezone || savedConfig.timezone || resolved.timezone || TIMEZONE;
  const effectiveStealth = stealth ?? savedConfig.stealth ?? STEALTH_ENABLED;
  const effectiveHeadless = headless ?? savedConfig.headless ?? HEADLESS;

  const presetConfig = {
    userAgent: effectiveUserAgent,
    locale: effectiveLocale,
    overrideUserAgent: resolved.overrideUserAgent,
  };

  const userDataDir = storage.getUserDataDir(profile);
  const cdpPort = cdpPortForId(profile);

  const context = await _launchPersistentContext(userDataDir, {
    stealth: effectiveStealth,
    presetConfig,
    viewport: effectiveViewport,
    userAgent: effectiveUserAgent,
    locale: effectiveLocale,
    timezoneId: effectiveTimezone,
    headless: effectiveHeadless,
    cdpPort,
  });

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

  pool.add(profile, context, page, cdpPort, resolved.preset, resolved.label);

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
      await context.close();
      pool.remove(profile);
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
