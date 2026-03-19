# Feature: Profile Cloning

**Implements:** ephemeral profile cloning — template → clone → destroy
**Depends on:** nothing — implement this first
**Related:** [feature-session-lifecycle.md](./feature-session-lifecycle.md) — expands `CLONE_SKIP`
into `PURGEABLE_DIRS`; adds `removeTransientFiles` which closes the stale-`DevToolsActivePort` gap

---

## Integration notes (read before implementing)

- Do **not** define a local `CLONE_SKIP` set in `cloneProfileAtomic`. Import `PURGEABLE_DIRS` from
  session-lifecycle instead. The two features share one canonical set; session-lifecycle expands it
  from 9 to ~20 entries.
- Wire `removeTransientFiles(userDataDir)` into the template session's `close()` callback (not only
  the `session maintain` CLI). This prevents stale `DevToolsActivePort` from causing a startup race
  on the next clone without requiring a manual maintenance run.
- `mapLimit` (introduced in session-lifecycle) should also be used in `cleanupClones` — avoids a
  duplicate concurrency utility. Export it from `storage.js`.
- `cleanupClones` (this feature) and `purge()` (session-lifecycle) operate on different namespaces:
  `os.tmpdir()` clone dirs vs. `sessions/` stored profiles. Neither subsumes the other.
- The `touchIndex` call in `launch.js` (from session-lifecycle) sits after `pool.add()` in the
  merged launch path. Add the clone branch first; session-lifecycle adds the index call on top.

---

## Implementation status

Status values: `not started` | `in progress` | `done`

### Functions

| Function | File | Status | Tests |
|----------|------|--------|-------|
| `readDevToolsPort` | `packages/runtime/storage.js` | **done** | PC-1.1–PC-1.7 ✓, PC-6.2 |
| `newCloneId` | `packages/runtime/storage.js` | **done** | PC-1.8–PC-1.11 ✓ |
| `cloneProfileAtomic` | `packages/runtime/storage.js` | **done** | PC-1.12–PC-1.18 ✓ |
| `cleanupClones` | `packages/runtime/storage.js` | **done** | PC-1.19–PC-1.24 ✓, PC-4.10 ✓ |
| `pool.add` — `isClone`, `cloneDir`, `templateName` | `packages/runtime/pool.js` | **done** | PC-2.1–PC-2.5 ✓ |
| `pool.list` — expose `isClone`, `cloneDir` | `packages/runtime/pool.js` | **done** | PC-2.4–PC-2.5 ✓ |
| `destroyClone` | `packages/runtime/sessions.js` | **done** | PC-3.1–PC-3.7 ✓ |
| `launchClone` | `packages/runtime/launch.js` | **done** | PC-4.1–PC-4.7 ✓, PC-4.10 ✓ |
| `launch` — remove `cdpPortForId`, use `readDevToolsPort` | `packages/runtime/launch.js` | **done** | PC-4.8 ✓ |
| `cdpPortForId` — deleted | `packages/runtime/launch.js` | **done** | PC-4.4 ✓ |
| `ensureGcOnExit` | `packages/runtime/launch.js` | **done** | PC-4.9 ✓ |
| `session_manage open` — `isClone` option | `src/tools/szkrabok_session.js` | **done** | PC-5.1–PC-5.6 ✓ |
| `session_manage close` — auto-route | `src/tools/szkrabok_session.js` | **done** | PC-5.7–PC-5.8 ✓ |
| `session_manage list` — include clones | `src/tools/szkrabok_session.js` | **done** | PC-5.9–PC-5.11 ✓ |
| `session_manage deleteSession` — clone guard | `src/tools/szkrabok_session.js` | **done** | PC-5.12 ✓ |
| `session_manage` schema — `isClone` in `launchOptions` | `src/tools/registry.js` | **done** | — |
| `index.js` — export `launchClone`, `destroyClone` | `packages/runtime/index.js` | **done** | — |

### Test files

| File | Tests | Status |
|------|-------|--------|
| `tests/node/runtime/pc-layer1.test.js` | PC-1.1–PC-1.24 (24 tests) | **24/24 passing** |
| `tests/node/runtime/pc-layer2.test.js` | PC-2.1–PC-2.5 (5 tests) | **5/5 passing** |
| `tests/node/runtime/pc-layer3.test.js` | PC-3.1–PC-3.8 (8 tests) | **8/8 passing** |
| `tests/node/runtime/pc-layer4.test.js` | PC-4.1–PC-4.10 (10 tests) | **10/10 passing** |
| `tests/node/runtime/pc-layer5.test.js` | PC-5.1–PC-5.12 (12 tests) | **12/12 passing** |
| `tests/node/runtime/pc-layer6.test.js` | PC-6.1–PC-6.5 (5 tests) | **5/5 passing** ✓ |
| `tests/node/runtime/cloning.test.js` | (scaffolded, old naming) | delete — superseded by pc-layer1 |
| `tests/node/runtime/devtools-port.test.js` | (scaffolded, old naming) | delete — superseded by pc-layer6 |

