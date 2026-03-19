import { readFile, writeFile, mkdir, rm, readdir, copyFile, lstat, readlink, symlink, access, rename } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { tmpdir, cpus } from 'os';
import crypto from 'crypto';

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
    try { await access(file); break; } catch {}
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
// Staging dirs use a different prefix — never scanned by cleanupClones.
// All clone work happens here; only the final atomic rename makes the dir visible.
const STAGING_PREFIX = 'szkrabok-staging-';
const CLONE_TTL_MS   = 6 * 60 * 60 * 1000; // 6 hours

export const newCloneId = templateName => {
  const safe = templateName.replace(/[^a-z0-9-]/gi, '-');
  return `${safe}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
};

// ── global IO semaphore ───────────────────────────────────────────────────────
// One shared limiter across all concurrent clone operations bounds total
// parallel file ops, preventing EMFILE and random ENOENT under io pressure.

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

const _ioLimit = pLimit(Math.max(4, cpus().length));

// ── cloneDir ─────────────────────────────────────────────────────────────────

const CLONE_SKIP = new Set([
  'SingletonLock', 'SingletonCookie', 'SingletonSocket',
  'GPUCache', 'Code Cache', 'ShaderCache', 'GrShaderCache', 'Crashpad',
]);

// Recursive directory walker using the global IO semaphore.
const cloneDir = async (src, dst, skip) => {
  const walk = async (s, d) => {
    const st = await lstat(s);
    if (st.isDirectory()) {
      await mkdir(d, { recursive: true });
      const entries = await readdir(s);
      await Promise.all(
        entries
          .filter(e => !skip.has(e))
          .map(e => _ioLimit(() => walk(join(s, e), join(d, e))))
      );
    } else if (st.isSymbolicLink()) {
      await symlink(await readlink(s), d);
    } else if (st.isFile()) {
      await copyFile(s, d);
    }
  };
  await walk(src, dst);
};

// ── cloneProfileAtomic ────────────────────────────────────────────────────────
//
// Atomic staging pattern:
//   1. All work (metadata + file copy) happens under STAGING_PREFIX — never scanned.
//   2. rename(staging → final) is atomic on POSIX same-filesystem.
//   3. After rename the dir is visible to cleanupClones with .clone already present.
//   There is no window where a clone dir exists without its .clone file.

export const cloneProfileAtomic = async (srcDir, templateName) => {
  const cloneId    = newCloneId(templateName);
  const stagingDir = join(tmpdir(), `${STAGING_PREFIX}${cloneId}`);
  const finalDir   = join(tmpdir(), `${CLONE_PREFIX}${cloneId}`);

  await mkdir(stagingDir, { recursive: true });
  try {
    await writeFile(join(stagingDir, '.clone'), JSON.stringify({
      pid:          process.pid,
      created:      Date.now(),
      templateName,
    }));
    await cloneDir(srcDir, stagingDir, CLONE_SKIP);
    // Atomic: stagingDir appears as finalDir with all content already present.
    await rename(stagingDir, finalDir);
  } catch (err) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  return { cloneId, dir: finalDir };
};

// ── PID-safe clone scavenger ──────────────────────────────────────────────────

const isPidAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
};

export const cleanupClones = async () => {
  const entries = await readdir(tmpdir(), { withFileTypes: true });
  const now     = Date.now();

  await Promise.allSettled(entries.map(async e => {
    const isClone   = e.isDirectory() && e.name.startsWith(CLONE_PREFIX);
    const isStaging = e.isDirectory() && e.name.startsWith(STAGING_PREFIX);
    if (!isClone && !isStaging) return;

    const full = join(tmpdir(), e.name);

    if (isStaging) {
      // Staging dirs are mid-copy orphans; the process died before rename.
      // Use same liveness/TTL logic as for clone dirs.
      try {
        const meta = JSON.parse(await readFile(join(full, '.clone'), 'utf8'));
        if (isPidAlive(meta.pid)) return;
        if (now - meta.created <= CLONE_TTL_MS) return;
      } catch {}
      await rm(full, { recursive: true, force: true });
      return;
    }

    // Clone dir: after atomic rename .clone always exists.
    // If missing, the dir is from an old version or manual creation — delete.
    try {
      const meta = JSON.parse(await readFile(join(full, '.clone'), 'utf8'));
      if (isPidAlive(meta.pid)) return;
      if (now - meta.created <= CLONE_TTL_MS) return;
      await rm(full, { recursive: true, force: true });
    } catch {
      await rm(full, { recursive: true, force: true });
    }
  }));
};
