# browser.bind() + wsEndpoint-on-open — Design Spec

**Date:** 2026-06-03
**Branch target:** main (new feature branch off main)
**Playwright version:** 1.60.0 (browser.bind introduced in 1.59)

---

## Problem

Two ergonomics gaps in the current session interop story:

1. **wsEndpoint requires a second round-trip.** `session_manage open` returns `cdpEndpoint` (HTTP). To get `wsEndpoint` for `@playwright/mcp --cdp-endpoint=`, callers must follow up with `session_manage endpoint`. This is a redundant call — the data is available at launch time.

2. **No named endpoint.** The only connection identity is a port number (`ws://localhost:54321/...`). Tools like `playwright-cli attach` and `@playwright/mcp --endpoint=` require a stable name, not a port URL. There is no way to get one today.

---

## Solution

Two additive changes, combined:

- **Alt 3:** Fetch and store `wsEndpoint` during `launch()`. Return it on `session_manage open` alongside `cdpEndpoint`. `session_manage endpoint` reads from pool (cache-first), no re-fetch.
- **Alt 2:** After launch, call `browser.bind(sanitizedName, { workspaceDir })` best-effort. Store `bindEndpoint` in pool. Return on open and endpoint responses. Unbind with timeout on close.

Both are fully additive. CDP path is unchanged. `bindEndpoint: null` and `wsEndpoint: null` are valid responses when the underlying calls fail.

---

## Architecture

### Files changed

| File | Change |
|---|---|
| `packages/runtime/endpoint-utils.js` | **New.** `fetchWsEndpoint(cdpPort)`, `sanitizeBindTitle(name)` |
| `packages/runtime/pool.js` | `add(id, context, page, opts)` — replace 12 positional args with opts object; add `wsEndpoint`, `bindEndpoint` fields |
| `packages/runtime/launch.js` | Use `tryBestEffort`; call `fetchWsEndpoint` + `browser.bind`; pass opts to pool.add; unbind-with-timeout on close |
| `packages/runtime/sessions.js` | Update `updateSessionPage` to use `pool.add(id, ctx, page, { ...session })` |
| `src/tools/szkrabok_session.js` | `open()` returns `wsEndpoint` + `bindEndpoint`; `endpoint()` reads from pool cache-first |

Clones (`launchClone`, `cloneFromLive`) are excluded. Clones are ephemeral with auto-generated IDs — binding them has no use case.

### New module: `packages/runtime/endpoint-utils.js`

Both functions throw on failure. Callers own their error handling (either via `tryBestEffort` or their own try/catch). This keeps the module pure and testable.

```js
// Throws if fetch fails or webSocketDebuggerUrl is missing.
export const fetchWsEndpoint = async cdpPort => {
  const res = await fetch(`http://localhost:${cdpPort}/json/version`);
  const { webSocketDebuggerUrl } = await res.json();
  if (!webSocketDebuggerUrl) throw new Error('webSocketDebuggerUrl missing');
  return webSocketDebuggerUrl;
};

// Named pipe titles: alphanumeric, hyphen, underscore only; max 64 chars.
// Prevents platform-specific named pipe path failures on Windows/macOS/Linux.
export const sanitizeBindTitle = name =>
  name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
```

### `pool.add()` refactor

Before (12 positional args, fragile):
```js
pool.add(id, context, page, cdpPort, preset, label, isClone, cloneDir, templateName, leaseHandle, pid, configHash);
```

After (options object):
```js
pool.add(id, context, page, { cdpPort, preset, label, isClone, cloneDir, templateName, leaseHandle, pid, configHash, wsEndpoint, bindEndpoint });
```

Pool entry stored object gains `wsEndpoint` and `bindEndpoint` fields (both nullable).

`updateSessionPage` in `sessions.js` becomes:
```js
const s = pool.get(profile);
pool.add(profile, s.context, page, { ...s });
```

---

## Data Flow

### launch() — new session

```
launchPersistentContext(userDataDir)
  → cdpPort = readDevToolsPort()
  → wsEndpoint    = tryBestEffort(() => fetchWsEndpoint(cdpPort), 'wsEndpoint')
  → title         = sanitizeBindTitle(profile)
  → workspaceDir  = configMeta?.source ? dirname(configMeta.source) : process.cwd()
  → bindEndpoint  = tryBestEffort(() => context.browser().bind(title, { workspaceDir }), 'bind')
  → pool.add(profile, context, page, { cdpPort, ..., wsEndpoint, bindEndpoint })
  → return { browser, context, cdpEndpoint, wsEndpoint, bindEndpoint, close() }
```

### launch() — reuse path

Reuse path (`reuse=true`, session already in pool) already has `wsEndpoint` and `bindEndpoint` stored. Return them directly from the existing pool entry. Do not re-bind.

### close()

```
try { await Promise.race([context.browser().unbind(), timeout(2000)]) } catch {}
context.storageState() → saveState()
updateMeta()
context.close()
waitForExit(pid)
pool.remove(profile)
```

Unbind runs before `context.close()` and is guarded by a 2-second timeout. A hung unbind never blocks session close.

### session_manage endpoint() — cache-first

```
session = getSession(name)
if session.wsEndpoint:
  wsEndpoint = session.wsEndpoint
