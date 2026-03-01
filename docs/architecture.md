# Architecture

## Layer overview

```
packages/runtime/    @szkrabok/runtime    — browser bootstrap, stealth, pool, storage
                                            zero MCP knowledge
packages/mcp-client/ @szkrabok/mcp-client — typed MCP client, mcpConnect(), codegen
src/                 MCP server           — transport + tools, imports from @szkrabok/runtime
selftest/            test suites          — runtime unit/integration, MCP contracts, playwright
automation/          szkrabok self-tests  — stealth checks, bot-detector specs
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
  config.js         TOML loader, preset resolution, findChromiumPath
  stealth.js        enhanceWithStealth, applyStealthToExistingPage
  storage.js        Profile dirs, state.json save/restore
  logger.js         Logging helpers
  scripts/
    patch-playwright.js  playwright-core patches (postinstall)

packages/mcp-client/
  index.js          Public API: mcpConnect, spawnClient
  mcp-tools.js      GENERATED — namespaced handle factory + JSDoc types
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
  config.js         MCP-layer config only: TIMEOUT, LOG_LEVEL, DISABLE_WEBGL
  cli.js            szkrabok CLI — session list/inspect/delete/cleanup + open <profile>

  tools/
    registry.js           All tool definitions: name, handler, schema
    szkrabok_session.js   session.open/close/list/delete/endpoint
    szkrabok_browser.js   browser.run_test, browser.run_file
    navigate.js           nav.goto/back/forward
    interact.js           interact.click/type/select
    extract.js            extract.text/html/screenshot/evaluate
    workflow.js           workflow.login/fillForm/scrape
    playwright_mcp.js     browser.* (snapshot, click, type, navigate, ...)
    wait.js               wait helpers

  upstream/
    wrapper.js            Page-operation helpers (navigate, getText, getHtml, ...)

config/                   Playwright config modules (TypeScript, pure functions)
  env.ts                  Single process.env reader
  paths.ts                Single filesystem authority
  toml.ts                 loadToml() — loads + deep-merges base and local TOML
  preset.ts               resolvePreset() — for playwright.config.js use only
  session.ts              resolveSession() — session paths from env + paths
  browser.ts              resolveExecutable() — finds bundled or system Chromium
  projects.ts             selftest, mcp, automation project definitions

playwright.config.js      Root config — pure composition, no logic

szkrabok.config.toml          Browser identity presets — repo defaults (committed)
szkrabok.config.local.toml    Machine-specific overrides (gitignored)
szkrabok.config.local.toml.example  Template for local overrides

selftest/
  node/               node:test specs — schema, basic, MCP protocol, scraping
  playwright/         Playwright specs — session lifecycle, stealth, CSS tools
    fixtures.js       spawnClient() + openSession() with headless:true default
  runtime/
    unit.test.js      Config, storage, stealth without MCP
    integration.test.js  Session persistence across two launches
  mcp/
    contract.test.js  Invariant checks — no direct launch calls in MCP tools

automation/
  fixtures.js             Path A: connect(SZKRABOK_CDP_ENDPOINT); Path B: launch({profile:'dev'})
  setup.js                globalSetup — prints resolved preset
  teardown.js             globalTeardown
  intoli-check.spec.js    bot.sannysoft.com — 10 Intoli + 20 fp-collect checks
  rebrowser-check.spec.js bot-detector.rebrowser.net — 8/10 passing (headed only)
  rebrowser-check.mcp.spec.js  same via MCP client
  navigator-properties.spec.js  whatismybrowser.com navigator props

dist/                     npm pack output — szkrabok-runtime-x.y.z.tgz etc. (gitignored)
```

## Tool ownership

**Szkrabok** (custom, CSS-selector-based):
`session.{open,close,list,delete,endpoint}` `nav.{goto,back,forward}` `interact.{click,type,select}` `extract.{text,html,screenshot,evaluate}` `workflow.{login,fillForm,scrape}` `browser.{run_test,run_file}`

**Playwright-MCP** (upstream, ref-based via snapshot):
`browser.{snapshot,click,type,navigate,navigate_back,close,drag,hover,evaluate,select_option,fill_form,press_key,take_screenshot,wait_for,resize,tabs,console_messages,network_requests,file_upload,handle_dialog,run_code,mouse_click_xy,mouse_move_xy,mouse_drag_xy,pdf_save,generate_locator,verify_element_visible,verify_text_visible,verify_list_visible,verify_value,start_tracing,stop_tracing,install}`

## Runtime public API

```js
import {
  launch,                 // start a new browser session
  connect,                // connect to an already-running session via CDP endpoint
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
5. `automation/fixtures.js` never imports stealth or launches a browser directly
6. `browser.run_test` subprocess connects via `connectOverCDP` — it never calls `launch*()`

Enforced by ESLint boundary rules in `eslint.config.js` and `selftest/mcp/contract.test.js`.

## Session lifecycle

```
session.open(id)
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

session.close(id)
  -> context.storageState() -> save to state.json
  -> update meta.json -> context.close() -> remove from pool
  -> profile dir persisted automatically (userDataDir)
```

## Pool scoping

Pool is process-scoped — not global. Each process has its own pool. CDP endpoint is the cross-process identity.

- CLI `szkrabok open` holds a pool entry in its own process
- MCP server holds pool entries in its process
- A `browser.run_test` subprocess has no pool — it connects via `SZKRABOK_CDP_ENDPOINT`

## Stealth hacks (preserve on upstream updates)

- **`Network.setUserAgentOverride`** is target-scoped — persists across navigations.
- **`page.addInitScript()`** is the correct API for init scripts — fires before page JS on every navigation.
- All property overrides must target **`Navigator.prototype`**, not the `navigator` instance.
- Rebrowser score: **8/10**. Permanent failures: `mainWorldExecution` (requires rebrowser-patches binary), `exposeFunctionLeak` (`page.exposeFunction` fingerprint — no fix available).

## Playwright patches (`packages/runtime/scripts/patch-playwright.js`)

Pattern-based patches applied to `node_modules/playwright-core` after `npm install`. Patch #8 injects greasy brands into `calculateUserAgentMetadata`. Run after any playwright-core version bump:

```bash
rm -rf node_modules/playwright-core
npm install --ignore-scripts
node packages/runtime/scripts/patch-playwright.js
```

## Chromium resolution

Priority (runtime and MCP both follow the same order):
1. `TOML [default].executablePath`
2. `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome` (highest version)
3. System binaries: `/usr/bin/chromium`, `/usr/bin/google-chrome`, etc.

Use `bash scripts/detect_browsers.sh` to find installed binaries.
