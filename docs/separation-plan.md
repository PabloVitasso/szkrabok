# Separation Plan — szkrabok Monorepo

## Context

szkrabok started as a playwright-mcp fork with stealth sprinkled in.
This plan refactors it into a layered monorepo with enforced invariants.

The driver: stealth, profiles, and browser lifecycle were embedded inside the
MCP transport layer. That creates false coupling and prevents running tests
from VSCode (or CI) without an MCP server.

---

## Non-Negotiable Invariants

These must hold permanently. Any violation is an architectural regression.

1. Only `@szkrabok/runtime` may call `launchPersistentContext`
2. Stealth runs only during runtime launch — never conditionally, never elsewhere
3. Profile resolution happens only in runtime
4. MCP never imports stealth, config, or storage directly
5. Consumer fixture never imports stealth
6. Dev, MCP, and CI must use identical launch code paths
7. `runtime.launch()` is idempotent per profile within a process (see Pool section)
8. `browser.run_test` must not launch Chromium independently — runtime is authoritative

Enforced via ESLint rules (see Phase 6) and contract tests (see Phase 5).

---

## Target Architecture

```
packages/
  runtime/       @szkrabok/runtime      — browser bootstrap, zero MCP knowledge
  mcp/           @szkrabok/mcp          — transport + tools, depends on runtime
  mcp-client/    @szkrabok/mcp-client   — consumer harness client, zero szkrabok deps

automation/      reference consumer (uses runtime + mcp-client)
selftest/        runtime unit + integration tests
```

### Layer responsibilities

```
@szkrabok/runtime
    config        TOML loader, preset resolution, browser resolution
    stealth       playwright-extra + stealth plugin, init scripts, UA override
    storage       profile dirs, state.json save/restore, cookie/localStorage
    pool          in-memory session registry { context, page, cdpPort }
    launch()      the one true browser bootstrap entry point

@szkrabok/mcp
    transport     MCP stdio/HTTP server
    tools         session.*, nav.*, interact.*, extract.*, workflow.*, browser.*
                  — all call runtime.launch() / runtime.pool, nothing else

@szkrabok/mcp-client
    mcpConnect()  session-aware MCP client factory (consumer-facing)
    spawnClient() stdio process lifecycle
    mcp-tools.js  GENERATED — namespaced handle factory + JSDoc types
    codegen/      generate-mcp-tools.mjs, render-tools.js, schema-to-jsdoc.js
```

### Public API — `@szkrabok/runtime`

```js
// Launch a new browser session.
// Returns handle; caller must call close() when done.
launch(options?: {
  profile?: string,   // session name / profile dir key
  preset?:  string,   // TOML preset name (default: "default")
  headless?: boolean, // overrides TOML + env
}) => Promise<{
  browser:     Browser,
  context:     BrowserContext,
  cdpEndpoint: string,
  close():     Promise<void>,
}>

// Connect to an already-running runtime session (dev/CI).
connect(cdpEndpoint: string) => Promise<{
  browser:  Browser,
  context:  BrowserContext,
}>
```

DO NOT expose: page, storage internals, stealth utilities, pool directly.

#### Pool is process-scoped

Pool is not global. Each process (MCP server, CLI, test runner) has its own
pool. CDP endpoint is the cross-process identity — it is the only value that
meaningfully crosses process boundaries.

Consequences:
- CLI `szkrabok open` holds a pool entry in its own process
- MCP server holds its own pool entries in its process
- A test subprocess spawned by `browser.run_test` has no pool — it connects
  via `SZKRABOK_CDP_ENDPOINT` which points to the MCP process's running browser
- This is correct behavior; do not attempt to share pool state across processes

#### Idempotency (`reuse` option)

Within a single process, calling `launch({ profile })` twice for the same
profile must not create two browser contexts.

```js
launch(options?: {
  profile?:  string,
  preset?:   string,
  headless?: boolean,
  reuse?:    boolean,  // default: true — return existing if profile already open
})
```