---

## Core invariant

A Chromium profile directory must have exactly one writer for its entire lifetime.

Lock breaking is heuristic.
Directory cloning is deterministic.

Therefore:

- Template profile = immutable factory
- Clone profile = ephemeral, write-once, destroy on close
- State persistence = explicit export/import on template sessions only; never on clones

---

## Lifecycle model

### Template phase (human / bootstrap)

1. `session_manage open` with `isClone: false` (default)
2. Login / configure
3. Close — state saved to `state.json`, template profile updated

Optional hardening after close:

- SQLite WAL checkpoint + vacuum
- Remove caches (`pruneCaches` from session-lifecycle)
- `chmod -R a-w` — tripwire, not a security boundary

### Clone phase (automated)

1. `session_manage open` with `isClone: true`
2. Template profile is cloned to `os.tmpdir()/szkrabok-clone-{cloneId}`
3. Browser launched against clone (`--remote-debugging-port=0`)
4. Port read from `DevToolsActivePort` after polling
5. Run workload
6. `session_manage close` — context closed, clone dir destroyed, no state saved

No profile reuse. No lock contention. No stale process logic.

---

## Modes

| Mode     | `isClone` | Directory                          | Reused | Saved on close | Cleaned on close |
|----------|-----------|------------------------------------|--------|----------------|------------------|
| Template | `false`   | `sessions/{name}/profile/`         | yes    | yes            | no               |
| Clone    | `true`    | `os.tmpdir()/szkrabok-clone-{id}/` | no     | no             | yes              |

Template must never be open when a clone of it is being created.

---

## Known issues and resolution status

| # | Issue | Status |
|---|-------|--------|
| 1 | Port allocator TOCTOU | **Fixed** — pass `--remote-debugging-port=0`, poll `DevToolsActivePort` |
| 2 | Template immutability via chmod is insufficient | **Partially fixed** — physical directory separation; see note |
| 3 | Clone atomicity (`cp` is not transactional) | **Partially mitigated** — `COPYFILE_FICLONE` + closed-template requirement |
| 4 | TTL scavenger early-deletes live clone dirs | **Fixed** — PID liveness + TTL two-gate |
| 4a | TTL scavenger late-deletes after PID reuse | **Accepted** — single-machine leak risk; see note |
| 5 | Pool key leaky on crash path | **Deferred** — pool is soft registry; scavenger reclaims on next launch |
| 6 | State authority (template vs state.json) | **Accepted** — template is authoritative for initial implementation |
| 7 | No multi-host / distributed clone safety | **Out of scope** — single-process only |
| 8 | Clone GC only triggered at launch | **Fixed** — also run on `process.beforeExit` |

---

## Issue notes

**#1 — DevToolsActivePort readiness**

`launchPersistentContext` returning does not contractually guarantee the file has been flushed to
disk. Slow disks, AV hooks, remote filesystems, or a Chromium regression can all cause a race.
`readDevToolsPort` must poll with a configurable timeout rather than reading once.

**#2 — Template immutability**

`chmod 0555` is a weak guard: meaningless on Windows, bypassable on macOS sandbox, and some
Chromium subsystems touch timestamps even on read-only trees. The real fix is physical directory
separation: templates live under `sessions/`, clones under `os.tmpdir()`. Code that resolves a
template path never goes through the clone registry, and vice versa. The chmod is still applied as
a tripwire on top.

Remaining failure modes: browser extension auto-update writing to the profile while the template
session is open, or a code path that constructs a template path from a session id. Both require the
template to be closed before any clone runs — that invariant cannot be enforced mechanically without
a kernel-level filesystem lock.

**#3 — Clone atomicity and reflink fallback**

`fs.promises.cp` with `COPYFILE_FICLONE` hints to the OS to use a copy-on-write reflink (btrfs,
APFS, XFS with reflink). If the filesystem does not support it, a regular copy is performed
silently. There is no cross-file atomicity in either case. Large profiles on non-CoW filesystems
produce a full deep copy: seconds of blocking, IO burst, and launch jitter. The correctness guard
is the closed-template requirement: cloning a running profile produces undefined results regardless
of copy strategy.

**#4a — PID reuse late-delete leak**

