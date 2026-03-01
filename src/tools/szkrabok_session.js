import {
  launch,
  closeSession,
  getSession,
  listRuntimeSessions,
  listStoredSessions,
  updateSessionMeta,
  deleteStoredSession,
} from '@szkrabok/runtime';
import { log } from '../utils/logger.js';
import { TIMEOUT } from '../config.js';

const navigate = async (page, url) =>
  page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

export const open = async args => {
  const { sessionName, url, launchOptions = {} } = args;

  // Attempt to reuse existing session (idempotency)
  try {
    const existing = getSession(sessionName);
    log(`Reusing existing session: ${sessionName}`);
    if (url) {
      await navigate(existing.page, url);
      await updateSessionMeta(sessionName, { lastUrl: url });
    }
    return {
      success: true,
      sessionName,
      url,
      reused: true,
      preset: existing.preset,
      label: existing.label,
    };
  } catch {
    // Not in pool — launch fresh
  }

  // Delegate to runtime.launch() — handles storage, stealth, preset resolution, pool
  const handle = await launch({
    profile: sessionName,
    preset: launchOptions.preset,
    headless: launchOptions.headless,
    reuse: false,
  });

  if (url) {
    const session = getSession(sessionName);
    await navigate(session.page, url);
    await updateSessionMeta(sessionName, { lastUrl: url });
  }

  const session = getSession(sessionName);

  return {
    success: true,
    sessionName,
    url,
    preset: session.preset,
    label: session.label,
    cdpEndpoint: handle.cdpEndpoint,
  };
};

export const close = async args => {
  const { sessionName } = args;
  const result = await closeSession(sessionName);
  return { ...result, sessionName };
};

export const list = async () => {
  const active = listRuntimeSessions();
  const stored = await listStoredSessions();

  const sessions = stored.map(id => {
    const isActive = active.find(a => a.id === id);
    return {
      id,
      active: !!isActive,
      preset: isActive?.preset,
      label: isActive?.label,
    };
  });

  return { sessions };
};

export const endpoint = async args => {
  const { sessionName } = args;
  const session = getSession(sessionName);
  return { sessionName, cdpEndpoint: `http://localhost:${session.cdpPort}` };
};

export const deleteSession = async args => {
  const { sessionName } = args;
  await deleteStoredSession(sessionName);
  return { success: true, sessionName };
};