If `reuse: true` (default) and the profile is already in pool, return the
existing handle without launching a new browser. This prevents accidental
context duplication in dev mode (e.g. fixture called twice, globalSetup +
test both calling launch).

If `reuse: false`, force a new context (explicit intent required).

---

## Phase 1 — Extract `@szkrabok/runtime`

Move into `packages/runtime/`:

| Current location | Moves to |
|------------------|----------|
| `src/config.js` + `config/` | `packages/runtime/config/` |
| `src/core/szkrabok_stealth.js` | `packages/runtime/stealth.js` |
| `src/core/storage.js` | `packages/runtime/storage.js` |
| `src/core/pool.js` | `packages/runtime/pool.js` |
| `src/upstream/wrapper.js` (launchPersistentContext call) | `packages/runtime/launch.js` |
| `scripts/patch-playwright.js` | `packages/runtime/scripts/patch-playwright.js` (postinstall) |

Remove from runtime:
- Any MCP import or reference
- Any Playwright Test (`@playwright/test`) import
- Any CLI coupling

`packages/runtime/index.js` exports only: `launch`, `connect`.

---

## Phase 2 — Refactor `@szkrabok/mcp`

Move `src/` into `packages/mcp/` (or keep in place, adjust imports).

Changes:
- All tool handlers import runtime via `@szkrabok/runtime`
- Remove direct imports of stealth, config, storage from tools
- `browser.run_test`: add optional `cwd` and `config` params so external
  project specs can be referenced by absolute path
- Pool access goes through runtime only

#### `browser.run_test` — required flow

```
MCP tool (browser.run_test)
   └── session already open in runtime.pool (runtime.launch() was called at session.open)
   └── read cdpEndpoint from pool
   └── set SZKRABOK_CDP_ENDPOINT=<cdpEndpoint>
   └── spawn: npx playwright test [files] [--config] [--grep]
        └── fixture sees SZKRABOK_CDP_ENDPOINT
        └── connectOverCDP(endpoint)  ← only browser action in subprocess
        └── tests run against live session
```

The spawned subprocess must NOT call `runtime.launch()` or `chromium.launch*`.
It only connects. Runtime in the MCP process is authoritative; the subprocess
is a client of the already-running browser.

This flow is preserved by invariant #8. The contract test in Phase 5.3 must
verify that no `launchPersistentContext` call occurs within the subprocess.

`packages/mcp/package.json` lists `@szkrabok/runtime` as a dependency.

---

## Phase 3 — Rewrite Consumer Fixture

`automation/fixtures.js` becomes two clean paths:

### Path A — MCP / CDP mode

```js
if (process.env.SZKRABOK_CDP_ENDPOINT) {
  const { connect } = await import('@szkrabok/runtime');
  const { context } = await connect(process.env.SZKRABOK_CDP_ENDPOINT);
  // use context
}
```

### Path B — Dev mode (VSCode, standalone)

```js
const { launch } = await import('@szkrabok/runtime');
const { context, close } = await launch({ profile: 'dev' });
// use context
// on teardown: close()
```

No conditional stealth logic.
No direct `chromium.launch`.
No config parsing in fixture.
No imports from MCP package.

Stealth, profile, and cookies are applied automatically by runtime in both paths.

---

## Phase 4 — CLI

Current `src/cli.js` (bebok) handles session list/inspect/delete/cleanup.

Add:

```
szkrabok open <profile>
```

Internally:
- calls `runtime.launch({ profile })`
- prints `cdpEndpoint` to stdout
- keeps process alive until SIGINT
- calls `close()` on exit

This gives VSCode / dev a one-command session start with full stealth + persistence,
no MCP server required.

CLI depends on `@szkrabok/runtime` only. Not on MCP.

---

## Phase 5 — Testing Strategy

Four test categories, each validates a specific invariant.

### 5.1 Runtime Unit Tests (`selftest/runtime/`)

Run without MCP, without Playwright Test runner.

**Config**
- Loads TOML from cwd
- Preset resolution merges correctly
- Missing preset throws with clear message