The two-gate delete (PID dead AND TTL exceeded) prevents early deletion but introduces a
permanent-leak class: if PID is reused by an unrelated process after TTL expires, the scavenger
sees the PID as alive and skips the dir forever. The correct fix is to store the process start time
alongside the PID and validate both (Linux: `/proc/<pid>/stat` field 22, `starttime`). This is
Linux-only and adds complexity. For the initial implementation the leak is accepted and documented.

**#5 — Pool crash path**

If the browser crashes without `context.close()`, the `close` event fires and `pool.remove` is
called. The clone dir is not deleted in that path. The TTL scavenger reclaims it on the next launch
or process exit. Acceptable for a soft-registry model.

**#7 — Multi-host scope**

The cloning model is process-local. `tmpdir()` and `sessions/` are assumed to be local filesystem,
not shared. Multi-host use requires a distributed lock at the outer layer (Redis, etcd, DB row).

**#8 — Clone GC trigger**

GC that runs only at `launchClone()` time leaves stale dirs accumulating when launches are
infrequent. Registering a `process.beforeExit` handler covers the gap: it fires when the event loop
drains naturally, giving GC a second trigger without a background interval or timer.

---

## MCP API surface

### `session_manage` — extended, not replaced

Clone sessions are a behavioural variant of sessions. They use the same tool, the same `sessionName`
field, and the same actions. The only additions are `isClone` in `launchOptions` (input) and
`isClone` + `templateSession` in responses.

#### `open` — new `launchOptions.isClone` (optional, default `false`)

```json
{
  "action": "open",
  "sessionName": "myprofile",
  "launchOptions": { "isClone": true }
}
```

Response when `isClone: false` (unchanged shape, new field):
```json
{
  "success": true,
  "sessionName": "myprofile",
  "isClone": false,
  "cdpEndpoint": "http://localhost:PORT"
}
```

Response when `isClone: true`:
```json
{
  "success": true,
  "sessionName": "myprofile-1748234205-a3f2c1b0",
  "isClone": true,
  "templateSession": "myprofile",
  "cdpEndpoint": "http://localhost:PORT"
}
```

The generated `sessionName` is the clone's identity for all subsequent calls. It is formed as
`{templateName}-{timestamp}-{randomHex}`. The caller stores it and uses it verbatim — the same
field, the same tools, no branching required.

`isClone: false` is the default and can be omitted. Existing callers that do not pass `isClone` get
the current behaviour unchanged.

#### `close` — auto-routes, no schema change

```json
{ "action": "close", "sessionName": "myprofile-1748234205-a3f2c1b0" }
```

The handler looks up `pool.get(sessionName).isClone` and routes:

- `isClone: false` → `closeSession(sessionName)`: save state, update meta, close context
- `isClone: true`  → `destroyClone(sessionName)`: close context, `rm -rf` clone dir, no save

The caller does not need to know which path is taken.

#### `list` — unified, clones included

Clone sessions have no disk presence in `sessions/` but are held in the pool while active. `list`
emits both:

```json
{
  "sessions": [
    {
      "id": "myprofile",
      "isClone": false,
      "active": true,
      "preset": "chromium-honest",
      "label": "Chromium (no UA spoof)"
    },
    {
      "id": "myprofile-1748234205-a3f2c1b0",
      "isClone": true,
      "active": true,
      "templateSession": "myprofile"
    }
  ]
}
```

Inactive clones never appear — they do not exist once destroyed. Stored template sessions that are
not currently open appear with `active: false` as before.

#### `delete` — template sessions only

`delete` with a clone `sessionName` throws. Clones are destroyed via `close`. There is no stored
session to delete.

#### `endpoint` — unchanged, works for both

`pool.get(sessionName)` is keyed correctly for both templates and clones. No change needed.

### `browser_run`, `workflow_scrape`, `browser.run_test` — no schema change

All three delegate to `getSession(sessionName)` → `pool.get(sessionName)`. The pool is keyed by
whatever `sessionName` was returned from `open` — template name for templates, generated id for
clones. No new fields needed. Update description strings only:

```
sessionName — session name (template) or the generated name returned by session_manage open
              with isClone:true (clone). Use whichever was returned from open.
```

---

## Implementation

### `storage.js` additions

```js
// packages/runtime/storage.js

import { cp, rm, readdir, writeFile, readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import crypto from 'crypto';

// ── readDevToolsPort ──────────────────────────────────────────────────────────

// Timeout injectable for testing — pass { timeoutMs: 500 } in tests.
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

const CLONE_PREFIX = 'szkrabok-clone-';
const CLONE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// cloneId = "{templateName}-{timestamp}-{randomHex}"
// Embedded template name aids readability in ps/tmpdir listings.
export const newCloneId = templateName => {
  const safe = templateName.replace(/[^a-z0-9-]/gi, '-');
  return `${safe}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
};

