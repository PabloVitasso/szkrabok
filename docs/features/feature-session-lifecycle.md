# Feature: Session Lifecycle Management

**Implements:** session GC, profile maintenance, session index
**Depends on:** [feature-profile-leasing.md](./feature-profile-leasing.md) — implement that first
**Related:** `PURGEABLE_DIRS` here replaces `CLONE_SKIP` from profile-leasing; `removeTransientFiles`
closes the stale-`DevToolsActivePort` gap identified in the leasing architecture

---

## Integration notes (read before implementing)

- `PURGEABLE_DIRS` is the canonical replacement for the local `CLONE_SKIP` set defined in
  feature-profile-leasing. Export it from `storage.js` so `cloneProfileAtomic` can import it.
- `CLONE_SKIP` alias is kept for call-site clarity — see "canonical purgeable set" section.
- `touchIndex` in `launch.js` goes after `pool.add(key, ...)` unconditionally (both clone and
  template sessions). The clone branch from profile-leasing must already be in place.
- `removeTransientFiles` should be called in the template `close()` callback in `launch.js`, not
  only from the `session maintain` CLI. See profile-leasing integration notes.
- `mapLimit` defined here should also be used by `cleanupLeases` (profile-leasing) to avoid a
  duplicate concurrency utility. Export it from `storage.js`.

---

Two problems share the same root cause: no explicit lifecycle management.

**Session accumulation** — `list` returns only `{ id, active }` with no
timestamps. ~60 of 68 observed sessions are stale test artifacts. No automated
cleanup path exists.

**Profile bloat** — profiles accumulate caches, WAL segments, and background
update artefacts. A template profile can reach 500 MB+ when 20–80 MB is correct.
Clone cost is dominated by unnecessary bytes.

Both are solved together: the same directory set that gets pruned during
template maintenance is also excluded during cloning. One canonical list serves
both purposes.

---

## Contents

