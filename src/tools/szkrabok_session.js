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

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));

import { log } from '../utils/logger.js';
import { getConfig } from '../config.js';

const PRESET_EXCLUSIVE = new Set(['userAgent', 'viewport', 'locale', 'timezone']);

const navigate = (page, url) =>
  page.goto(url, { waitUntil: 'domcontentloaded', timeout: getConfig().timeout });

function validateLaunchOptions(opts = {}) {
  if (!opts.preset) return;

  const conflicts = [];
  for (const k of PRESET_EXCLUSIVE) {
    if (opts[k] !== undefined) conflicts.push(k);
  }

  if (conflicts.length)
    throw new Error(
      `launchOptions: preset is mutually exclusive with ${conflicts.join(
        ', '
      )}. Use preset OR individual fields.`
    );
}

export const open = async ({ sessionName, url, launchOptions = {} }) => {
  validateLaunchOptions(launchOptions);

  const { isClone, _launchImpl } = launchOptions;

  // ── Clone branch ──────────────────────────────────────────────────────────
  if (isClone) {
    log(`open(): launching clone of template "${sessionName}"`);
    // Guard: template session must not be open — concurrent access corrupts the profile copy.
    let templateOpen = false;
    try { getSession(sessionName); templateOpen = true; } catch { /* not open */ }
    if (templateOpen) {
      throw new Error(`open(): cannot clone "${sessionName}" while it is open — close the session first`);
    }

    const handle = await launchClone({ profile: sessionName, _launchImpl });
    log(`open(): clone launched: ${handle.cloneId}`);
    return {
      success:         true,
      sessionName:     handle.cloneId,
      templateSession: sessionName,
      isClone:         true,
      cdpEndpoint:     handle.cdpEndpoint,
    };
  }

  // ── Template branch ───────────────────────────────────────────────────────
  let session;
  let reused = false;

  try {
    session = getSession(sessionName);
    reused = true;
    log(`open(): reusing existing session: ${sessionName}`);
  } catch (e) {
    log(`open(): session '${sessionName}' not found, will create: ${e.message}`);
  }

  if (!session) {
    const {
      preset,
      headless,
      stealth,
      userAgent,
      viewport,
      locale,
      timezone,
    } = launchOptions;

    let handle;
    try {
      handle = await launch({
        profile: sessionName,
        preset,
        headless,
        stealth,
        userAgent,
        viewport,
        locale,
        timezone,
        reuse: false,
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
    success:     true,
    sessionName,
    url,
    isClone:     false,
    reused,
    preset:      session.preset,
    label:       session.label,
  };
};

export const close = async ({ sessionName }) => {
  log(`close(): closing session "${sessionName}"`);
  let isClone = false;
  try {
    const s = getSession(sessionName);
    isClone = !!s.isClone;
  } catch { /* session does not exist yet */ }

  if (isClone) {
    log(`close(): routing to destroyClone for clone "${sessionName}"`);
    const result = await destroyClone(sessionName);
    return { ...result, sessionName };
  }

  log(`close(): routing to closeSession for template "${sessionName}"`);
  return { ...(await closeSession(sessionName)), sessionName };
};

export const list = async () => {
  log('list(): building session list');
  const activeMap = new Map(
    listRuntimeSessions().map(s => [s.id, s])
  );

  const stored = await listStoredSessions();
  const storedSet = new Set(stored);

  // Template sessions from disk (active or inactive).
  const templateSessions = stored.map(id => {
    const a = activeMap.get(id);
    return {
      id,
      active:  !!a,
      isClone: false,
      preset:  a?.preset,
      label:   a?.label,
    };
  });

  // Active clone sessions — live in pool only, no disk entry.
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

  log(`list(): ${templateSessions.length} templates, ${cloneSessions.length} clones`);
  return {
    sessions: [...templateSessions, ...cloneSessions],
    server:   { version, source: process.argv[1] },
  };
};

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

export const deleteSession = async ({ sessionName }) => {
  log(`deleteSession(): deleting session "${sessionName}"`);
  // Guard: clones live only in the pool and have no disk entry to delete.
  // Caller must use close() to destroy a clone and reclaim its clone dir.
  try {
    const s = getSession(sessionName);
    if (s.isClone) {
      throw new Error(`deleteSession(): "${sessionName}" is a clone session — use close() instead`);
    }
  } catch (err) {
    if (err.code !== 'SESSION_NOT_FOUND') throw err;
    // Not in pool → ordinary stored session, proceed.
  }
  await deleteStoredSession(sessionName);
  return { success: true, sessionName };
};

const ACTION_MAP = {
  open: ({ action: _, ...rest }) => open(rest),
  close: ({ action: _, ...rest }) => close(rest),
  list: () => list(),
  delete: ({ action: _, ...rest }) => deleteSession(rest),
  endpoint: ({ action: _, ...rest }) => endpoint(rest),
};

export const manage = async (args) => {
  const { action } = args;
  const handler = ACTION_MAP[action];
  if (!handler) throw new Error(`Unknown session action: ${action}`);
  return handler(args);
};