// ── CLONE_SKIP — will be replaced by PURGEABLE_DIRS from session-lifecycle ───
// Define here as a local fallback; import PURGEABLE_DIRS once session-lifecycle
// is implemented and remove this block.

const CLONE_SKIP = new Set([
  'SingletonLock', 'SingletonCookie', 'SingletonSocket',
  'GPUCache', 'Code Cache', 'ShaderCache', 'GrShaderCache', 'Crashpad',
]);

// ── cloneProfileAtomic ────────────────────────────────────────────────────────

export const cloneProfileAtomic = async (srcDir, templateName) => {
  const cloneId = newCloneId(templateName);
  const dest    = join(tmpdir(), `${CLONE_PREFIX}${cloneId}`);

  await cp(srcDir, dest, {
    recursive: true,
    // COPYFILE_FICLONE: reflink hint (btrfs, APFS, XFS). Falls back to full copy silently.
    mode: constants.COPYFILE_FICLONE,
    filter: p => !CLONE_SKIP.has(basename(p)),
  });

  await writeFile(join(dest, '.clone'), JSON.stringify({
    pid:          process.pid,
    created:      Date.now(),
    templateName,
  }));

  return { cloneId, dir: dest };
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
    if (!e.isDirectory() || !e.name.startsWith(CLONE_PREFIX)) return;

    const full = join(tmpdir(), e.name);
    try {
      const meta = JSON.parse(await readFile(join(full, '.clone'), 'utf8'));

      // Gate 1: owning process still alive → keep.
      if (isPidAlive(meta.pid)) return;

      // Gate 2: within TTL → keep (clock-skew guard).
      if (now - meta.created <= CLONE_TTL_MS) return;

      await rm(full, { recursive: true, force: true });
    } catch {
      // No .clone or unreadable → truly orphaned.
      await rm(full, { recursive: true, force: true });
    }
  }));
};
```

### `pool.js` additions

Pool entries gain `isClone` and `cloneDir` so that `close` and `list` can route without requiring
callers to track session type separately.

```js
// packages/runtime/pool.js

// add() gains two optional trailing params.
export const add = (id, context, page, cdpPort, preset, label, isClone = false, cloneDir = null) => {
  sessions.set(id, { context, page, cdpPort, preset, label, createdAt: Date.now(), isClone, cloneDir });
};

// list() exposes isClone and cloneDir.
export const list = () =>
  Array.from(sessions.entries()).map(([id, s]) => ({
    id,
    preset:    s.preset,
    label:     s.label,
    createdAt: s.createdAt,
    isClone:   s.isClone,
    cloneDir:  s.cloneDir,
  }));
```

### `sessions.js` additions

`closeSession` is unchanged — template path only. `destroyClone` is the new clone-specific path.
The two functions are structurally separate; no branching inside either.

```js
// packages/runtime/sessions.js

import { rm } from 'fs/promises';

export const destroyClone = async cloneId => {
  const session = pool.get(cloneId); // throws SessionNotFoundError if absent

  if (!session.isClone) {
    throw new Error(`destroyClone: "${cloneId}" is a template session — use closeSession instead`);
  }

  await session.context.close();
  pool.remove(cloneId);

  if (session.cloneDir) {
    await rm(session.cloneDir, { recursive: true, force: true });
  }

  return { success: true, cloneId };
};
```

### `launch.js` additions

`launchClone` is a separate exported function — not a branch inside `launch()`. Both functions call
`readDevToolsPort` for port discovery. `cdpPortForId` is deleted; neither path uses it.

```js
// packages/runtime/launch.js

let _gcRegistered = false;
const ensureGcOnExit = () => {
  if (_gcRegistered) return;
  _gcRegistered = true;
  process.on('beforeExit', () => cleanupClones().catch(() => {}));
};

