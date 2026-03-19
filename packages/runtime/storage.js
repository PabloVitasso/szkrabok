import { readFile, writeFile, mkdir, rm, readdir, copyFile, lstat, readlink, symlink, access, rename, open, cp } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import crypto from 'crypto';
import { log } from './logger.js';

// Sessions dir: SZKRABOK_SESSIONS_DIR env > cwd/sessions
const getSessionsDir = () =>
  process.env.SZKRABOK_SESSIONS_DIR ?? join(process.cwd(), 'sessions');

const getSessionDir = id => join(getSessionsDir(), id);
const getStatePath = id => join(getSessionDir(id), 'state.json');
const getMetaPath = id => join(getSessionDir(id), 'meta.json');

export const getUserDataDir = id => join(getSessionDir(id), 'profile');

export const ensureSessionsDir = async () => {
  const dir = getSessionsDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
};

export const sessionExists = id => existsSync(getSessionDir(id));

export const loadState = async id => {
  const path = getStatePath(id);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf-8'));
};

export const saveState = async (id, state) => {
  await mkdir(getSessionDir(id), { recursive: true });
  await writeFile(getStatePath(id), JSON.stringify(state, null, 2));
};

export const loadMeta = async id => {
  const path = getMetaPath(id);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf-8'));
};

export const saveMeta = async (id, meta) => {
  await mkdir(getSessionDir(id), { recursive: true });
  await writeFile(getMetaPath(id), JSON.stringify(meta, null, 2));
};

export const updateMeta = async (id, updates) => {
  const meta = (await loadMeta(id)) || {};
  const updated = { ...meta, ...updates, lastUsed: Date.now() };
  await saveMeta(id, updated);
  return updated;
};

export const deleteSession = async id => {
  const dir = getSessionDir(id);
  if (existsSync(dir)) {
    await rm(dir, { recursive: true });
  }
};

export const listSessions = async () => {
  await ensureSessionsDir();
  const dirs = await readdir(getSessionsDir(), { withFileTypes: true });
  return dirs.filter(d => d.isDirectory()).map(d => d.name);
};

// ── readDevToolsPort ──────────────────────────────────────────────────────────

const DEVTOOLS_PORT_TIMEOUT_MS = 10_000;
const DEVTOOLS_PORT_POLL_MS    = 100;

export const readDevToolsPort = async (userDataDir, { timeoutMs = DEVTOOLS_PORT_TIMEOUT_MS } = {}) => {
  const file     = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try { await access(file); break; } catch { /* file not ready yet */ }
    await new Promise(r => setTimeout(r, DEVTOOLS_PORT_POLL_MS));
  }

  // Will throw ENOENT if file never appeared — that is the correct timeout error.
  const content = await readFile(file, 'utf8');
  const port = parseInt(content.split('\n')[0], 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`DevToolsActivePort contains invalid port: ${JSON.stringify(content)}`);
  }
  return port;
};

// ── clone identity ────────────────────────────────────────────────────────────

const CLONE_PREFIX   = 'szkrabok-clone-';
const STAGING_PREFIX = 'szkrabok-staging-';
const CLONE_TTL_MS   = 6  * 60 * 60 * 1000; // 6 hours — normal TTL (no active lease)
const CLONE_HARD_TTL = 24 * 60 * 60 * 1000; // 24 hours — crash recovery (lease held but process dead)