else:
  try { wsEndpoint = await fetchWsEndpoint(session.cdpPort) } catch { wsEndpoint = null }
return { sessionName, cdpEndpoint, wsEndpoint, bindEndpoint: session.bindEndpoint }
```

`endpoint()` imports `fetchWsEndpoint` from `endpoint-utils.js` and wraps it in its own try/catch (same pattern as today, no change to observable behavior). No fetch at all when `session.wsEndpoint` is already populated.

---

## Internal helpers

`tryBestEffort` — defined in `launch.js`, not exported:

```js
const tryBestEffort = async (fn, label) => {
  try { return await fn(); }
  catch (err) { log(`${label} failed: ${err.message}`); return null; }
};
```

`timeout(ms)` utility (used for unbind guard) — one-liner defined at top of `launch.js`, not exported:

```js
const timeout = ms => new Promise(r => setTimeout(r, ms));
```

---

## Error handling

| Call | Failure mode | Effect |
|---|---|---|
| `fetchWsEndpoint` at launch | Chrome not yet responding to HTTP | `wsEndpoint: null`, session opens normally |
| `browser.bind()` | New API edge case; patched coreBundle conflict | `bindEndpoint: null`, session opens normally |
| `browser.unbind()` | Hung; already unbound; browser already closed | Times out after 2s, swallowed; close continues |
| `endpoint()` fallback fetch | Chrome stopped after launch | `wsEndpoint: null` in response, same as today |

---

## API surface

### session_manage open — response (template session)

```json
{
  "success": true,
  "sessionName": "dev",
  "cdpEndpoint": "http://localhost:54321",
  "wsEndpoint": "ws://localhost:54321/devtools/browser/guid",
  "bindEndpoint": "<raw endpoint string returned by browser.bind() — named pipe path or ws:// URL>",
  "preset": "default",
  "label": "Chrome (default)",
  "configSource": "/path/to/szkrabok.config.toml"
}
```

`wsEndpoint` and `bindEndpoint` may be `null` if the underlying calls failed. `cdpEndpoint` is always present. `bindEndpoint` is the raw value returned by `browser.bind()` — callers pass it directly to `chromium.connect()`, `playwright-cli attach`, or `@playwright/mcp --endpoint=`.

### session_manage endpoint — response

```json
{
  "sessionName": "dev",
  "cdpEndpoint": "http://localhost:54321",
  "wsEndpoint": "ws://localhost:54321/devtools/browser/guid",
  "bindEndpoint": "<same raw endpoint string, from pool>"
}
```

### Usage after open

```bash
# playwright-cli (human dev)
playwright-cli attach dev

# @playwright/mcp (MCP server)
@playwright/mcp --endpoint=dev

# Playwright client (programmatic)
const browser = await chromium.connect(bindEndpoint);

# CDP (unchanged, still works)
@playwright/mcp --cdp-endpoint=ws://localhost:54321/...
```

---

## Testing

### Node tests (no browser)

- `endpoint-utils.test.js` (new):
  - `sanitizeBindTitle`: slashes, spaces, dots, long names, already-clean names
  - `fetchWsEndpoint`: mock fetch returning `webSocketDebuggerUrl`; mock fetch throwing

- `pool.test.js` (extend existing):
  - `add()` with opts object stores all fields
  - `updateSessionPage` spread pattern preserves all fields including `wsEndpoint`, `bindEndpoint`

- `launch.test.js` (extend existing):
  - `browser.bind` throws → `bindEndpoint: null`, session opens
  - `browser.bind` succeeds → `bindEndpoint` in return value and pool entry
  - reuse path returns `wsEndpoint` + `bindEndpoint` from pool, does not re-bind

### Integration tests (real browser, headless)

- `session_manage open` returns non-null `wsEndpoint` and `bindEndpoint` for a fresh session
- `session_manage open` on already-open session (reuse) returns same `bindEndpoint` as first open
- `session_manage endpoint` returns matching `wsEndpoint` without re-fetching (log assertion)
- `session_manage close` completes within 5s even if unbind is mocked to hang

---

## Constraints and risks

- `browser.bind()` is new in Playwright 1.59. szkrabok uses `launchPersistentContext` → `context.browser()`. Whether `bind()` on a persistent-context browser exposes the existing context to connecting clients needs verification during implementation. If connecting clients see an empty `browser.contexts()`, the bind endpoint is less useful for @playwright/mcp but `playwright-cli attach` still works.
- szkrabok patches `coreBundle.js`. The patch targets execution context and stealth markers — it should not affect the `Browser` bind path, but must be confirmed by checking the patch diff against the `Browser` class.
- Named pipe semantics differ by OS. `sanitizeBindTitle` mitigates path issues. On Windows, named pipe limits apply (256 chars, no backslash); the 64-char cap and character whitelist cover this.

---

## Out of scope

- Explicit `session_manage bind` / `unbind` actions (can be added later if auto-bind proves insufficient)
- Clone session binding
- WebSocket mode (`host`/`port` options on `browser.bind`) — named pipe is the default and covers local use; WS mode can be a follow-on if remote access is needed
- Changes to `browser_run_test` subprocess — it continues to use `SZKRABOK_CDP_ENDPOINT`