// Template launch — unchanged behaviour, port discovery updated.
export const launch = async (options = {}) => {
  ensureGcOnExit();
  await checkBrowser();
  await cleanupClones();

  // ... existing reuse / meta / effectiveOptions logic unchanged ...

  const userDataDir = storage.getUserDataDir(profile);

  const context = await _launchPersistentContext(userDataDir, {
    ...effectiveOptions,
    cdpPort: 0, // → --remote-debugging-port=0 inside _launchPersistentContext
  });

  const cdpPort    = await storage.readDevToolsPort(userDataDir);
  const cdpEndpoint = `http://localhost:${cdpPort}`;

  pool.add(profile, context, page, cdpPort, resolved.preset, resolved.label, false, null);

  await storage.saveMeta(profile, { ...meta, userDataDir });

  return {
    browser: context.browser(),
    context,
    cdpEndpoint,
    close: async () => {
      await storage.removeTransientFiles(userDataDir); // closes DevToolsActivePort gap
      const state = await context.storageState();
      await storage.saveState(profile, state);
      await storage.updateMeta(profile, { lastUsed: Date.now() });
      await context.close();
      pool.remove(profile);
    },
  };
};

// Clone launch — ephemeral, no meta/state persistence.
export const launchClone = async (options = {}) => {
  ensureGcOnExit();
  const { profile = 'default', ...launchOpts } = options;

  await checkBrowser();
  await cleanupClones();
  await storage.ensureSessionsDir();

  const templateDir            = storage.getUserDataDir(profile);
  const { cloneId, dir: cloneDir } = await storage.cloneProfileAtomic(templateDir, profile);

  const context = await _launchPersistentContext(cloneDir, {
    ...launchOpts,
    cdpPort: 0,
  });

  const cdpPort     = await storage.readDevToolsPort(cloneDir);
  const cdpEndpoint = `http://localhost:${cdpPort}`;

  const pages = context.pages();
  const page  = pages.length > 0 ? pages[0] : await context.newPage();

  pool.add(cloneId, context, page, cdpPort, null, null, true, cloneDir);

  return {
    browser: context.browser(),
    context,
    cdpEndpoint,
    cloneId,
    close: async () => {
      await context.close();
      pool.remove(cloneId);
      await rm(cloneDir, { recursive: true, force: true });
    },
  };
};
```

### `szkrabok_session.js` — MCP handler changes

```js
// src/tools/szkrabok_session.js

export const open = async ({ sessionName, url, launchOptions = {} }) => {
  validateLaunchOptions(launchOptions);

  const { isClone = false, ...restLaunchOptions } = launchOptions;

  if (isClone) {
    // Template must not be currently open when cloning.
    if (pool.has(sessionName)) {
      throw new Error(
        `Cannot clone "${sessionName}" while it is open. Close the template session first.`
      );
    }

    const handle  = await launchClone({ profile: sessionName, ...restLaunchOptions });
    const session = getSession(handle.cloneId);

    if (url) {
      await navigate(session.page, url);
    }

    return {
      success:         true,
      sessionName:     handle.cloneId,   // caller uses this for all subsequent calls
      isClone:         true,
      templateSession: sessionName,
      url,
      cdpEndpoint:     handle.cdpEndpoint,
    };
  }

  // Template path — unchanged.
  // ... existing open() logic ...
  return {
    success:     true,
    sessionName,
    isClone:     false,
    url,
    preset:      session.preset,
    label:       session.label,
    cdpEndpoint: handle.cdpEndpoint,
  };
};

export const close = async ({ sessionName }) => {
  const session = pool.get(sessionName); // throws if not found

  if (session.isClone) {
    return { ...(await destroyClone(sessionName)), sessionName };
  }

  return { ...(await closeSession(sessionName)), sessionName };
};

export const list = async () => {
  const poolSessions = listRuntimeSessions(); // pool.list() — all active entries
  const stored       = await listStoredSessions(); // sessions/ dirs on disk

  const activeMap = new Map(poolSessions.map(s => [s.id, s]));

  // Template sessions: stored on disk, may or may not be active.
  const templateEntries = stored.map(id => {
    const a = activeMap.get(id);
    return {
      id,
      isClone:  false,
      active:   !!a,
      preset:   a?.preset  ?? null,
      label:    a?.label   ?? null,
    };
  });

  // Clone sessions: active only (no disk presence in sessions/).
  const cloneEntries = poolSessions
    .filter(s => s.isClone)
    .map(s => ({
      id:              s.id,
      isClone:         true,
      active:          true,
      templateSession: s.cloneDir
        ? undefined
        : undefined, // templateSession stored in pool entry — see pool.add signature note below
    }));

  return {
    sessions: [...templateEntries, ...cloneEntries],
    server:   { version, source: process.argv[1] },
  };
};

export const deleteSession = async ({ sessionName }) => {
  const inPool = pool.has(sessionName);
  if (inPool && pool.get(sessionName).isClone) {
    throw new Error(`"${sessionName}" is a clone session — use close to destroy it`);
  }
  await deleteStoredSession(sessionName);
  return { success: true, sessionName };
};
```

**Note on `templateSession` in list:** `pool.add` should store `templateName` in the pool entry for
clones so that `list` can return `templateSession`. Add `templateName` as a field alongside
`isClone` and `cloneDir` in the pool entry. `launchClone` passes it; `list` reads it.

### `registry.js` — schema additions

```js
// session_manage inputSchema additions:

