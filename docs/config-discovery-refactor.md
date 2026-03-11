# Config Discovery Refactor

## Problem

`packages/runtime/config.js` loads TOML at module init using `process.cwd()`.
When run as an MCP server, `process.cwd()` is the server install dir, not the user's project.
User configs in project dirs are silently ignored.

## Goals

- User's `szkrabok.config.local.toml` is found regardless of how the server is launched
- Playwright tests and CLI tools continue to work
- CI and monorepo setups work via env vars
- Multiple workspace roots are handled without config leakage between projects
- Config is cached per MCP connection, not per process

---

## Discovery Algorithm

Priority order (first match wins):

```
1. SZKRABOK_CONFIG env var (absolute path to toml file)
2. SZKRABOK_ROOT env var  -> walk-up within that root
3. MCP roots             -> for each root: walk-up within that root
4. process.cwd()         -> walk-up (unbounded, CLI/test fallback)
5. ~/.config/szkrabok/config.toml
6. {}  (empty defaults)
```

Walk-up rules:
- At each dir: load `szkrabok.config.toml` then merge `szkrabok.config.local.toml` on top
- Stop when a config is found or when the boundary root is reached (steps 2, 3)
- Step 4 is unbounded (no root defined) - acceptable for CLI tools where cwd is the project

MCP roots behavior:
- roots may be absent, empty, or arrive after init - all are handled
- check each root independently, return first root that contains a config
- no merging across roots (prevents cross-project leakage)

---

## Module Architecture

### Before (broken)

```
// module scope - runs once at require time
const toml = loadToml()                    // reads cwd - wrong for MCP server
export const HEADLESS = toml.headless      // frozen at startup
export const USER_AGENT = toml.userAgent
```

### After

```
// packages/runtime/config.js

let _config = null

export function initConfig(roots = []) {
  // called after MCP handshake, or at CLI startup with []
  // clears and rebuilds _config using discovery algorithm
  // populates cache: Map<rootPath, ResolvedConfig>
}

export function getConfig() {
  // returns _config, throws if initConfig was never called
  // callers use this inside function bodies, not at module scope
}
```

All consumers change from:

```js
import { HEADLESS, USER_AGENT } from './config.js'
// used at module scope
```

to:

```js
import { getConfig } from './config.js'

function launch(options) {
  const cfg = getConfig()
  const headless = options.headless ?? cfg.headless
  // ...
}
```

### Cache structure

```
Map<rootPath, ResolvedConfig>

ResolvedConfig {
  headless: bool
  userAgent: string
  viewport: { width, height }
  locale: string
  timezone: string
  stealth: object
  timeout: number
  logLevel: string
  disableWebgl: bool
  executablePath: string | null
}
```

Cache lifetime: per MCP connection. `initConfig()` replaces `_config` and resets the map.

---

## File Changes

### `packages/runtime/config.js`

- Remove top-level `loadToml()` call and all top-level `export const` values
- Add `initConfig(roots)` - runs discovery, builds `_config`, populates cache
- Add `getConfig()` - returns `_config`
- Keep `resolvePreset(name)` but read from `getConfig()` internally
- Keep `findChromiumPath()` unchanged (uses `getConfig().executablePath`)

### `packages/runtime/launch.js`

- Remove destructured imports from config at module scope
- Read `getConfig()` inside `launch()` body
- `resolvePreset` call stays, reads config internally

### `packages/runtime/stealth.js`

- Remove `import { STEALTH_CONFIG }` at module scope
- Call `getConfig().stealth` inside `enhanceWithStealth()` and `applyStealthToExistingPage()`

### `packages/runtime/logger.js`

- Remove `LOG_LEVEL` import at module scope
- Call `getConfig().logLevel` at log time

### `packages/runtime/index.js`

- Export `initConfig` so the MCP layer can call it

### `src/config.js`

- Same refactor: `TIMEOUT`, `LOG_LEVEL`, `DISABLE_WEBGL` become reads from `getConfig()`
- Add same discovery algorithm (shares logic via shared helper or duplicated for isolation)

### `src/index.js`

- On MCP startup: call `initConfig([])` immediately (safe default)
- After handshake completes and roots are received: call `initConfig(roots)`

---

## Progress

