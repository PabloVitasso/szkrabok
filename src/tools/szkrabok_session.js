import { readFileSync } from 'node:fs';

import {
  launch,
  launchClone,
  closeSession,
  destroyClone,
  getSession,
  listRuntimeSessions,
  listStoredSessions,
  updateSessionMeta,
  deleteStoredSession,
} from '#runtime';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url))
);

import { log } from '../utils/logger.js';
import { getConfig } from '../config.js';
import { withLock } from '../utils/lock.js';

/* ───────────────────────────────────────── */

const PRESET_EXCLUSIVE = new Set(['userAgent', 'viewport', 'locale', 'timezone']);

/* ───────────────────────────────────────── */

const safeGetSession = (id) => {
  try {
    return getSession(id);
  } catch {
    return null;
  }
};

const navigate = (page, url) =>
  page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: getConfig().timeout,
  });

const matchGlob = (name, pattern) => {
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*') +
      '$'
  );
  return regex.test(name);
};

function validateLaunchOptions(opts = {}) {
  if (!opts.preset) return;

  const conflicts = [...PRESET_EXCLUSIVE].filter(k => opts[k] !== undefined);

  if (conflicts.length) {
    throw new Error(
      `launchOptions: preset is mutually exclusive with ${conflicts.join(', ')}`
    );
  }
}

/* ───────────────────────────────────────── */
/* OPEN (unchanged API)                      */
/* ───────────────────────────────────────── */

export const open = ({ sessionName, url, launchOptions = {} }) => {
  validateLaunchOptions(launchOptions);

  const { isClone, _launchImpl, headless, stealth } = launchOptions;

  return withLock(sessionName, async () => {
    // ── CLONE ─────────────────────────
    if (isClone) {
      log(`[INFO] open clone: ${sessionName}`);

      const active = safeGetSession(sessionName);
      if (active) {
        throw new Error(
          `cannot clone "${sessionName}" while it is open`
        );
      }

      const handle = await launchClone({
        profile: sessionName,
        _launchImpl,
        headless,
        stealth,
      });

      return {
        success:         true,
        sessionName:     handle.cloneId,
        templateSession: sessionName,
        isClone:         true,
        cdpEndpoint:     handle.cdpEndpoint,
      };
    }

    // ── TEMPLATE ──────────────────────

    let session = safeGetSession(sessionName);
    let reused = false;

    if (session) {
      reused = true;
      log(`[DEBUG] reuse: ${sessionName}`);
    }

    if (!session) {
      log(`[INFO] launch template: ${sessionName}`);

      let handle;
      try {
        handle = await launch({
          profile:      sessionName,
          preset:       launchOptions.preset,
          headless,
          stealth,
          userAgent:    launchOptions.userAgent,
          viewport:     launchOptions.viewport,
          locale:       launchOptions.locale,
          timezone:     launchOptions.timezone,
          reuse:        false,
          _launchImpl,
        });
      } catch (err) {
        const msg = err?.message ?? '';
        if (msg.includes('Executable') || msg.includes('executable') || msg.includes('chromium') || msg.includes('browser')) {
          throw new Error(
            `Chromium not found. Run "npx @pablovitasso/szkrabok --setup" in your terminal, then restart the MCP server. (Original error: ${msg})`,
            { cause: err }
          );
        }
        throw err;
      }

      session = getSession(sessionName);

      if (!session) {
        log(`[FATAL] session missing after launch`);
        throw new Error(`Session inconsistency`);
      }

      if (url) {
        await navigate(session.page, url);
        await updateSessionMeta(sessionName, { lastUrl: url });
      }

      return {
        success:     true,
        sessionName,
        url,
        isClone:     false,
        preset:      session.preset,
        label:       session.label,
        cdpEndpoint: handle.cdpEndpoint,
      };
    }

    if (url) {
      await navigate(session.page, url);
      await updateSessionMeta(sessionName, { lastUrl: url });
    }

    return {
      success:  true,
      sessionName,
      url,
      isClone:  false,
      reused,
      preset:   session.preset,
      label:    session.label,
    };
  });
};