// In launchOptions properties:
'isClone': {
  type:        'boolean',
  default:     false,
  description: 'Clone the template session into an ephemeral copy. ' +
               'Returns a generated sessionName — use it for all subsequent calls. ' +
               'On close: browser stops, clone dir deleted, no state saved. ' +
               'Template session must be closed before cloning.',
},

// Update action description:
description: `${SZKRABOK} Manage browser sessions. ` +
  'action: open (launch/resume), close (save+close for templates; destroy for clones), ' +
  'list (templates + active clones), delete (templates only), endpoint (CDP/WS URLs). ' +
  'open with isClone:true creates an ephemeral clone — use the returned sessionName for ' +
  'browser_run, workflow_scrape, and close.',
```

---

## Directory structure

```
sessions/                          ← template profiles (persistent)
  {name}/
    profile/                       ← Chromium profile dir
    state.json
    meta.json

os.tmpdir()/
  szkrabok-clone-{cloneId}/        ← ephemeral clone dir
    <Chromium profile files>
    DevToolsActivePort             ← written by Chromium after binding
    .clone                         ← { pid, created, templateName }
```

`cloneProfileAtomic` always writes to `tmpdir()`.
`getUserDataDir` always points into `sessions/`.
No function crosses the boundary.

---

## File layout changes

```
packages/runtime/
  storage.js      + readDevToolsPort (poll, injectable timeout), newCloneId,
                    cloneProfileAtomic (.clone metadata, CLONE_SKIP → PURGEABLE_DIRS later),
                    cleanupClones (PID + TTL two-gate)
  pool.js         + isClone, cloneDir, templateName fields in entries and list()
  sessions.js     + destroyClone()
  launch.js       + launchClone() as separate export, both paths use readDevToolsPort,
                    remove cdpPortForId, register process.beforeExit → cleanupClones,
                    removeTransientFiles in template close() callback
  index.js        + export launchClone, destroyClone

src/tools/
  szkrabok_session.js   open() — isClone branch, launchClone call, generated sessionName
                        close() — isClone auto-route
                        list()  — merge stored + active clones
                        deleteSession() — guard against clone ids

src/tools/
  registry.js     + isClone field in launchOptions schema, updated descriptions

tests/node/runtime/
  pc-layer1.test.js     PC-1.* — storage unit tests (rename from cloning.test.js)
  pc-layer2.test.js     PC-2.* — pool unit tests
  pc-layer3.test.js     PC-3.* — sessions unit tests
  pc-layer4.test.js     PC-4.* — launch unit tests (mocked _launchPersistentContext)
  pc-layer5.test.js     PC-5.* — MCP tool unit tests (mocked runtime)
  pc-layer6.test.js     PC-6.* — real browser integration (rename from devtools-port.test.js)