export const newCloneId = templateName => {
  const safe = templateName.replace(/[^a-z0-9-]/gi, '-');
  return `${safe}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
};

// ── global IO semaphore ───────────────────────────────────────────────────────
// Tunable via SZKRABOK_IO env var. Default 16 — appropriate for local SSD.
// For HDD or overlayfs, set SZKRABOK_IO=4.

const IO_CONCURRENCY = parseInt(process.env.SZKRABOK_IO || '16', 10);

// pLimit is a private concurrency limiter.  shift/push on the internal queue
// array is the only correct way to implement a task queue in synchronous JS.
 
const pLimit = n => {
  const q = [];
  let active = 0;
  const next = () => {
    if (active >= n || q.length === 0) return;
    active++;
    const { fn, res, rej } = q.shift();
    fn().then(res, rej).finally(() => { active--; next(); });
  };
  return fn => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
};

export const ioLimit = pLimit(IO_CONCURRENCY);

// ── cloneDir — iterative BFS walker ──────────────────────────────────────────
// Processes entries in bounded batches via a queue. Avoids the unbounded
// promise graph that recursive Promise.all creates on deep Chrome profiles.

const CLONE_SKIP = new Set([
  'SingletonLock', 'SingletonCookie', 'SingletonSocket',
  'LOCK', 'lockfile',
  'GPUCache', 'Code Cache', 'ShaderCache', 'GrShaderCache', 'Crashpad',
]);

// cloneDir mutates its own local `queue` variable for the BFS walker.
 
export const cloneDir = async (src, dst, skip = CLONE_SKIP) => {
  const queue = [{ s: src, d: dst }];

  while (queue.length) {
    const batch = queue.splice(0, IO_CONCURRENCY);
    await Promise.all(batch.map(({ s, d }) =>
      ioLimit(async () => {
        const st = await lstat(s);
        if (st.isDirectory()) {
          await mkdir(d, { recursive: true });
          const entries = await readdir(s);
          for (const e of entries) {
            if (!skip.has(e)) queue.push({ s: join(s, e), d: join(d, e) });
          }
        } else if (st.isSymbolicLink()) {
          await symlink(await readlink(s), d);
        } else if (st.isFile()) {
          await copyFile(s, d);
        }
      })
    ));
  }
};

// ── FD lease — lifecycle fencing ──────────────────────────────────────────────
// A .lease file signals that a clone dir is actively owned.
// acquireLease: create .lease exclusively (O_EXCL); returns open FileHandle.
// leaseFree: probe by attempting exclusive create. true = no .lease = dir is free.
// On normal close, rm(cloneDir) deletes .lease. On crash, hard TTL handles cleanup.

export const acquireLease = dir => open(join(dir, '.lease'), 'wx');

export const leaseFree = async dir => {
  try {
    const fh = await open(join(dir, '.lease'), 'wx');
    await fh.close();
    return true;
  } catch {
    return false;
  }
};

// ── cloneProfileAtomic ────────────────────────────────────────────────────────
//
// Staging pattern:
//   1. All work happens under STAGING_PREFIX — never scanned by cleanupClones.
//   2. Lease acquired in staging dir immediately after mkdir.
//   3. rename(staging → final) — POSIX rename or EXDEV copy+rm fallback.
//   4. After rename, .lease inode is at finalDir (handle still valid).
//   5. Returns lease handle — caller must hold it open until close().
//
// No window where a clone dir is visible without .lease already present.

export const cloneProfileAtomic = async (srcDir, templateName) => {
  const cloneId    = newCloneId(templateName);
  const stagingDir = join(tmpdir(), `${STAGING_PREFIX}${cloneId}`);
  const finalDir   = join(tmpdir(), `${CLONE_PREFIX}${cloneId}`);

  await mkdir(stagingDir, { recursive: true });
  const stagingLease = await acquireLease(stagingDir);

  try {
    await writeFile(join(stagingDir, '.clone'), JSON.stringify({
      created: Date.now(),
      templateName,
    }));
    await cloneDir(srcDir, stagingDir, CLONE_SKIP);

    let lease;
    try {
      await rename(stagingDir, finalDir);
      // Same filesystem: staging is now final. Handle still points to the same
      // inode (POSIX rename keeps inodes intact), so stagingLease is now the
      // lease for finalDir.
      lease = stagingLease;
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      // Cross-device tmpdir (e.g. ramdisk, PrivateTmp, container bind mount).
      // Copy staging → final. The .lease file is included in the copy, which
      // is sufficient for cleanup to see the dir as owned. Close and discard
      // the staging handle; return a no-op lease since rm(finalDir) handles cleanup.
      await mkdir(finalDir, { recursive: true });
      await cp(stagingDir, finalDir, { recursive: true });
      await stagingLease.close().catch(() => {});
      await rm(stagingDir, { recursive: true, force: true });
      lease = { close: async () => {} };
    }

    return { cloneId, dir: finalDir, lease };
  } catch (err) {
    await stagingLease.close().catch(() => {});
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
};

// ── rmWithRetry — directory delete with retry loop ───────────────────────────
// Chrome and its child processes (gpu, utility, network service) may hold file
// locks on the user data dir after the browser process exits. A simple rm()
// races those locks. Retry with backoff makes deletion reliable without
// depending on Chrome PID lifecycle semantics.
//
// timeoutMs: give up after this long (default 15 s, same as waitForExit).
// pollMs:    pause between attempts (default 100 ms).

const RM_RETRY_POLL_MS   = 100;
const RM_RETRY_TIMEOUT_MS = 15_000;

export const rmWithRetry = async (dir, { timeoutMs = RM_RETRY_TIMEOUT_MS } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (Date.now() >= deadline) {
        if (log !== null && log !== undefined) {
          log(`rmWithRetry: ${dir} still undeletable after ${attempt} attempts — giving up: ${e.message}`);
        }
        throw e;
      }
      if (log !== null && log !== undefined) {
        log(`rmWithRetry: ${dir} not yet deletable (attempt ${attempt}) — retrying…`);
      }
      await new Promise(r => setTimeout(r, RM_RETRY_POLL_MS));
    }
  }
};

// ── clone scavenger ───────────────────────────────────────────────────────────
//
// Two-gate delete:
//   lease free  + past normal TTL (or no .clone) → delete
//   lease held  + past hard TTL  (crash recovery) → delete
//   lease held  + within hard TTL                 → keep
//   lease free  + within normal TTL               → keep
//
// Staging dirs (szkrabok-staging-*) with a held lease and no .clone are kept
// to avoid deleting an in-progress copy. They will accumulate if a process
// crashes after acquireLease but before writeFile(.clone); this is a rare,
// sub-millisecond window and the dirs are empty (< 1 KB).

// Time-gated GC: cleanupClones scans the whole tmpdir on every call. On shared
// or heavily-used systems this becomes expensive. Rate-limit to once per minute
// so that the O(N) scan is amortised across launches.
let _lastCleanupAt = 0;
const GC_COOLDOWN_MS = 60_000;

export const cleanupClones = async () => {
  const now = Date.now();
  if (now - _lastCleanupAt < GC_COOLDOWN_MS) return;
  _lastCleanupAt = now;

  const entries = await readdir(tmpdir(), { withFileTypes: true });

  await Promise.allSettled(entries.map(async e => {
    if (!e.isDirectory()) return;
    const isClone   = e.name.startsWith(CLONE_PREFIX);
    const isStaging = e.name.startsWith(STAGING_PREFIX);
    if (!isClone && !isStaging) return;

    const dir = join(tmpdir(), e.name);

    let created = null;
    try {
      const meta = JSON.parse(await readFile(join(dir, '.clone'), 'utf8'));
      created = meta.created ?? null;
    } catch { /* .clone missing or corrupt — treat as no creation time */ }

    const free = await leaseFree(dir);

    if (!free) {
      // Lease held — may be active or crashed.
      // Keep unless past hard TTL (crash recovery).
      if (created === null || now - created <= CLONE_HARD_TTL) return;
    } else {
      // No lease — check normal TTL.
      if (created !== null && now - created <= CLONE_TTL_MS) return;
      // No .clone (orphan) or past TTL: fall through to delete.
    }

    await rm(dir, { recursive: true, force: true });
  }));
};