**Storage**
- Profile dir is created on first launch
- state.json is written on close
- state.json is read and cookies restored on reopen

**Stealth**
After `runtime.launch()`:
- `navigator.webdriver === false`
- `navigator.plugins.length > 0`
- `userAgent` matches TOML preset if configured

### 5.2 Runtime Integration Tests (`selftest/runtime/integration/`)

Launch runtime twice with same profile name.

Assertions:
1. Cookie set in run #1 is present in run #2
2. Profile directory path is identical between runs
3. state.json reflects cookie changes after each close

Proves session persistence works outside MCP.

### 5.3 MCP Contract Tests (`selftest/mcp/`)

Mock `@szkrabok/runtime`.

Verify:
1. No MCP tool handler calls `chromium.launch` or `chromium.launchPersistentContext` directly
2. Every session open in MCP goes through `runtime.launch()`
3. Pool access in MCP tools does not bypass runtime

Implementation: static import analysis or Jest module mock, depending on tooling choice.

### 5.4 Fixture Parity Tests

Run the same test suite in both fixture modes against the same profile.

**Mode A**: `runtime.launch()` via fixture (dev path)
**Mode B**: `szkrabok open` → CDP connect via fixture (MCP path)

Assertions (must match between modes):
1. User-Agent string
2. Cookie presence after set
3. Profile directory path
4. `navigator.webdriver === false`
5. Headless flag respected

If any assertion differs between modes, the architecture has drifted.

---

## Phase 6 — ESLint Enforcement

Three rules at repo root, applied via `eslint.config.js`:

**Rule 1**: No `chromium.launch` / `chromium.launchPersistentContext` outside `packages/runtime`

**Rule 2**: No import of `szkrabok_stealth` or stealth internals outside `packages/runtime`

**Rule 3**: No import of runtime internals (`stealth`, `storage`, `pool`) directly —
only `launch` and `connect` from the runtime public API

These run in CI as a pre-test step. Failure blocks merge.

---

## Phase 7 — CI Pipeline

```
1. eslint --rule boundary checks         (Phase 6 rules)
2. runtime unit tests                    (Phase 5.1)
3. runtime integration tests             (Phase 5.2)
4. mcp contract tests                    (Phase 5.3)
5. szkrabok open dev-ci                  (CLI starts session)
6. fixture parity tests — CDP mode       (Phase 5.4 mode B)
7. fixture parity tests — runtime mode   (Phase 5.4 mode A)
8. compare artifacts                     (fail if they diverge)
```

---

## Migration Notes

### `src/upstream/wrapper.js`
The `launchPersistentContext` wrapper abstraction can be dropped.
Runtime owns the call directly; the upstream wrapper becomes dead code.

### `scripts/patch-playwright.js`
Patches `playwright-core` to inject greasy brands into `calculateUserAgentMetadata`.
Moves to `packages/runtime/scripts/patch-playwright.js`.
Runs as `postinstall` in `packages/runtime/package.json`.
Must run after any `playwright-core` version bump.

### `mcp-client/`
Becomes `packages/mcp-client/` → `@szkrabok/mcp-client`.
Add `postinstall` to auto-generate `mcp-tools.js`.
Export `mcpConnect` from `packages/mcp-client/index.js`.
No dependency on runtime or mcp packages.

### `automation/`
Stays as reference consumer. After migration it imports only:
- `@szkrabok/runtime` (fixture)
- `@szkrabok/mcp-client` (harness specs)
- Standard `@playwright/test`

No imports from `src/` or internal package paths.

---

## What This Achieves

- VSCode Playwright extension works: fixture calls `runtime.launch()` directly
- Persistent profile + cookies in dev: runtime manages it, same as MCP
- Stealth in exactly one place: runtime only, never conditional
- MCP is transport only: no browser knowledge
- External consumer projects: install `@szkrabok/runtime` + `@szkrabok/mcp-client`,
  write specs, get stealth + persistence with no MCP server in dev
- CI parity: identical launch code in all environments