- [Concepts](#concepts)
- [Canonical purgeable set](#canonical-purgeable-set)
- [Part 1 — Session GC](#part-1--session-gc)
- [Part 2 — Profile maintenance](#part-2--profile-maintenance)
- [Part 3 — CLI commands](#part-3--cli-commands)
- [File layout](#file-layout)
- [What is not addressed](#what-is-not-addressed)

---

## Concepts

```
Session lifecycle:
  created → active → idle → stale → deleted

Profile lifecycle:
  dirty (in-use) → closed → maintained → frozen (template-ready)
```

The GC feature manages the session lifecycle. The maintenance feature manages
the profile lifecycle. They share the canonical purgeable set and both gate
on the session being closed before operating.

---

## Canonical purgeable set

One set, two consumers: `CLONE_SKIP` (never copy into leases) and
`pruneCaches` (strip from templates before freezing).

```js
// packages/runtime/storage.js

// Directories that are process-local, regenerable, or nondeterministic.
// Used by cloneProfileAtomic (never copy) and pruneCaches (actively remove).
export const PURGEABLE_DIRS = new Set([
  // Lock / transient — must never persist into a clone
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'DevToolsActivePort',

  // Pure performance caches — recreated automatically on next launch
  'GPUCache',
  'Code Cache',
  'ShaderCache',
  'GrShaderCache',
  'Crashpad',
  'DawnCache',
  'BrowserMetrics',
  'OptimizationHints',
  'Subresource Filter',
  'Trust Tokens',
  'AutofillStrikeDatabase',
  'Media Cache',
  'Blob Storage',
  'File System',
  'Service Worker',
  'CacheStorage',

  // Background update systems — large nondeterministic writes, unrelated to auth
  'Safe Browsing',
  'WidevineCdm',
  'CertificateRevocation',
  'pnacl',
  'OriginTrials',
  'component_crx_cache',
  'OnDeviceHeadSuggestModel',
  'OptimizationGuidePredictionModels',
]);

// CLONE_SKIP is the same set — alias so callers are explicit about intent.
export const CLONE_SKIP = PURGEABLE_DIRS;
```

### Nested path caveat

`Default/Cache/` and `Default/Network/Cache/` are nested under the `Default/`
partition dir, not top-level. The `basename` filter in `cloneProfileAtomic`
handles top-level names correctly. For nested entries, options are:

- **Option A** — add `'Cache'` and `'Network'` to `PURGEABLE_DIRS` (simple, may
  over-match other dirs of the same name at any depth)
- **Option B** — path-aware filter:
  ```js
  filter: p => {
    const name = basename(p);
    if (PURGEABLE_DIRS.has(name)) return false;
    if (name === 'Cache' || name === 'Network') return false;
    return true;
  }
  ```
- **Option C** — strip `Default/Cache/` during template maintenance so the filter
  never encounters it. Cleanest: a well-maintained template does not contain these
  dirs and the filter becomes a safety net, not the primary mechanism.

Option C is preferred when the maintenance pipeline is in use.

---

## Part 1 — Session GC

### Design decisions

**D1 — Session index, not per-session meta fan-out.**
`list()` must not do O(N) disk reads. A single `sessions.index.json` replaces
the fan-out and makes `list()` a single file read.

**D2 — `meta.json` remains ground truth.**
The index is a projection for fast reads. On startup or corruption it can be
rebuilt from individual `meta.json` files.

**D3 — `no-meta` ≠ stale by default.**
Missing `meta.json` is unknown, not confirmed stale. Deletion requires explicit
`includeNoMeta: true` opt-in.

**D4 — `lastUsed` is advisory, not authoritative.**
Crash-before-write leaves a stale timestamp. Clock skew produces negative idle.
`computeStaleness` centralizes interpretation and exposes `reason` for
observability.

**D5 — Purge verifies lease absence before delete.**
The runtime pool reflects the current process only. `SingletonLock` presence
catches orphan browser processes from previous crashes.

**D6 — `list()` is fast by default, verbose on request.**
Default path reads the index only. `verbose: true` enriches from individual
meta files.

**D7 — Touch index on pool acquire.**
`lastUsed` currently written only on `closeSession()`. Sessions that crash or
are abandoned have stale timestamps — the primary cause of the ~60/68 stale
observation. Touching the index on acquire closes the gap without a full
`meta.json` write.

### Session index

```
sessions/
  sessions.index.json     ← new, single-read summary
  {id}/
    meta.json             ← full per-session record (unchanged)
    state.json
    profile/
```

**Schema:**
```json
{
  "dev": {
    "created":  1772408060429,
    "lastUsed": 1773824205697,
    "preset":   "chromium-honest",
    "label":    "Chromium (no UA spoof)"
  }
}
```

**Implementation:**
```js
// packages/runtime/storage.js

const getIndexPath = () => join(getSessionsDir(), 'sessions.index.json');

export const loadIndex = async () => {
  try { return JSON.parse(await readFile(getIndexPath(), 'utf8')); }
  catch { return {}; }
};

// Atomic write — tmp + rename prevents torn reads on crash.
export const saveIndex = async idx => {
  const p = getIndexPath();
  const tmp = p + '.tmp';
  await writeFile(tmp, JSON.stringify(idx, null, 2));
  await rename(tmp, p);
};

export const touchIndex = async (id, patch) => {
  const idx = await loadIndex();
  idx[id] = { ...(idx[id] ?? {}), ...patch };
  await saveIndex(idx);
};

export const removeFromIndex = async id => {
  const idx = await loadIndex();
  delete idx[id];
  await saveIndex(idx);
};

// Recovery path — rebuild from individual meta files.
export const rebuildIndex = async () => {
  const ids = await listSessions();
  const idx = {};
  await Promise.allSettled(ids.map(async id => {
    const m = await loadMeta(id);
    if (m) idx[id] = {
      created:  m.created  ?? null,
      lastUsed: m.lastUsed ?? null,
      preset:   m.preset   ?? null,
      label:    m.label    ?? null,
    };
  }));
  await saveIndex(idx);
  return idx;
};
```

**`touchIndex` call sites:**

| Call site | Event |
|---|---|
| `launch()` after `saveMeta()` | session created |
| `closeSession()` after `updateMeta()` | session closed |
| `updateSessionMeta()` | url update / navigation |
| `pool.add()` | session re-opened / acquired |
| `deleteSession()` | → `removeFromIndex` instead |

### Bounded meta loading (fallback path)

For index-absent or index-stale cases. Unbounded `Promise.all` on spinning disk
or network FS causes an IO storm.

```js
// packages/runtime/storage.js

const mapLimit = async (items, limit, fn) => {
  const results = [];
  const active = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    active.add(p);
    p.finally(() => active.delete(p));
    if (active.size >= limit) await Promise.race(active);
  }
  return Promise.all(results);
};

export const loadAllSessionMetas = async ids => {
  const entries = await mapLimit(ids, 8, async id => {
    try { return [id, await loadMeta(id)]; }
    catch { return [id, null]; }
  });
  return new Map(entries);
};
```

### Staleness computation

```js
// packages/runtime/sessions.js

export const computeStaleness = (meta, now, cutoffMs) => {
  if (!meta)           return { stale: null,  reason: 'no-meta' };
  if (!meta.lastUsed)  return { stale: null,  reason: 'never-used' };

  const idleMs = now - meta.lastUsed;

  if (idleMs < 0) return { stale: false, reason: 'clock-skew', idleMs };

  return {
    stale:    idleMs > cutoffMs,
    reason:   idleMs > cutoffMs ? 'idle' : 'recent',
    idleMs,
    daysIdle: Math.floor(idleMs / 86_400_000),
  };
};
```

`reason` values: `no-meta` | `never-used` | `clock-skew` | `idle` | `recent`

`stale: null` = system cannot determine staleness. Purge skips unless
`includeNoMeta: true`.

### `list()` changes

```js
// src/tools/szkrabok_session.js

export const list = async ({ verbose = false } = {}) => {
  const activeMap = new Map(listRuntimeSessions().map(s => [s.id, s]));
  const [stored, index] = await Promise.all([listStoredSessions(), loadIndex()]);
  const now      = Date.now();
  const cutoffMs = 7 * 24 * 60 * 60 * 1000;
  const metas    = verbose ? await loadAllSessionMetas(stored) : null;

  return {
    sessions: stored.map(id => {
      const a    = activeMap.get(id);
      const idx  = index[id] ?? null;
      const m    = metas?.get(id) ?? null;
      const meta = m ?? idx;
      const { stale, reason, daysIdle } = computeStaleness(meta, now, cutoffMs);

      return {
        id,
        active:      !!a,
        preset:      a?.preset  ?? meta?.preset  ?? null,
        label:       a?.label   ?? meta?.label   ?? null,
        created:     meta?.created  ?? null,
        lastUsed:    meta?.lastUsed ?? null,
        daysIdle:    daysIdle ?? null,
        stale,
        staleReason: reason,
      };
    }),
    server: { version, source: process.argv[1] },
  };
};
```

`verbose` added to MCP tool schema as optional boolean.

### `purge` action

```js
// src/tools/szkrabok_session.js

const hasActiveLease = async id => {
  const lockPath = join(storage.getUserDataDir(id), 'SingletonLock');
  return existsSync(lockPath);
};

const safeDelete = async id => {
  if (pool.has(id))              return { id, skipped: 'pool-active' };
  if (await hasActiveLease(id))  return { id, skipped: 'singleton-lock' };
  try {
    await deleteStoredSession(id);
    await removeFromIndex(id);
    return { id, deleted: true };
  } catch (err) {
    return { id, skipped: 'error', error: err.message };
  }
};

export const purge = async ({ staleDays = 7, dryRun = false, includeNoMeta = false } = {}) => {
  const [stored, index] = await Promise.all([listStoredSessions(), loadIndex()]);
  const now      = Date.now();
  const cutoffMs = staleDays * 86_400_000;

  const candidates = stored.filter(id => {
    const { stale } = computeStaleness(index[id] ?? null, now, cutoffMs);
    if (stale === true)  return true;
    if (stale === null && includeNoMeta) return true;
    return false;
  });

  if (dryRun) return { dryRun: true, candidates, count: candidates.length };

  const results = await mapLimit(candidates, 4, safeDelete);
  return {
    deleted: results.filter(r => r.deleted).map(r => r.id),
    skipped: results.filter(r => r.skipped),
    count:   results.filter(r => r.deleted).length,
  };
};
```

MCP schema fields: `staleDays` (integer, default 7), `dryRun` (boolean, default
false), `includeNoMeta` (boolean, default false).

### Touch on acquire

```js
// packages/runtime/launch.js — after pool.add(key, ...)
await storage.touchIndex(key, { lastUsed: Date.now() });
```

Index only — not `meta.json`. Keeps launch path fast.

---

## Part 2 — Profile maintenance

A well-maintained template profile should be 20–80 MB, cloneable in milliseconds
with reflink, deterministic across runs, and stable for months. If it grows
continuously, it is persisting runtime garbage.

### What to remove

**Pure performance caches** (always safe — recreated on next launch):

All entries in `PURGEABLE_DIRS` that are not lock files. See canonical set above.

**Lock and transient files** (must be absent from template before cloning):

```
SingletonLock  SingletonCookie  SingletonSocket  DevToolsActivePort
```

These are in `CLONE_SKIP` so they are never copied into leases. They must also
be physically removed from the template after each session close so the template
directory stays clean. `DevToolsActivePort` carries a stale port number — a clone
that inherits it creates a startup race with `readDevToolsPort`.

### SQLite maintenance

Chromium stores cookies, history, and login data in SQLite. Without maintenance,
a profile active for days carries hundreds of MB of WAL that is never
checkpointed. Correct order:

1. Close browser cleanly — SQLite files must not be open
2. WAL checkpoint — flush uncommitted pages back into the main DB file
3. Vacuum — compact and defragment
4. Integrity check — verify before marking as template

```bash
sqlite3 Cookies      "PRAGMA wal_checkpoint(FULL); VACUUM;"
sqlite3 History      "PRAGMA wal_checkpoint(FULL); VACUUM;"
sqlite3 'Login Data' "PRAGMA wal_checkpoint(FULL); VACUUM;"
sqlite3 Favicons     "PRAGMA wal_checkpoint(FULL); VACUUM;"
sqlite3 'Web Data'   "PRAGMA wal_checkpoint(FULL); VACUUM;"
sqlite3 Cookies      "PRAGMA integrity_check;" | grep -v "^ok$" && echo "CORRUPT"
```

10× size reduction is common after first maintenance run.

**Note on state authority:** `state.json` separately serialises cookies via
`context.storageState()`. If the template is the state authority (option A in
`cloning-arch.md`), the `Cookies` SQLite DB is ground truth and maintenance
matters. If using `state.json` injection (option B), SQLite content is
irrelevant. Pick one and be consistent.

**`sqlite3` availability:** the CLI binary is not guaranteed present. Options:

```js
// Option A: spawn sqlite3, fail gracefully if absent
const vacuumDb = async dbPath =>
  execFile('sqlite3', [dbPath, 'PRAGMA wal_checkpoint(FULL); VACUUM;']);
```

```js
// Option B: better-sqlite3 (native addon, install complexity)
const vacuumDb = dbPath => {
  const db = new Database(dbPath);
  db.pragma('wal_checkpoint(FULL)');
  db.exec('VACUUM');
  db.close();
};
```

szkrabok has no SQLite dependency. Option A with graceful skip is the correct
choice for a maintenance CLI command that runs rarely.

### Cache removal

```js
// packages/runtime/storage.js

export const pruneCaches = async profileDir => {
  await Promise.allSettled(
    [...PURGEABLE_DIRS]
      .filter(name => !name.startsWith('Singleton') && name !== 'DevToolsActivePort')
      .map(name => rm(join(profileDir, name), { recursive: true, force: true }))
  );
};
```

Lock files are excluded from `pruneCaches` — they are handled separately so the
intent is explicit (see `removeTransientFiles` below).

```js
export const removeTransientFiles = async profileDir => {
  const TRANSIENT = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];
  await Promise.allSettled(
    TRANSIENT.map(name => rm(join(profileDir, name), { force: true }))
  );
};
```

### Maintenance pipeline

```
1.  Launch browser (clone=false)
2.  Login / configure / verify
3.  Close browser cleanly
4.  Run SQLite maintenance (WAL checkpoint + vacuum + integrity check)
5.  pruneCaches(profileDir)
6.  removeTransientFiles(profileDir)
7.  Verify no open file handles (lsof check)
8.  chmod -R a-w profileDir   ← tripwire, not security boundary
9.  Template ready for cloning
```

---

## Part 3 — CLI commands

Two new commands. Both gate on the session being closed (check pool, throw if
open). Neither requires a browser launch.

### `szkrabok session purge`

```
szkrabok session purge [--days <N>] [--dry-run] [--include-no-meta]
```

Wraps the `purge()` handler. Always shows candidates before confirming in
interactive mode. `--dry-run` forces preview-only.

### `szkrabok session maintain <id>`

```
szkrabok session maintain <id> [--skip-sqlite] [--no-freeze]
```

Runs steps 4–8 of the maintenance pipeline against a stored session's profile
directory. Output: before/after size, files removed, SQLite result or skip
reason.

`--skip-sqlite` gracefully skips WAL checkpoint if `sqlite3` binary is absent.
`--no-freeze` skips the `chmod` tripwire.

---

## File layout

```
packages/runtime/
  storage.js        + PURGEABLE_DIRS (replaces CLONE_SKIP), loadIndex, saveIndex,
                      touchIndex, removeFromIndex, rebuildIndex,
                      loadAllSessionMetas, mapLimit,
                      pruneCaches, removeTransientFiles
  sessions.js       + computeStaleness
  launch.js         + touchIndex call after pool.add

src/tools/
  szkrabok_session.js   list() — verbose, index, computeStaleness
                        purge() — new action, dryRun, safeDelete
                        maintain() — new action (delegates to runtime)

src/cli/commands/
  session.js        extend with purge + maintain subcommands

sessions/
  sessions.index.json     managed file — gitignore
  sessions.index.json.tmp transient — gitignore
```

Add to `.gitignore`:
```
sessions/sessions.index.json
sessions/sessions.index.json.tmp
```

---

## What is not addressed

**Index consistency under concurrent writers** — read-modify-write on the index
is not atomic at the process level. `rename()` is atomic on POSIX but two
processes can race the read. Single-process scope (stated boundary) makes this
acceptable. Multi-process would require a file lock or SQLite index.

**Index rebuild trigger** — `rebuildIndex()` is a recovery function, not called
automatically. A `szkrabok doctor` check or `--rebuild-index` flag on startup
provides recovery without slowing normal operation.

**Adaptive TTL** — 7 days is the hardcoded default. Session name prefixes
(`test-*`, `scrape-*`) could carry shorter TTLs. Out of scope.

**Clock skew recovery** — `clock-skew` reason is returned but the timestamp is
not corrected. Conservative and correct: session stays not-stale until a valid
`lastUsed` is written.

**SQLite without `sqlite3` binary** — `better-sqlite3` is a native addon with
install complexity. Not added as a dependency. `--skip-sqlite` is the escape
hatch.
