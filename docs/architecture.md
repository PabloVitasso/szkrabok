# Architecture

## Contents

- [Layer overview](#layer-overview)
- [Data flow](#data-flow)
- [File layout](#file-layout)
- [Tool ownership](#tool-ownership)
- [Runtime public API](#runtime-public-api)
- [Non-negotiable invariants](#non-negotiable-invariants)
- [launchOptions precedence](#launchoptions-precedence)
- [Session lifecycle](#session-lifecycle)
- [Pool scoping](#pool-scoping)
- [Stealth hacks](#stealth-hacks-preserve-on-upstream-updates)
- [Playwright patches](#playwright-patches-packagesruntimescriptspatch-playwrightjs)
- [Chromium resolution](#chromium-resolution)

---

## Layer overview

```
packages/runtime/    @szkrabok/runtime    — browser bootstrap, stealth, pool, storage
                                            zero MCP knowledge
src/                 MCP server           — transport + tools, imports from @szkrabok/runtime
tests/               test suites          — node:test (unit/contracts) + Playwright (integration/e2e)
```

## Data flow

```
Claude Code (LLM)
     |
     | MCP protocol (stdio)
     v
  src/index.js  (MCP server)
     |
     | @szkrabok/runtime
     v
  runtime.launch()  —  launchPersistentContext + stealth + storage
     |
     v
Persistent Browser Context (stealth + userDataDir + state.json)
     |
     v
sessions/{id}/
  profile/        Chromium native profile
  state.json      cookies + localStorage (saved on close, restored on open)
  meta.json       timestamps, config
```

## File layout

```
packages/runtime/
  index.js          Public API: launch, connect, closeSession, getSession,
                    listRuntimeSessions, updateSessionMeta, deleteStoredSession,
                    resolvePreset, PRESETS, closeAllSessions
  launch.js         The one true launchPersistentContext call; launch() and connect()
  sessions.js       closeSession, getSession, listSessions helpers
  pool.js           In-memory session registry { context, page, cdpPort, ... }
  config.js         TOML loader, preset resolution, findChromiumPath (async)
  stealth.js        enhanceWithStealth, applyStealthToExistingPage
  storage.js        Profile dirs, state.json save/restore
  logger.js         Logging helpers
  scripts/
    patch-playwright.js  playwright-core patches (postinstall)

  mcp-client/
    mcp-tools.js      GENERATED — mcpConnect() handle factory + JSDoc types
    runtime/
      transport.js    spawnClient() — stdio process lifecycle
      invoker.js      createCallInvoker() — serialization, closed guard
      logger.js       createLogger() — JSONL formatter
    adapters/
      szkrabok-session.js  szkrabok session adapter
    codegen/
      generate-mcp-tools.mjs  entry — spawns server, writes mcp-tools.js
      render-tools.js          pure: (tools[]) -> file content string
      schema-to-jsdoc.js       pure: (inputSchema) -> JSDoc type strings

src/
  index.js          MCP entry point, stdio transport
                    Always writes fatal startup errors to ~/.cache/szkrabok/startup.log
  config.js         MCP-layer config only: TIMEOUT, LOG_LEVEL, DISABLE_WEBGL
  cli/
    index.js        CLI program setup, version (read from package.json), parseAsync
    commands/
      init.js
      session.js
      open.js
      endpoint.js
      detect-browser.js
      install-browser.js
      doctor.js       — szkrabok doctor: checks node, playwright-core, patch, chromium, imports

  tools/
    registry.js           All tool definitions: name, handler, schema
    szkrabok_session.js   session_manage (open/close/list/delete/endpoint)
    szkrabok_browser.js   browser_run (code/file), browser.run_test
    workflow.js           workflow.scrape
    scaffold.js           scaffold.init

config/                   Playwright config modules (TypeScript, pure functions)
  env.ts                  Single process.env reader
  paths.ts                Single filesystem authority
  toml.ts                 loadToml() — loads + deep-merges base and local TOML
  preset.ts               resolvePreset() — for playwright.config.js use only
  session.ts              resolveSession() — session paths from env + paths
  browser.ts              resolveExecutable() — finds bundled or system Chromium
  projects.ts             integration, e2e project definitions

playwright.config.js      Root config — pure composition, no logic

szkrabok.config.toml          Browser identity presets — repo defaults (committed)
szkrabok.config.local.toml    Machine-specific overrides (gitignored)
szkrabok.config.local.toml.example  Template for local overrides

tests/
  node/               node:test specs — no browser
    basic.test.js     public API smoke tests
    schema.test.js    tool schema validation
    contracts.test.js architecture invariant checks (static analysis)
    runtime/
      unit.test.js           config, storage, stealth without MCP
      integration.test.js    session persistence across two launches

  playwright/
    integration/      Playwright, MCP over stdio, headless
      fixtures.js     spawnClient() + openSession() with headless:true default
      session.spec.js
      stealth.spec.js
      tools.spec.js
      interop.spec.js

    e2e/              Playwright, live external sites, headed browser
      fixtures.js           Path A: connect(CDP); Path B: launch({profile:'dev'})
      setup.js / teardown.js
      rebrowser.spec.js     bot-detector.rebrowser.net — 8/10 passing (headed only)
      rebrowser-mcp.spec.js same via MCP client
      intoli.spec.js        bot.sannysoft.com — 10 Intoli + 20 fp-collect checks
      navigator.spec.js     whatismybrowser.com navigator props

```

## Tool ownership

**Szkrabok** tools (5 total):
`session_manage` `workflow.scrape` `browser_run` `browser.run_test` `scaffold.init`

**@playwright/mcp** (separate MCP server — install alongside szkrabok):
`browser.{snapshot,click,type,navigate,navigate_back,close,drag,hover,evaluate,select_option,fill_form,press_key,take_screenshot,wait_for,resize,tabs,console_messages,network_requests,file_upload,handle_dialog,run_code,...}`

The two servers share a browser via CDP. Use `session_manage { "action": "endpoint" }` to get the `wsEndpoint`, then pass it to playwright-mcp via `--cdp-endpoint`.

## Runtime public API

```js
import {
  launch,                 // start a new browser session
  connect,                // connect to an already-running session via CDP endpoint
  checkBrowser,           // assert a usable browser exists; throws with install instructions if not
  closeSession,           // close and save a session
  getSession,             // get session handle from pool (throws if not open)
  listRuntimeSessions,    // list all open sessions
  updateSessionMeta,      // update session metadata
  deleteStoredSession,    // delete persisted session storage
  closeAllSessions,       // close all open sessions
  resolvePreset,          // resolve a named preset from TOML
  PRESETS,                // array of available preset names
} from '@szkrabok/runtime';
```

`launch()` signature:

```js
launch({
  profile?:  string,   // session name / profile dir key
  preset?:   string,   // TOML preset name (default: 'default')
  headless?: boolean,  // overrides TOML + env
  reuse?:    boolean,  // default: true — return existing if same profile already open
}) => Promise<{ browser, context, cdpEndpoint, close() }>
```

Do NOT import runtime internals (`stealth`, `storage`, `pool`, `config`) directly.

## Non-negotiable invariants

1. Only `packages/runtime/launch.js` calls `launchPersistentContext`
2. Stealth runs only during `runtime.launch()` — never conditionally, never elsewhere
3. Profile resolution happens only in runtime
4. MCP tools never import stealth, config internals, or storage directly
5. `tests/playwright/e2e/fixtures.js` never imports stealth or launches a browser directly
6. `browser.run_test` subprocess connects via `connectOverCDP` — it never calls `launch*()`

Enforced by ESLint boundary rules in `eslint.config.js` and `tests/node/contracts.test.js`.

## launchOptions precedence

```
launchOptions  >  savedConfig (last used)  >  TOML preset  >  TOML defaults  >  hardcoded defaults
```

- **`launchOptions`** — explicit per-call values from `session_manage (open)` or `mcpConnect`
- **`savedConfig`** — resolved config saved to `meta.json` on previous launch; provides "resume with same settings" when no explicit args given
- **`TOML preset`** — named preset from `szkrabok.config.toml` / `szkrabok.config.local.toml`
- **`TOML defaults`** — `[default]` section values
- **`hardcoded defaults`** — fallbacks in `packages/runtime/launch.js`

**Rules:**
- Passing an explicit `preset` bypasses `savedConfig` for preset-derived fields (userAgent, viewport, locale, timezone) — starts fresh from the preset
- `preset` is mutually exclusive with `userAgent`, `viewport`, `locale`, `timezone` — passing both throws
- `headless` and `stealth` are always allowed alongside either
- `executablePath` is TOML-only — not accepted in `launchOptions`

---

## Session lifecycle

```
session_manage { action: open, sessionName: id }
  -> runtime.launch({ profile: id })
  -> load sessions/{id}/profile/ as userDataDir
  -> derive cdpPort from id hash
  -> launchPersistentContext with --remote-debugging-port=cdpPort
  -> apply stealth (enhanceWithStealth + applyStealthToExistingPage)
  -> restore state.json: addCookies() + addInitScript() for localStorage
  -> store handle in pool

browser.run_test(id, files?, grep?, params?)
  -> getSession(id) — throws if not open
  -> read cdpEndpoint from session handle
  -> set SZKRABOK_CDP_ENDPOINT=cdpEndpoint
  -> spawn: npx playwright test [files] [--grep]
  -> subprocess fixture connects via connectOverCDP (no launch)
  -> parse JSON report, decode base64 result attachments
  -> return { passed, failed, tests: [{title, status, result}] }

session_manage { action: close, sessionName: id }
  -> context.storageState() -> save to state.json
  -> update meta.json -> context.close() -> remove from pool
  -> profile dir persisted automatically (userDataDir)
```

## Pool scoping

Pool is process-scoped — not global. Each process has its own pool. CDP endpoint is the cross-process identity.

- CLI `bebok open` holds a pool entry in its own process
- MCP server holds pool entries in its process
- A `browser.run_test` subprocess has no pool — it connects via `SZKRABOK_CDP_ENDPOINT`

## CLI (`bebok`) and MCP tools — shared handlers

`bebok` calls the same handler functions as the MCP tools (`szkrabok_session.js`). There is one code path for session operations — fixes and changes apply to both interfaces automatically.

CLI-only operations (no MCP equivalent):
- `bebok open` — human-facing browser launch, holds process alive
- `bebok session inspect` — raw cookie/localStorage dump from `state.json`
- `bebok endpoint` — prints CDP/WS endpoints to stdout

## Stealth hacks (preserve on upstream updates)

- **`Network.setUserAgentOverride`** is target-scoped — persists across navigations.
- **`page.addInitScript()`** is the correct API for init scripts — fires before page JS on every navigation.
- All property overrides must target **`Navigator.prototype`**, not the `navigator` instance.
- Rebrowser score: **8/10**. Permanent failures: `mainWorldExecution` (requires [rebrowser-patches](https://github.com/rebrowser/rebrowser-patches) binary patching — see [rebrowser-patches-research.md](./rebrowser-patches-research.md)), `exposeFunctionLeak` (`page.exposeFunction` fingerprint — no fix available).

## Playwright patches (`scripts/patch-playwright.js`)

Pattern-based patches applied to `node_modules/playwright-core` after `npm install`. Patch #8 injects greasy brands into `calculateUserAgentMetadata`. Run after any playwright-core version bump:

```bash
rm -rf node_modules/playwright-core
npm install --ignore-scripts
node scripts/patch-playwright.js
```

The script resolves `node_modules` relative to its own location (`__dirname`), not cwd — safe to run from any directory.

Detection sentinel: `__re__emitExecutionContext` in `lib/server/chromium/crConnection.js`. Use `szkrabok doctor` to verify patch status.

## Chromium resolution

`findChromiumPath()` in `packages/runtime/config.js` is async. Priority order:

1. `TOML [default].executablePath` — user-configured path (highest priority)
2. `chrome-launcher` — `Launcher.getInstallations()` finds system Chrome, Chromium, Brave, Edge across all standard install locations on Linux/macOS/Windows
3. Playwright bundled binary — `chromium.executablePath()` from the playwright package
4. `null` — `checkBrowser()` throws a deterministic error with install instructions

If no browser is found, `launch()` throws:
```
Chromium browser not found.

Run:
  npx playwright install chromium

Or:
  szkrabok install-browser
```

To inspect what is installed on your system:
```bash
szkrabok detect-browser
```
