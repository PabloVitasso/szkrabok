import { launchPersistentContext, navigate } from '../upstream/wrapper.js';
import * as pool from '../core/pool.js';
import * as storage from '../core/storage.js';
import {
  resolvePreset,
  HEADLESS,
  VIEWPORT,
  USER_AGENT,
  LOCALE,
  TIMEZONE,
  STEALTH_ENABLED,
} from '../config.js';
import { log } from '../utils/logger.js';

// Derive a deterministic CDP port from session id.
// Range 20000–29999 — avoids common service ports, gives 10 000 slots.
const cdpPortForId = id => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return 20000 + (Math.abs(h) % 10000);
};

export const open = async args => {
  const { id, url, config = {} } = args;

  // If session already exists in pool, reuse it
  if (pool.has(id)) {
    log(`Reusing existing session: ${id}`);
    const session = pool.get(id);

    // Check if context is still alive
    try {
      if (session.context._closed || session.page.isClosed()) {
        log(`Session ${id} context was closed, removing from pool`);
        pool.remove(id);
      } else {
        // Session is alive, optionally navigate
        if (url) {
          await navigate(session.page, url);
          await storage.updateMeta(id, { lastUrl: url });
        }
        return {
          success: true,
          id,
          url,
          reused: true,
          preset: session.preset,
          label: session.label,
        };
      }
    } catch (err) {
      log(`Session ${id} check failed, removing from pool: ${err.message}`);
      pool.remove(id);
    }
  }

  await storage.ensureSessionsDir();

  // Load saved meta for this session id (may be null for new sessions).
  // Used to restore config when reopening a session without explicit args.
  const savedMeta = await storage.loadMeta(id);
  const savedConfig = savedMeta?.config ?? {};

  // Resolve preset: per-call config.preset → saved preset → TOML preset → TOML default
  const resolved = resolvePreset(config.preset ?? savedMeta?.preset);

  // Precedence: explicit call config → saved meta config → resolved preset → TOML default
  const effectiveViewport = config.viewport || savedConfig.viewport || resolved.viewport || VIEWPORT;
  const effectiveUserAgent = config.userAgent || savedConfig.userAgent || resolved.userAgent || USER_AGENT;
  const effectiveLocale = config.locale || savedConfig.locale || resolved.locale || LOCALE;
  const effectiveTimezone = config.timezone || savedConfig.timezone || resolved.timezone || TIMEZONE;
  const effectiveStealth = config.stealth ?? savedConfig.stealth ?? STEALTH_ENABLED;
  const effectiveHeadless = config.headless ?? savedConfig.headless ?? HEADLESS;

  // presetConfig is passed to enhanceWithStealth so the user-agent-override
  // evasion receives the correct identity (userAgent, locale) for this session.
  const presetConfig = {
    userAgent: effectiveUserAgent,
    locale: effectiveLocale,
    // overrideUserAgent from preset controls whether user-agent-override evasion
    // is active for this session. Defaults to TOML evasion enabled state.
    overrideUserAgent: config.overrideUserAgent ?? resolved.overrideUserAgent,
  };

  // Use userDataDir for complete profile persistence
  const userDataDir = storage.getUserDataDir(id);

  // Deterministic CDP port — same session id always maps to same port
  const cdpPort = cdpPortForId(id);

  // Launch persistent context
  const context = await launchPersistentContext(userDataDir, {
    stealth: effectiveStealth,
    presetConfig,
    viewport: effectiveViewport,
    userAgent: effectiveUserAgent,
    locale: effectiveLocale,
    timezoneId: effectiveTimezone,
    headless: effectiveHeadless,
    cdpPort,
  });

  // Add init script to mask iframe fingerprints
  await context.addInitScript(() => {
    const originalCreateElement = document.createElement;
    document.createElement = function (tag) {
      const el = originalCreateElement.call(document, tag);
      if (tag.toLowerCase() === 'iframe') {
        // Stealth is already applied by playwright-extra
      }
      return el;
    };
  });

  // Listen for context close event (e.g., user manually closes browser)
  context.on('close', () => {
    log(`Context ${id} was closed manually or by user`);
    if (pool.has(id)) {
      pool.remove(id);
    }
  });

  // launchPersistentContext creates a context with existing pages
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  pool.add(id, context, page, cdpPort, resolved.preset, resolved.label);

  const meta = {
    id,
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
  await storage.saveMeta(id, meta);

  if (url) {
    await navigate(page, url);
    await storage.updateMeta(id, { lastUrl: url });
  }

  // Return full resolved config so caller knows exactly what was applied
  return {
    success: true,
    id,
    url,
    preset: resolved.preset,
    label: resolved.label,
    config: {
      userAgent: effectiveUserAgent,
      viewport: effectiveViewport,
      locale: effectiveLocale,
      timezone: effectiveTimezone,
      stealth: effectiveStealth,
    },
  };
};

export const close = async args => {
  const { id } = args;

  // Wrap with error handling in case context is already closed
  try {
    const session = pool.get(id);

    // userDataDir automatically persists everything, no need to save storageState
    // Just update metadata and close
    await storage.updateMeta(id, { lastUsed: Date.now() });
    await session.context.close();
    pool.remove(id);

    return { success: true, id };
  } catch (err) {
    // If context is already closed or session not found, just remove from pool
    if (pool.has(id)) {
      pool.remove(id);
    }

    if (err.message?.includes('closed')) {
      log(`Session ${id} was already closed`);
      return { success: true, id, alreadyClosed: true };
    }

    throw err;
  }
};

export const list = async () => {
  const active = pool.list();
  const stored = await storage.listSessions();

  const sessions = stored.map(id => {
    const isActive = active.find(a => a.id === id);
    return {
      id,
      active: !!isActive,
      preset: isActive?.preset,
      label: isActive?.label,
      viewport: isActive?.viewport,
    };
  });

  return { sessions };
};

export const endpoint = async args => {
  const { id } = args;
  const session = pool.get(id);

  const cdpEndpoint = `http://localhost:${session.cdpPort}`;

  return {
    sessionId: id,
    cdpEndpoint,
    // Connect from Playwright: chromium.connectOverCDP(cdpEndpoint)
  };
};

export const deleteSession = async args => {
  const { id } = args;

  if (pool.has(id)) {
    await close({ id });
  }

  await storage.deleteSession(id);
  return { success: true, id };
};