### Done
- [x] `packages/runtime/config.js` — `initConfig(roots)` / `getConfig()` / discovery algorithm
- [x] `packages/runtime/launch.js` — uses `getConfig()` inside `launch()` body
- [x] `packages/runtime/stealth.js` — uses `getConfig().stealth` at call time
- [x] `packages/runtime/logger.js` — reads `getConfig().logLevel` lazily, lazy file stream
- [x] `packages/runtime/index.js` — exports `initConfig`, `getConfig`, `getPresets`
- [x] `src/config.js` — re-exports `initConfig`/`getConfig` from runtime
- [x] `src/utils/logger.js` — lazy `getConfig()` with fallback
- [x] `src/tools/szkrabok_session.js` — uses `getConfig().timeout` at call time
- [x] `src/server.js` — `initConfig([])` on startup; `initConfig(roots)` after MCP handshake via `server.oninitialized` + `server.listRoots()`
- [x] `tests/node/config-discovery.test.js` — 13 discovery algorithm tests
- [x] `tests/node/config-values.test.js` — 7 defaults/fields/presets tests

- [x] `tests/playwright/integration/config-mcp-roots.spec.js` — MCP-over-stdio integration tests for roots → config flow

### Remaining
- [ ] Manual verification (bot.sannysoft.com UA test) — optional, E2E not automated

---

## Test Plan

### Node tests (`tests/node/`)

#### config-discovery.test.js (new)

Each test creates a temp dir tree, writes toml files, then calls `initConfig()` and checks `getConfig()`.

| Test | Setup | Expected |
|------|-------|----------|
| SZKRABOK_CONFIG | env var -> absolute toml path | that file loaded |
| SZKRABOK_ROOT | env var -> dir, toml in subdir | walk-up finds it |
| MCP roots single | roots=['/project'], toml at project root | loaded |
| MCP roots multiple, first has config | roots=['/a','/b'], toml only in /a | /a config loaded |
| MCP roots multiple, second has config | roots=['/a','/b'], toml only in /b | /b config loaded |
| MCP roots no config | roots=['/a'], no toml anywhere in /a | falls through |
| MCP roots absent | roots=[] | falls through to cwd |
| walk-up finds parent | toml in /project, cwd=/project/src/deep | found |
| walk-up stops at root boundary | toml above root, root=/project | not found, falls through |
| cwd fallback | no env, no roots, toml in process.cwd() | loaded |
| XDG fallback | no env, no roots, no cwd toml, XDG file exists | loaded |
| empty defaults | nothing found anywhere | getConfig() returns defaults, no throw |
| local overrides base | both toml and toml.local exist | local merged on top |
| cross-project isolation | two roots each with different UA | first root's UA used, second ignored |
| initConfig resets cache | call initConfig twice with different roots | second call wins |
| getConfig before init | call getConfig() without initConfig | throws clear error |

#### config-values.test.js (new)

- All `ResolvedConfig` fields have correct defaults when toml is empty
- TOML values map to correct config fields
- `resolvePreset(name)` returns correct merged values after `initConfig()`

### Integration tests (`tests/playwright/integration/`)

#### config-mcp-roots.spec.js (new)

Using MCP-over-stdio:

| Test | Setup | Expected |
|------|-------|----------|
| roots sent at init, UA in project toml | write toml to roots[0], open session | session UA matches toml |
| roots change on reconnect | restart MCP with different roots | new config picked up |
| no roots, SZKRABOK_CONFIG set | env var points to toml | config loaded |

### E2E tests (`tests/playwright/e2e/`)

No new e2e tests needed. Existing session open/scrape tests confirm behavior end-to-end once integration tests pass.

### Manual verification

After implementation, repeat the test from `szkrabok-minimal.md`:

1. Create `szkrabok.config.local.toml` in a test project dir with a custom `userAgent`
2. Open MCP session pointing roots at that dir
3. Open session, navigate to `bot.sannysoft.com`
4. Confirm `navigator.userAgent` matches the toml value

---

## Risks

| Risk | Mitigation |
|------|------------|
| `getConfig()` called before `initConfig()` | throw with clear message, caught in node tests |
| roots not sent by MCP client | falls through to cwd, existing behavior preserved |
| stealth reads config at call time, not module time | safe - stealth is only called during launch |
| two packages duplicate discovery logic | extract to shared internal helper in runtime, src imports it |

---

## Out of Scope

- File watching / hot reload (per-connection cache is enough)
- Config schema validation (existing behavior)
- `config/` TypeScript modules in repo root (separate build pipeline, not used at runtime)
