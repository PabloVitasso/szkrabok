import {
  launch,
  closeSession,
  getSession,
  listRuntimeSessions,
  listStoredSessions,
  updateSessionMeta,
  deleteStoredSession,
} from '#runtime';

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

  let session;
  let reused = false;

  try {
    session = getSession(sessionName);
    reused = true;
    log(`Reusing existing session: ${sessionName}`);
  } catch {}

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
      });
    } catch (err) {
      const msg = err?.message ?? '';
      if (msg.includes('Executable') || msg.includes('executable') || msg.includes('chromium') || msg.includes('browser')) {
        throw new Error(
          `Chromium not found. Run "npx @pablovitasso/szkrabok --setup" in your terminal, then restart the MCP server. (Original error: ${msg})`
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
      success: true,
      sessionName,
      url,
      preset: session.preset,
      label: session.label,
      cdpEndpoint: handle.cdpEndpoint,
    };
  }

  if (url) {
    await navigate(session.page, url);
    await updateSessionMeta(sessionName, { lastUrl: url });
  }

  return {
    success: true,
    sessionName,
    url,
    reused,
    preset: session.preset,
    label: session.label,
  };
};

export const close = async ({ sessionName }) => ({
  ...(await closeSession(sessionName)),
  sessionName,
});

export const list = async () => {
  const activeMap = new Map(
    listRuntimeSessions().map(s => [s.id, s])
  );

  const stored = await listStoredSessions();

  return {
    sessions: stored.map(id => {
      const a = activeMap.get(id);
      return {
        id,
        active: !!a,
        preset: a?.preset,
        label: a?.label,
      };
    }),
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