/* ───────────────────────────────────────── */
/* CLOSE (unchanged API)                     */
/* ───────────────────────────────────────── */

export const close = ({ sessionName }) =>
  withLock(sessionName, async () => {
    const s = safeGetSession(sessionName);
    const isClone = s ? s.isClone : false;

    if (isClone) {
      log(`[INFO] close clone: ${sessionName}`);
      const result = await destroyClone(sessionName);
      return { ...result, sessionName };
    }

    log(`[INFO] close template: ${sessionName}`);
    return { ...(await closeSession(sessionName)), sessionName };
  });

/* ───────────────────────────────────────── */

export const endpoint = async ({ sessionName }) => {
  const session = getSession(sessionName);
  const cdpEndpoint = `http://localhost:${session.cdpPort}`;

  try {
    const res = await fetch(`${cdpEndpoint}/json/version`);
    const { webSocketDebuggerUrl } = await res.json();

    return {
      sessionName,
      cdpEndpoint,
      wsEndpoint: webSocketDebuggerUrl,
    };
  } catch {
    return { sessionName, cdpEndpoint };
  }
};

/* ───────────────────────────────────────── */

export const deleteSession = async ({ sessionName }) => {
  // ── Glob mode ────────────────────────────────────────────────────────────────
  if (sessionName.includes('*')) {
    const stored = await listStoredSessions();
    const matched = stored.filter(id => matchGlob(id, sessionName));
    if (matched.length === 0) return { success: true, sessionName, deleted: [] };
    log(`[INFO] deleteSession glob "${sessionName}" matches [${matched.join(', ')}]`);
    const deleted = [];
    const errors = [];
    for (const id of matched) {
      try {
        await withLock(id, () => deleteStoredSession(id));
        deleted.push(id);
      } catch (err) {
        errors.push({ sessionName: id, error: err.message });
      }
    }
    return { success: errors.length === 0, sessionName, deleted, errors };
  }

  // ── Exact-name mode ─────────────────────────────────────────────────────────
  return withLock(sessionName, async () => {
    const s = safeGetSession(sessionName);
    if (s && s.isClone) {
      throw new Error(`deleteSession(): "${sessionName}" is a clone session — use close() instead`);
    }

    log(`[INFO] deleteSession: ${sessionName}`);
    await deleteStoredSession(sessionName);

    return { success: true, sessionName };
  });
};

/* ───────────────────────────────────────── */

export const list = async () => {
  log('[INFO] list sessions');

  const activeMap = new Map(
    listRuntimeSessions().map(s => [s.id, s])
  );

  const stored = await listStoredSessions();
  const storedSet = new Set(stored);

  const templateSessions = stored.map(id => {
    const a = activeMap.get(id);
    return {
      id,
      active:  !!a,
      isClone: false,
      preset:  a?.preset ?? null,
      label:   a?.label ?? null,
    };
  });

  const cloneSessions = listRuntimeSessions()
    .filter(s => s.isClone && !storedSet.has(s.id))
    .map(s => ({
      id:              s.id,
      active:          true,
      isClone:         true,
      templateSession: s.templateName,
      preset:          s.preset,
      label:           s.label,
    }));

  log(`[INFO] list(): ${templateSessions.length} templates, ${cloneSessions.length} clones`);

  return {
    sessions: [...templateSessions, ...cloneSessions],
    server:   { version, source: process.argv[1] },
  };
};

/* ───────────────────────────────────────── */

const ACTION_MAP = {
  open:     ({ action: _, ...rest }) => open(rest),
  close:    ({ action: _, ...rest }) => close(rest),
  list:     () => list(),
  delete:   ({ action: _, ...rest }) => deleteSession(rest),
  endpoint: ({ action: _, ...rest }) => endpoint(rest),
};

export const manage = async (args) => {
  const { action } = args;
  const handler = ACTION_MAP[action];
  if (!handler) throw new Error(`Unknown session action: ${action}`);
  return handler(args);
};
