# Feature: Structured error diagnostics for MCP tools
## Feature (Done — 2026-05-06)

Implemented in: `packages/runtime/errors.js`, `packages/runtime/resolve.js`,
`packages/runtime/config.js`, `packages/runtime/pool.js`, `src/utils/errors.js`.

Tests: `tests/node/runtime/error-diagnostics.test.js` (33 tests).

---

## Goal

Give LLMs three deterministic answers on any MCP tool failure:

1. **What failed?** — `code`, `message`
2. **What should be done?** — `hint` (single imperative path, no branching)
3. **Why didn't my previous action work?** — `context.config.fileModifiedAt` vs `context.config.loadedAt`

## Problem

When an MCP tool fails, the LLM receives either a bare error code string or an
unstructured message blob. Neither is sufficient for autonomous diagnosis:

- No `hint` field → LLM parses free-text or invents explanations
- No `restartNeeded` flag → LLM cannot distinguish restart-required from retryable
- No `loadedAt` / `fileModifiedAt` → LLM cannot detect "wrote config after server started"

### Concrete incident

LLM wrote `~/.config/szkrabok/config.local.toml` to set `executablePath`. Browser
launch failed. `session_manage list` returned `config.source` but no timestamp.
LLM could not tell config was loaded before the file was written — invented a wrong
theory (wrong filename) instead of diagnosing "restart the MCP server".

---

## Contract

### Invariant fields (always present on error)

| Field | Rule |
|---|---|
| `code` | error class identifier (enum, uppercase) |
| `message` | compact, human-readable, lowercase — no fix steps, no verbs like "set"/"install"/"restart" |
| `hint` | single imperative remediation path — no `or`, no alternatives, no branching |

### Variant fields (present when applicable)

| Field | When present |
|---|---|
| `restartNeeded` | only when `true` and provably caused by stale process state (computed, never hardcoded) |
| `context` | error-specific diagnostic state — see depth rule below |
| `sessionId` | `SESSION_NOT_FOUND` only — scalar, promoted to root (no `context` wrapper) |

### `context` depth rule

Context values may be flat objects; no nesting beyond one level within `context`.
`context.config.source` is a scalar — valid. `context.config.nested.deep` — forbidden.
Omit `context` entirely when it would be empty.

### `context.attempted` — always complete, normalized values

All four keys must always be present. Missing key is ambiguous.

| Key | Source |
|---|---|
| `CHROMIUM_PATH` | env var |
| `executablePath` | config file field |
| `system` | chrome-launcher discovery |
| `playwrightBundled` | playwright bundled binary |

Normalized value set (no free text):

| Value | Meaning |
|---|---|
| `"not set"` | source not configured |
| `"set_invalid"` | user-provided value, path does not exist or not executable |
| `"resolved"` | valid and usable |
| `"not found"` | implicit/default source missing |

Constraint: `"not found"` must never apply to user-provided keys (`CHROMIUM_PATH`,
`executablePath`). User-provided path that fails validation → `"set_invalid"`.

### `restartNeeded` computation

Never hardcoded. Emit only when **both** conditions hold:

1. `context.config.fileModifiedAt > context.config.loadedAt` (config changed after server started)
2. A user-provided source (`CHROMIUM_PATH` or `executablePath`) is `"set_invalid"` or `"not set"`

If no browser exists anywhere and nothing was configured, restart changes nothing → omit.

### Hint generation rule — from `failureSource`

`hint` targets `failureSource`: the highest-precedence source that prevented resolution.
Runtime precedence (from [`20260330-defer-browser-install-done.md`](20260330-defer-browser-install-done.md),
invariant I4): `ENV > CONFIG > SYSTEM > PLAYWRIGHT`.

Examples:
- `CHROMIUM_PATH = set_invalid` → hint targets `CHROMIUM_PATH` (ENV wins, config override is pointless)
- `CHROMIUM_PATH = not set`, `executablePath = set_invalid` → hint targets `executablePath`
- Both not set → hint targets `executablePath` (persistent config preferred over ephemeral env var)

Always single path. The hint wording must match `failureSource`.

---

## Proposed changes

### 1. `config.loadedAt` in `getConfigMeta()` — `packages/runtime/config.js`

Add ISO timestamp (seconds precision) to `_configMeta` on every write:

```js
_configMeta = {
  phase: 'final',
  source,
  previousSource,
  searched,
  loadedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
};
```

`session_manage list` already forwards `getConfigMeta()` verbatim — no additional change needed there.

### 2. Error class changes — `packages/runtime/errors.js`

Existing codes already encode distinct semantics — give each a single-path hint:

```js
// CONFIG_NOT_INITIALIZED: server never ran init — restart is correct
constructor() {
  super('config not initialized');
  this.code = 'CONFIG_NOT_INITIALIZED';
  this.hint = 'restart MCP server';
}

// CONFIG_NOT_FINAL: server in provisional phase — retry is safe
constructor() {
  super('config not finalized');
  this.code = 'CONFIG_NOT_FINAL';
  this.hint = 'retry the call';
}
```

