// Session management helpers for callers that don't hold the launch() handle.

import { rm } from 'fs/promises';
import { createHash } from 'crypto';
import * as pool from './pool.js';
import * as storage from './storage.js';
import { log } from './logger.js';

// Fields that matter for launchOptions comparison.
// Omit transient/derived fields like pid, leaseHandle, cloneDir.
const CONFIG_FIELDS = ['userAgent', 'viewport', 'locale', 'timezone', 'stealth', 'headless', 'preset'];

/**
 * Compute a stable hash of effective launch config for mismatch detection.
 * Used by launch() to store on pool entries and by session_run_test to
 * compare against caller's supplied options.
 *
 * @param {object|null} config - resolved effective config, or null
 * @returns {string|null} 16-char hex prefix of SHA-256, or null if config is null
 */
export const computeConfigHash = config => {
  if (!config) return null;
  const subset = {};
  for (const k of CONFIG_FIELDS) {
    if (config[k] !== undefined) subset[k] = config[k];
  }
  // Stable key order for reproducible serialization
  const serialized = JSON.stringify(subset, Object.keys(subset).sort());
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
};

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

    let errMessage;
    if (err !== null && err !== undefined && err.message !== null && err.message !== undefined) {
      errMessage = err.message;
    } else {
      errMessage = null;
    }
    if (errMessage !== null && errMessage.includes('closed')) {
      log(`Session ${profile} was already closed`);
      return { success: true, profile, alreadyClosed: true };
    }

    throw err;
  }
};

/**
 * Get a session entry from the pool.
 * Returns { context, page, cdpPort, preset, label, createdAt, isClone, cloneDir, templateName, leaseHandle, pid, configHash }.
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
 * Destroy a clone session: close context, remove from pool, delete clone dir.
 * Throws if called with a template session id.
 */
export const destroyClone = async cloneId => {
  const session = pool.get(cloneId); // throws SessionNotFoundError if absent

  if (!session.isClone) {
    throw new Error(`destroyClone: "${cloneId}" is a template session — use closeSession instead`);
  }

  await session.context.close();
  pool.remove(cloneId);

  if (session.leaseHandle) await session.leaseHandle.close().catch(() => {});
  if (session.cloneDir) {
    await rm(session.cloneDir, { recursive: true, force: true });
  }

  return { success: true, cloneId };
};

/**
 * Update the active page for a session (e.g. after tabs.select switches focus).
 */
export const updateSessionPage = (profile, page) => {
  const session = pool.get(profile);
  pool.add(profile, session.context, page, session.cdpPort, session.preset, session.label,
    session.isClone, session.cloneDir, session.templateName, session.leaseHandle, session.pid,
    session.configHash);
};
