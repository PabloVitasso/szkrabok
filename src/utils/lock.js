import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { log } from './logger.js';

const LOCK_DIR = path.join(os.tmpdir(), 'szkrabok-locks');
const LOCK_TTL = 60_000;
const LOCK_RETRY_DELAY = 100;
const LOCK_MAX_WAIT = 10_000;

const ensureLockDir = async () => {
  await fs.mkdir(LOCK_DIR, { recursive: true });
};

// Produce a collision-free, filesystem-safe lock filename.
// Sanitizes characters invalid on Windows, then appends an 8-char sha1 suffix
// derived from the raw id so that two names differing only in sanitized chars
// never share the same lock file.
const sanitizeLockId = (id) => {
  const safe   = id.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const suffix = createHash('sha1').update(id).digest('hex').slice(0, 8);
  return `${safe}-${suffix}`;
};

const lockPath = (id) => path.join(LOCK_DIR, `${sanitizeLockId(id)}.lock`);

/**
 * Blocking per-id file lock with retry. Cross-process safe.
 * Throws on timeout (default 10s).
 */
export const acquireLock = async (id) => {
  await ensureLockDir();

  const start = Date.now();

  while (true) {
    try {
      const handle = await fs.open(lockPath(id), 'wx');
      await handle.write(String(Date.now()));
      await handle.close();

      log(`[LOCK] acquired: ${id}`);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      let stale = false;

      try {
        const ts = Number(await fs.readFile(lockPath(id), 'utf8'));
        if (Date.now() - ts > LOCK_TTL) stale = true;
      } catch {
        stale = true;
      }

      if (stale) {
        log(`[WARN] stale lock detected: ${id}`);
        try { await fs.unlink(lockPath(id)); } catch { /* already removed */ }
        continue;
      }

      if (Date.now() - start > LOCK_MAX_WAIT) {
        log(`[ERROR] lock timeout: ${id}`);
        throw new Error(`Lock timeout for ${id}`);
      }

      await new Promise(r => setTimeout(r, LOCK_RETRY_DELAY));
    }
  }
};

/**
 * Acquire lock for `id`, run `fn`, release on completion or error.
 */
export const withLock = async (id, fn) => {
  await acquireLock(id);
  try {
    return await fn();
  } finally {
    await releaseLock(id);
  }
};

export const releaseLock = async (id) => {
  try {
    await fs.unlink(lockPath(id));
    log(`[LOCK] released: ${id}`);
  } catch {
    log(`[WARN] releaseLock: already removed ${id}`);
  }
};