No `restartNeeded` on either — neither is caused by stale config file state.

### 3. `BrowserNotFoundError` — `packages/runtime/resolve.js`

```js
const SOURCE_KEY = {
  env: 'CHROMIUM_PATH',
  config: 'executablePath',
  system: 'system',
  playwright: 'playwrightBundled',
};
const USER_SOURCES = new Set(['env', 'config']);

// Hint templates indexed by failureSource key
const HINT = {
  CHROMIUM_PATH: 'unset or correct CHROMIUM_PATH env var in your MCP client config; restart MCP server',
  executablePath: 'run szkrabok doctor detect --write-config to correct the configured path; restart MCP server',
  system: 'run szkrabok doctor install to install a bundled browser',
  playwrightBundled: 'run szkrabok doctor install to install a bundled browser',
};

toJSON() {
  const attempted = {
    CHROMIUM_PATH: 'not set',
    executablePath: 'not set',
    system: 'not found',
    playwrightBundled: 'not found',
  };
  let failureSource = null;

  for (const c of this.candidates) {
    const key = SOURCE_KEY[c.source] ?? c.source;
    let value;
    if (!c.path) {
      value = 'not set';
    } else if (c.ok) {
      value = 'resolved';
    } else if (USER_SOURCES.has(c.source)) {
      value = 'set_invalid';
    } else {
      value = 'not found';
    }
    attempted[key] = value;
    // First non-resolved user-provided source is the failure source
    if (!failureSource && USER_SOURCES.has(c.source) && value !== 'resolved') {
      failureSource = key;
    }
  }
  // Fall back to first non-resolved source overall
  if (!failureSource) {
    failureSource = Object.keys(attempted).find(k => attempted[k] !== 'resolved') ?? 'playwrightBundled';
  }

  const meta = getConfigMeta();
  const loadedAt = meta?.loadedAt ?? null;
  const configFilePath = resolveConfigFilePath(meta?.source);  // derive path from source string
  const fileModifiedAt = configFilePath ? fileMtimeIso(configFilePath) : null;
  const restartNeeded = !!(
    loadedAt && fileModifiedAt && fileModifiedAt > loadedAt &&
    (attempted.CHROMIUM_PATH !== 'resolved' || attempted.executablePath !== 'resolved')
  );

  return {
    code: this.code,
    message: 'browser executable not found',
    hint: HINT[failureSource] ?? HINT.playwrightBundled,
    ...(restartNeeded && { restartNeeded: true }),
    context: {
      config: {
        source: this.configSource ?? 'none',
        ...(loadedAt && { loadedAt }),
        ...(fileModifiedAt && { fileModifiedAt }),
      },
      failureSource,
      attempted,
    },
  };
}
```

`candidates[]` remains on the instance for CLI/`szkrabok doctor` use. Not in `toJSON()` output.

`fileMtimeIso(path)` — thin wrapper: `statSync(path).mtime.toISOString().replace(/\.\d{3}Z$/, 'Z')`,
returns `null` on any error (file may not exist yet).

`resolveConfigFilePath(source)` — extracts the file path from the `source` string when
source points to a real file (e.g. `"xdg (~/.config/szkrabok)"` → derive actual path).
Returns `null` for `"none"` or env-var sources where no file is involved.

### 4. `SessionNotFoundError` — `packages/runtime/pool.js`

`sessionId` is a single scalar — inline at root, no `context` wrapper:

```js
constructor(id, customMessage = null) {
  super(customMessage || `session not found: ${id}`);
  this.code = 'SESSION_NOT_FOUND';
  this.sessionId = id;
  this.hint = 'reopen the session with session_manage open';
}
```

No `restartNeeded` — retryable without restart.

### 5. `wrapError()` — `src/utils/errors.js`

Single normalization path. Check for `toJSON` explicitly — do not trust class field correctness:

```js
export const wrapError = err => {
  if (typeof err.toJSON === 'function') return err.toJSON();
  if (err.code) {
    return {
      code: err.code,
      message: err.message,
      ...(err.hint && { hint: err.hint }),
      ...(err.restartNeeded && { restartNeeded: true }),
      ...(err.context && { context: err.context }),
      ...(err.sessionId && { sessionId: err.sessionId }),
    };
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: err.message || String(err),
    stack: err.stack,
  };
};
```

`BrowserNotFoundError.toJSON()` is the authoritative MCP serialization path for that class.
All other custom errors go through explicit field extraction.

---

## Output shapes

### `BROWSER_NOT_FOUND` — nothing configured, no browser installed

