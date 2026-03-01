// Session management helpers for callers that don't hold the launch() handle.

import * as pool from './pool.js';
import * as storage from './storage.js';
import { log } from './logger.js';

/**
 * Close a session by profile name.
 * Saves state, closes the context, removes from pool.
 */
export const closeSession = async profile => {
  try {
    const session = pool.get(profile);

    const state = await session.context.storageState();
    await storage.saveState(profile, state);
    await storage.updateMeta(profile, { lastUsed: Date.now() });
    await session.context.close();
    pool.remove(profile);

    return { success: true, profile };
  } catch (err) {
    if (pool.has(profile)) pool.remove(profile);

    if (err.message?.includes('closed')) {
      log(`Session ${profile} was already closed`);
      return { success: true, profile, alreadyClosed: true };
    }

    throw err;
  }
};

/**
 * Get a session entry from the pool.
 * Returns { context, page, cdpPort, preset, label, createdAt }.
 */
export const getSession = profile => pool.get(profile);

/**
 * List all active sessions in pool.
 */
export const listSessions = () => pool.list();

/**
 * List all session IDs stored on disk (active or inactive).
 */
export const listStoredSessions = () => storage.listSessions();

/**
 * Update session metadata on disk (e.g. lastUrl after navigation).
 */
export const updateSessionMeta = (profile, updates) => storage.updateMeta(profile, updates);

/**
 * Delete a session's storage from disk (profile dir, state.json, meta.json).
 * If the session is open, it is closed first.
 */
export const deleteStoredSession = async profile => {
  if (pool.has(profile)) {
    await closeSession(profile).catch(() => {});
  }
  await storage.deleteSession(profile);
};

/**
 * Close all open sessions (used on server shutdown).
 */
export const closeAllSessions = () => pool.closeAll();

/**
 * Update the active page for a session (e.g. after tabs.select switches focus).
 */
export const updateSessionPage = (profile, page) => {
  const session = pool.get(profile);
  pool.add(profile, session.context, page, session.cdpPort, session.preset, session.label);
};