```

`portAllocator.js` is **not needed** — eliminated by the `DevToolsActivePort` fix.

---

## Test plan

Identifier scheme: `PC-{layer}.{n}` — Profile Cloning, layer number, test number within layer.

### File naming and status

| File | Layer | Status |
|------|-------|--------|
| `tests/node/runtime/pc-layer1.test.js` | Storage — unit, no browser | rename from `cloning.test.js` (scaffolded) |
| `tests/node/runtime/pc-layer2.test.js` | Pool — unit | new |
| `tests/node/runtime/pc-layer3.test.js` | Sessions — unit, mocked pool | new |
| `tests/node/runtime/pc-layer4.test.js` | Launch — unit, mocked `_launchPersistentContext` | new |
| `tests/node/runtime/pc-layer5.test.js` | MCP tool — unit, mocked runtime | new |
| `tests/node/runtime/pc-layer6.test.js` | Real browser — integration | rename from `devtools-port.test.js` (scaffolded) |

Tests from scaffolded files carry over unchanged; gaps are new additions.

---

### PC-1 — storage (unit, no browser)
`tests/node/runtime/pc-layer1.test.js`

Gaps marked **[gap]** — not in the scaffolded file, must be added.

| ID | Test | Covers |
|----|------|--------|
| PC-1.1 | `readDevToolsPort` — standard format `"{port}\n/devtools/..."` | parse |
| PC-1.2 | `readDevToolsPort` — port-only content (no path line) | parse edge |
| PC-1.3 | `readDevToolsPort` — returns number, not string | type |
| PC-1.4 | `readDevToolsPort` — file absent → rejects | missing file |
| PC-1.5 | `readDevToolsPort` — **[gap]** file appears after 200 ms delay → resolves | polling path |
| PC-1.6 | `readDevToolsPort` — **[gap]** file never appears within `timeoutMs` → rejects | timeout |
| PC-1.7 | `readDevToolsPort` — **[gap]** content `"abc\n/devtools/..."` → throws invalid port | parse guard |
| PC-1.8 | `newCloneId` — returns non-empty string | format |
| PC-1.9 | `newCloneId` — starts with sanitised template name | readability |
| PC-1.10 | `newCloneId` — timestamp segment falls within call window | monotonic |
| PC-1.11 | `newCloneId` — two consecutive calls produce different ids | uniqueness |
| PC-1.12 | `cloneProfileAtomic` — returns `{ cloneId, dir }` | return shape |
| PC-1.13 | `cloneProfileAtomic` — dest dir exists and contains copied files | copy |
| PC-1.14 | `cloneProfileAtomic` — skips `SingletonLock` | skip list |
| PC-1.15 | `cloneProfileAtomic` — skips `GPUCache` directory | skip list |
| PC-1.16 | `cloneProfileAtomic` — copies dirs not in skip list | allow list |
| PC-1.17 | `cloneProfileAtomic` — writes `.clone` with `pid`, `created`, `templateName` | metadata |
| PC-1.18 | `cloneProfileAtomic` — two concurrent calls produce separate dirs and ids | concurrency |
| PC-1.19 | `cleanupClones` — deletes expired dir with dead PID | two-gate delete |
| PC-1.20 | `cleanupClones` — keeps dir with live PID regardless of age | live guard |
| PC-1.21 | `cleanupClones` — keeps dir with dead PID within TTL | TTL guard |
| PC-1.22 | `cleanupClones` — deletes orphaned dir with no `.clone` file | orphan |
| PC-1.23 | `cleanupClones` — **[gap]** no `szkrabok-clone-*` dirs present → runs without error | empty case |
| PC-1.24 | `cleanupClones` — **[gap]** non-clone dirs in tmpdir are ignored | prefix filter |

**PC-1.5 implementation note:** write `DevToolsActivePort` after a 200 ms `setTimeout`; call
`readDevToolsPort(dir, { timeoutMs: 1000 })`. No browser needed.

**PC-1.6 implementation note:** call `readDevToolsPort(emptyDir, { timeoutMs: 300 })`. Assert
rejects within ~350 ms. Requires the injectable `timeoutMs` option.

---

### PC-2 — pool (unit)
`tests/node/runtime/pc-layer2.test.js`

| ID | Test | Covers |
|----|------|--------|
| PC-2.1 | `pool.add(id, ...)` default → `isClone: false`, `cloneDir: null` | default values |
| PC-2.2 | `pool.add(cloneId, ..., true, '/tmp/...')` → `get(cloneId).isClone === true` | clone entry |
| PC-2.3 | `pool.get(cloneId).cloneDir` equals the passed dir | field stored |
| PC-2.4 | `pool.list()` entries all have `isClone` and `cloneDir` fields | list contract |
| PC-2.5 | `pool.list()` returns clone entries alongside template entries | mixed list |

---

### PC-3 — sessions (unit, mocked pool)
`tests/node/runtime/pc-layer3.test.js`

| ID | Test | Covers |
|----|------|--------|
| PC-3.1 | `destroyClone(cloneId)` — `context.close()` called | teardown |
| PC-3.2 | `destroyClone(cloneId)` — `pool.remove(cloneId)` called | pool cleanup |
| PC-3.3 | `destroyClone(cloneId)` — `rm(cloneDir, { recursive: true })` called | dir removal |
| PC-3.4 | `destroyClone(cloneId)` — `saveState` NOT called | no persistence |
| PC-3.5 | `destroyClone(cloneId)` — `updateMeta` NOT called | no persistence |
| PC-3.6 | `destroyClone(id)` where `isClone: false` → throws type guard error | guard |
| PC-3.7 | `destroyClone(unknown)` → throws `SessionNotFoundError` | pool miss |
| PC-3.8 | `closeSession(profile)` where `isClone: false` — still saves state | unchanged path |

---

### PC-4 — launch (unit, mocked `_launchPersistentContext`)
`tests/node/runtime/pc-layer4.test.js`

The mock writes a fake `DevToolsActivePort` in the provided `userDataDir` before returning, so
`readDevToolsPort` resolves without a real browser.

| ID | Test | Covers |
|----|------|--------|
| PC-4.1 | `launchClone({ profile })` — pool key is `cloneId`, not profile name | correct keying |
| PC-4.2 | `launchClone({ profile })` — pool entry has `isClone: true`, `cloneDir` set | pool record |
| PC-4.3 | `launchClone({ profile })` — returned `cdpEndpoint` uses port from `DevToolsActivePort` | TOCTOU fix |
| PC-4.4 | `launchClone({ profile })` — `cdpPortForId` is not called (deleted) | TOCTOU fix |
| PC-4.5 | `launchClone({ profile })` — two concurrent calls produce distinct `cloneId` and `cloneDir` | concurrency |
| PC-4.6 | `launchClone` returned `close()` — clone dir removed | cleanup |
| PC-4.7 | `launchClone` returned `close()` — `saveState` not called | no persistence |
| PC-4.8 | `launch({ profile })` — `cdpEndpoint` uses `DevToolsActivePort`, not hash | TOCTOU fix on template path |
| PC-4.9 | `ensureGcOnExit` called N times → `process.listenerCount('beforeExit')` increases by exactly 1 | idempotency |
| PC-4.10 | `cleanupClones` called at `launchClone` entry | GC on launch |

---

### PC-5 — MCP tool (unit, mocked runtime)
`tests/node/runtime/pc-layer5.test.js`

Mocks: `launchClone`, `destroyClone`, `pool`, `listStoredSessions`.

| ID | Test | Covers |
|----|------|--------|
| PC-5.1 | `open({ sessionName, launchOptions: { isClone: true } })` — response has `isClone: true` | open shape |
| PC-5.2 | `open(...)` with `isClone: true` — `sessionName` in response is generated clone id | id generation |
| PC-5.3 | `open(...)` with `isClone: true` — `templateSession` in response equals original name | traceability |
| PC-5.4 | `open(...)` with `isClone: true` while template is in pool — throws | open guard |
| PC-5.5 | `open(...)` with `isClone: false` — response has `isClone: false` | explicit false |
| PC-5.6 | `open(...)` with `isClone` omitted — response has `isClone: false` | default |
| PC-5.7 | `close({ sessionName: cloneId })` — routes to `destroyClone`, not `closeSession` | routing |
| PC-5.8 | `close({ sessionName: templateName })` — routes to `closeSession`, not `destroyClone` | routing |
| PC-5.9 | `list()` — includes active clone entry with `isClone: true` and `templateSession` | list shape |
| PC-5.10 | `list()` — clone id does not appear in `listStoredSessions()` result | no disk entry |
| PC-5.11 | `list()` — template entry appears with `isClone: false` alongside clone entry | mixed list |
| PC-5.12 | `deleteSession({ sessionName: cloneId })` — throws "use close to destroy a clone" | delete guard |

---

### PC-6 — real browser integration
`tests/node/runtime/pc-layer6.test.js`

Parameterised over all detected browser types (Chrome, Chromium/ungoogled, Playwright bundled
fallback). Tests skipped per browser type if binary not found.

| ID | Test | Covers |
|----|------|--------|
| PC-6.1 | Chromium writes `DevToolsActivePort` after launch with `--remote-debugging-port=0` | file presence |
| PC-6.2 | `readDevToolsPort` parses port from live `DevToolsActivePort` | parse with real content |
| PC-6.3 | Port from `DevToolsActivePort` accepts TCP connections | port live |
| PC-6.4 | `GET /json` on CDP port returns valid JSON array | CDP protocol |
| PC-6.5 | Two simultaneous launches against separate `userDataDir` get different ports | no collision |

---

## What is not addressed (and why)

**Distributed clone coordination** — out of scope. szkrabok is a single-process tool. If embedded in
a multi-host system, clone coordination belongs at that outer layer (Redis, etcd, DB), not here.

**Hybrid state authority** — template carries auth bootstrap, `state.json` carries volatile session
state. Option A (profile snapshot authoritative) is simpler and correct for the common case.
Hybrid is future work.

**`better-sqlite3` for WAL checkpoint** — see session-lifecycle feature. Not a dependency of this
feature.

---

## Engineering verdict

A clone is a session that destroys itself on close. The API surface reflects this: one tool
(`session_manage`), one identifier field (`sessionName`), one boolean flag (`isClone`) that drives
behaviour internally. Callers do not branch — they store whatever `open` returned and pass it to
subsequent calls unchanged.

The two correctness fixes (port TOCTOU via `DevToolsActivePort`, live-clone deletion via PID + TTL
two-gate) are independent of the API shape and apply to both template and clone launch paths.