```json
{
  "code": "BROWSER_NOT_FOUND",
  "message": "browser executable not found",
  "hint": "run szkrabok doctor install to install a bundled browser",
  "context": {
    "config": {
      "source": "none"
    },
    "failureSource": "playwrightBundled",
    "attempted": {
      "CHROMIUM_PATH": "not set",
      "executablePath": "not set",
      "system": "not found",
      "playwrightBundled": "not found"
    }
  }
}
```

### `BROWSER_NOT_FOUND` — config written after server started

```json
{
  "code": "BROWSER_NOT_FOUND",
  "message": "browser executable not found",
  "hint": "run szkrabok doctor detect --write-config to correct the configured path; restart MCP server",
  "restartNeeded": true,
  "context": {
    "config": {
      "source": "xdg (~/.config/szkrabok)",
      "loadedAt": "2026-05-05T14:23:11Z",
      "fileModifiedAt": "2026-05-05T14:25:03Z"
    },
    "failureSource": "executablePath",
    "attempted": {
      "CHROMIUM_PATH": "not set",
      "executablePath": "not set",
      "system": "not found",
      "playwrightBundled": "not found"
    }
  }
}
```

### `BROWSER_NOT_FOUND` — env var set but invalid (overrides config)

```json
{
  "code": "BROWSER_NOT_FOUND",
  "message": "browser executable not found",
  "hint": "unset or correct CHROMIUM_PATH env var in your MCP client config; restart MCP server",
  "restartNeeded": true,
  "context": {
    "config": {
      "source": "xdg (~/.config/szkrabok)",
      "loadedAt": "2026-05-05T14:23:11Z",
      "fileModifiedAt": "2026-05-05T14:25:03Z"
    },
    "failureSource": "CHROMIUM_PATH",
    "attempted": {
      "CHROMIUM_PATH": "set_invalid",
      "executablePath": "resolved",
      "system": "not found",
      "playwrightBundled": "not found"
    }
  }
}
```

### `CONFIG_NOT_INITIALIZED`

```json
{
  "code": "CONFIG_NOT_INITIALIZED",
  "message": "config not initialized",
  "hint": "restart MCP server"
}
```

### `CONFIG_NOT_FINAL`

```json
{
  "code": "CONFIG_NOT_FINAL",
  "message": "config not finalized",
  "hint": "retry the call"
}
```

### `SESSION_NOT_FOUND`

```json
{
  "code": "SESSION_NOT_FOUND",
  "message": "session not found: my-session",
  "hint": "reopen the session with session_manage open",
  "sessionId": "my-session"
}
```

### `session_manage list` — `config` block delta

```json
{
  "config": {
    "phase": "final",
    "source": "xdg (~/.config/szkrabok)",
    "loadedAt": "2026-05-05T14:23:11Z",
    "previousSource": null,
    "searched": [...]
  }
}
```

---

## MCP vs CLI surface separation

`BrowserNotFoundError.candidates[]` — full per-source diagnostic chain with validation
reasons — is preserved on the instance for `szkrabok doctor` output. It must not appear
in `toJSON()`. Pattern consistent with Kubernetes: minimal user-facing surface, full
diagnostic verbosity available via dedicated tooling.

---

## Message constraint enforcement

`message` must contain no fix steps and no verbs like "set", "install", "restart",
"check". Enforcement via code review — the spec is the contract. If drift becomes
a recurring problem, add a lint rule.

---

## Out of scope

- `UNKNOWN_ERROR` (Playwright) taxonomy — separate work
- `session_run_test` phase diagnostics — different failure model
- `scaffold_init` warnings — already in `warnings[]`
- Action arrays, recovery enums, reload versioning
- Generalizing `restartNeeded` beyond provably-stale-state failures

---

## Definition of done

- [x] `getConfigMeta()` includes `loadedAt` (ISO, seconds precision, set on every `_configMeta` write)
- [x] `CONFIG_NOT_INITIALIZED` message `"config not initialized"`, hint `"restart MCP server"`, no `restartNeeded`
- [x] `CONFIG_NOT_FINAL` message `"config not finalized"`, hint `"retry the call"`, no `restartNeeded`
- [x] `BrowserNotFoundError.toJSON()` emits all four `attempted` keys always; `candidates[]` absent from output
- [x] `attempted` values strictly from normalized set; `"not found"` never on user-provided keys
- [x] `restartNeeded` computed (never hardcoded): only when `fileModifiedAt > loadedAt` and user source is failing
- [x] `failureSource` present in `context`; `hint` derived from `failureSource` via lookup table
- [x] `context.config.fileModifiedAt` present when config source resolves to a file; omitted (not null) otherwise
- [x] `context.config.loadedAt` omitted (not null) when unavailable
- [x] `SessionNotFoundError` message lowercase, `hint` present, `sessionId` at root, no `restartNeeded`
- [x] `wrapError()` calls `toJSON()` when present; otherwise extracts fields explicitly
- [x] Node tests: field presence, normalized values, message casing, `restartNeeded` computation logic
- [x] `session_manage list` includes `config.loadedAt` (verified manually or integration test)
