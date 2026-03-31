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
                     ./fixtures export    — versioned Playwright fixture (src/fixtures.js);
                                            CDP + standalone paths; signal write at attach time
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
  index.js          Public API: launch, connect, checkBrowser, closeSession, getSession,
                    listRuntimeSessions, updateSessionMeta, deleteStoredSession,
                    resolvePreset, getPresets, closeAllSessions, initConfig, getConfig,
                    mcpConnect, spawnClient
  launch.js         The one true launchPersistentContext call; launch() and connect()
  sessions.js       closeSession, getSession, listSessions helpers
  pool.js           In-memory session registry { context, page, cdpPort, pid, isClone, cloneDir, templateName, leaseHandle, ... }
  config.js         Config discovery: initConfig(roots), getConfig(), resolvePreset(), getPresets(), findChromiumPath()
  stealth.js        enhanceWithStealth, applyStealthToExistingPage
  storage.js        Profile dirs, state.json save/restore;
                    FD lease (acquireLease, leaseFree); iterative BFS cloneDir;
                    rmWithRetry; time-gated cleanupClones (60 s cooldown)
  logger.js         Logging helpers
  scripts/
    patch-playwright.js  playwright-core patch script — used to regenerate patches/ on version upgrade

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
  config.js         Re-exports initConfig/getConfig from @szkrabok/runtime; DEFAULT_TIMEOUT constant
  attach-signal.js  writeAttachSignal(path) — best-effort atomic tmp→rename, fail-fast, no-op on falsy
  fixtures.js       @pablovitasso/szkrabok/fixtures export — resolveConfig, session/browser/page fixtures
                    with ownsBrowser; signal written at CDP attach time; context not overridden (Playwright scope conflict)
  cli/
    index.js        CLI program setup, version (read from package.json), parseAsync
    commands/
      init.js
      session.js
      open.js
      endpoint.js
      doctor.js       — szkrabok doctor: checks node, playwright-core, patch, browser resolution chain, imports
                         Subcommands: detect [--write-config], install [--force]
    lib/
      browser-actions.js  — shared runDetect() / runInstall() / writeExecPath() used by doctor subcommands

  utils/
    logger.js             log() — structured JSONL output
    errors.js             SessionNotFoundError, SessionExistsError, ValidationError
    platform.js           platformCacheDir() — OS-aware cache path
    lock.js               acquireLock/releaseLock/withLock — blocking file lock, cross-process safe,
                          stale-TTL cleanup, Windows-safe filename sanitizer

  tools/
    registry.js           All tool definitions: name, handler, schema
    szkrabok_session.js   session_manage (open/close/list/delete/endpoint)
    szkrabok_browser.js   browser_run (code/file), browser_run_test
    session_run_test.js   session_run_test — composite: open session → navigate → run_test → post-policy
    workflow.js           browser_scrape
    scaffold.js           scaffold_init

config/                   Playwright config modules (TypeScript, pure functions)
  env.ts                  Single process.env reader
  paths.ts                Single filesystem authority
  toml.ts                 loadToml() — loads + deep-merges base and local TOML
  preset.ts               resolvePreset() — for playwright.config.js use only
  session.ts              resolveSession() — session paths from env + paths
  browser.ts              resolveExecutable() — finds bundled or system Chromium
  projects.ts             integration, e2e project definitions

patches/
  playwright-core+<ver>.patch  committed diff applied by patch-package on npm install

scripts/
  patch-playwright.js          upgrade tool — generates new patch for a new pw version
  verify-playwright-patches.js postinstall verifier — checks all 7 patch markers, exits 1 on failure

playwright.config.js      Root config — pure composition, no logic

szkrabok.config.toml          Browser identity presets — repo defaults (committed)
szkrabok.config.local.toml    Machine-specific overrides (gitignored)
szkrabok.config.local.toml.example  Template for local overrides

tests/
  node/               node:test specs — no browser
    basic.test.js              public API smoke tests
    schema.test.js             tool schema validation
    contracts.test.js          architecture invariant checks (static analysis)
    playwright-patches.test.js verifies all 7 playwright-core patch markers are present
    session_run_test.test.js   session_run_test — 21 unit tests (EX-1); injected deps, no browser
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
      config-mcp-roots.spec.js
      session_run_test.spec.js  session_run_test — 3 integration tests (EX-2); real browser + subprocess

    e2e/              Playwright, live external sites, headed browser
      fixtures.js           Path A: connect(CDP); Path B: launch({profile:'dev'})
      setup.js / teardown.js
      noop.spec.js          minimal noop — inner spec used by session_run_test integration tests
      rebrowser.spec.js     bot-detector.rebrowser.net — 8/10 passing (headed only)
      rebrowser-mcp.spec.js same via MCP client
      intoli.spec.js        bot.sannysoft.com — 10 Intoli + 20 fp-collect checks
      navigator.spec.js     whatismybrowser.com navigator props

```

## Tool ownership

**Szkrabok** tools (6 total):
`session_manage` `session_run_test` `browser_scrape` `browser_run` `browser_run_test` `scaffold_init`

**@playwright/mcp** (separate MCP server — install alongside szkrabok):
`browser.{snapshot,click,type,navigate,navigate_back,close,drag,hover,evaluate,select_option,fill_form,press_key,take_screenshot,wait_for,resize,tabs,console_messages,network_requests,file_upload,handle_dialog,run_code,...}`

The two servers share a browser via CDP. Use `session_manage { "action": "endpoint" }` to get the `wsEndpoint`, then pass it to playwright-mcp via `--cdp-endpoint`.

## Runtime public API

```js
import {
  launch,                 // start a new browser session (template path)
  launchClone,            // launch an ephemeral clone of a template session
  connect,                // connect to an already-running session via CDP endpoint
  checkBrowser,           // assert a usable browser exists; throws with install instructions if not
  closeSession,           // close and save a session
  destroyClone,           // close and destroy a clone session
  getSession,             // get session handle from pool (throws if not open)
  listRuntimeSessions,    // list all open sessions
  updateSessionMeta,      // update session metadata
  deleteStoredSession,    // delete persisted session storage
  closeAllSessions,       // close all open sessions
  initConfig,             // discover and load config (call before any getConfig() use)
  getConfig,              // returns resolved config object (throws if initConfig not called)
  resolvePreset,          // resolve a named preset from config
  getPresets,             // returns array of available preset names
} from '@szkrabok/runtime';
```

`launch()` signature:

```js
launch({
  profile?:  string,   // session name / profile dir key
  preset?:   string,   // TOML preset name (default: 'default')
  stealth?:  boolean,  // overrides TOML stealth setting
  headless?: boolean,  // overrides TOML + env
  userAgent?: string,  // custom UA string
  viewport?:  { width, height },
  locale?:    string,  // BCP 47 locale
  timezone?:  string,  // IANA timezone
  reuse?:    boolean,  // default: true — return existing if same profile already open
}) => Promise<{ browser, context, cdpEndpoint, close() }>
```

`launchClone()` signature:

```js
launchClone({
  profile?: string,   // template session name (required)
  ...launchOpts       // same stealth/viewport/userAgent options as launch()
}) => Promise<{ browser, context, cdpEndpoint, cloneId, close() }>
```

Do NOT import runtime internals (`stealth`, `storage`, `pool`, `config`) directly.

## Non-negotiable invariants

1. Only `packages/runtime/launch.js` calls `launchPersistentContext`
2. Stealth runs only during `runtime.launch()` — never conditionally, never elsewhere
3. Profile resolution happens only in runtime
4. MCP tools never import stealth, config internals, or storage directly
5. `tests/playwright/e2e/fixtures.js` never imports stealth or uses internal modules directly — only public API
6. `browser_run_test` subprocess connects via `connectOverCDP` — it never calls `launch*()`
8. `src/fixtures.js` never reads `process.env` — env→option bridging is the consumer's `playwright.config.js` responsibility
9. `writeAttachSignal` is written at CDP attach time (before `await use(session)`), not at teardown
7. Browser PID is captured once at launch via `tryBrowserPid()` and stored in the pool entry — not re-read at close time

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

### Template session

```
session_manage { action: open, sessionName: id }
  -> runtime.launch({ profile: id })
  -> load sessions/{id}/profile/ as userDataDir
  -> launchPersistentContext(userDataDir, { cdpPort: 0 })
  -> poll DevToolsActivePort for bound port
  -> apply stealth (enhanceWithStealth + applyStealthToExistingPage)
  -> restore state.json: addCookies() + single-page localStorage restore
  -> store handle in pool (pid captured at launch time)

session_manage { action: close, sessionName: id }
  -> context.storageState() -> save to state.json
  -> update meta.json -> context.close() -> waitForExit(pid) -> remove from pool
  -> profile dir persisted automatically (userDataDir)
```

### Clone session

```
session_manage { action: open, sessionName: id, launchOptions: { isClone: true } }
  -> runtime.launchClone({ profile: id })
  -> acquire FD lease on staging dir
  -> iterative BFS copy to $TMPDIR/szkrabok-clone-{id} (skip PURGEABLE_DIRS)
  -> atomic rename to final path (cross-device: cp + rm fallback)
  -> launchPersistentContext(cloneDir, { cdpPort: 0 })
  -> poll DevToolsActivePort for bound port
  -> store handle in pool (pid captured at launch time)
  -> return generated cloneId

session_manage { action: close, sessionName: cloneId }
  -> context.close() -> waitForExit(pid) -> remove from pool
  -> rmWithRetry(cloneDir) -> lease.close()
  -> NO state saved
```

### browser_run_test

```
browser_run_test(id, files?, grep?, params?, workers?, signalAttach?, reportFile?)
  -> getSession(id) — throws if not open
  -> read cdpEndpoint from session handle
  -> set SZKRABOK_CDP_ENDPOINT=cdpEndpoint
  -> set PLAYWRIGHT_JSON_OUTPUT_NAME=jsonFile
     (reportFile arg if given, else sessions/<id>/last-run.json)
  -> if signalAttach: set SZKRABOK_ATTACH_SIGNAL=<signal-file-path>
  -> spawn: npx playwright test --reporter=list,json [files] [--grep] [--workers <n>]
  -> subprocess fixture connects via connectOverCDP (no launch)
  -> subprocess fixture writes SZKRABOK_ATTACH_SIGNAL file at CDP attach time (before tests run)
  -> if signalAttach: await waitForAttach(signalFile) — resolves immediately (file already written)
  -> parse JSON report, decode base64 result attachments
  -> return { passed, failed, tests: [{title, status, result}], reportFile }
```

### session_run_test

```
session_run_test({ session, test, postPolicy })
  [per-name withLock acquired]
  -> validate: url required if navigation.policy !== "never"
  -> resolve session:
       clone mode:  if template open → templateConflict policy (fail / close-first / clone-from-live)
                    else → sessionOpen({ isClone: true }) → runtimeName
       template mode: sessionOpen(name) → runtimeName = logicalName
  -> navigation barrier (if policy !== "never"):
       "always"  → page.goto(url, { waitUntil: "networkidle" })
       "ifBlank" → goto only if page.url() === "about:blank"
  -> browser_run_test(runtimeName, { workers:1, signalAttach:true, ...test })
  [withLock held until browser_run_test returns]
  -> post-policy:
       "destroy" → sessionClose (clone destroyed; no state saved)
       "save"    → sessionClose (template saved)
       "keep"    → verify session still open; error if not and recreateCloneOnKeep:false
  -> return { session: { logicalName, runtimeName, mode }, test: { ... } }
  [error paths return { error, phase: "session"|"test"|"postPolicy" }]
```

## Pool scoping

Pool is process-scoped — not global. Each process has its own pool. CDP endpoint is the cross-process identity.

- CLI `szkrabok open` holds a pool entry in its own process
- MCP server holds pool entries in its process
- A `browser_run_test` subprocess has no pool — it connects via `SZKRABOK_CDP_ENDPOINT`

## CLI (`szkrabok`) and MCP tools — shared handlers

`szkrabok` calls the same handler functions as the MCP tools (`szkrabok_session.js`). There is one code path for session operations — fixes and changes apply to both interfaces automatically.

CLI-only operations (no MCP equivalent):
- `szkrabok open` — human-facing browser launch, holds process alive
- `szkrabok session inspect` — raw cookie/localStorage dump from `state.json`
- `szkrabok endpoint` — prints CDP/WS endpoints to stdout
- `szkrabok doctor detect [--write-config]` — show all browser candidates; pin a path to config
- `szkrabok doctor install [--force]` — install Playwright Chromium (idempotent, `--force` to re-download)

## Stealth hacks (preserve on upstream updates)

- **`Network.setUserAgentOverride`** is target-scoped — persists across navigations.
- **`page.addInitScript()`** is the correct API for init scripts — fires before page JS on every navigation.
- All property overrides must target **`Navigator.prototype`**, not the `navigator` instance.
- Rebrowser score: **8/10**. Permanent failures: `mainWorldExecution` (requires [rebrowser-patches](https://github.com/rebrowser/rebrowser-patches) binary patching — see [rebrowser-patches-research.md](./rebrowser-patches-research.md)), `exposeFunctionLeak` (`page.exposeFunction` fingerprint — no fix available).

## Playwright patches (`patches/playwright-core+<version>.patch`)

playwright-core is pinned to an exact version and patched via `patch-package`. The committed diff in `patches/` is applied automatically on `npm install` via the postinstall chain:

```
scripts/apply-patches.js  →  scripts/verify-playwright-patches.js
```

`apply-patches.js` locates `playwright-core` and `patch-package` via Node's module resolution (works for hoisted, nested, and npx installs), then invokes `patch-package --patch-dir <path>`. It writes a minimal temporary `package.json` to `targetRoot` before invoking patch-package when none exists (bare temp dirs, npx), and removes it afterwards — patch-package requires a `package.json` to locate its app root.

`verify-playwright-patches.js` checks all 7 patched files for their markers and exits 1 (hard failure) if any are missing — the postinstall chain screams loudly rather than silently leaving the browser unpatched.

The 7 patched files and their detection markers:

| File | Marker |
|---|---|
| `lib/server/chromium/crConnection.js` | `__re__emitExecutionContext` |
| `lib/server/chromium/crDevTools.js` | `REBROWSER_PATCHES_RUNTIME_FIX_MODE` |
| `lib/server/chromium/crPage.js` | `szkrabok: greasy brands` |
| `lib/server/chromium/crServiceWorker.js` | `REBROWSER_PATCHES_RUNTIME_FIX_MODE` |
| `lib/server/frames.js` | `__re__emitExecutionContext` |
| `lib/server/page.js` | `getExecutionContext` |
| `lib/generated/utilityScriptSource.js` | `var __pwUs = class` |

Use `szkrabok doctor` to verify patch status at any time. For upgrading playwright-core to a new version, see [docs/development.md — Upgrading playwright-core](./development.md#upgrading-playwright-core). The patch script used to generate a new diff lives in `packages/runtime/scripts/patch-playwright.js`.

## Config discovery

`initConfig(roots?)` must be called before any `getConfig()` use. It runs the discovery algorithm once and caches the result. `roots` is an array of absolute paths from the MCP handshake (may be empty).

Priority order (first match wins):

```
1. SZKRABOK_CONFIG env var  → absolute path to a .toml file
2. SZKRABOK_ROOT env var    → walk-up within that root (bounded)
3. MCP roots                → for each root: walk-up within that root (bounded, first hit wins)
4. process.cwd()            → unbounded walk-up (CLI / test fallback)
5. ~/.config/szkrabok/config.toml
6. empty defaults
```

Walk-up: at each dir load `szkrabok.config.toml` then merge `szkrabok.config.local.toml` on top. Stop when a config is found or the boundary root is reached.

`src/server.js` calls `initConfig([])` on startup (cwd fallback active immediately), then re-calls `initConfig(rootPaths)` via `server.oninitialized` → `server.listRoots()` after the MCP handshake completes.

---

## Chromium resolution

Strict precedence (first valid candidate wins):

1. `CHROMIUM_PATH` env var — explicit override, highest priority
2. `getConfig().executablePath` — `executablePath` in `szkrabok.config.toml`
3. `chrome-launcher` — `Launcher.getInstallations()` finds system Chrome, Chromium, Brave, Edge across all standard install locations on Linux/macOS/Windows. `isFunctionalBrowser(path)` probe filters stub/broken paths before selection
4. Playwright bundled binary — `chromium.executablePath()` from the playwright package

`checkBrowser()` in `packages/runtime/launch.js` runs the full resolution chain via `resolveChromium()` (from `packages/runtime/resolve.js`). Each candidate is validated: exists, is a file, is executable. `null` — `checkBrowser()` throws a structured `BrowserNotFoundError` with install instructions.

If no browser is found, `launch()` throws a structured `BrowserNotFoundError` listing all four candidates (env, config, system, playwright) with their individual status:

```
Chromium not found.

Options (choose one):
  1. szkrabok doctor install          -- install Playwright's Chromium (idempotent)
  2. export CHROMIUM_PATH=/usr/bin/google-chrome   -- use system Chrome
  3. Set executablePath in szkrabok.config.toml     -- persistent config

Candidates checked:
  env:       CHROMIUM_PATH not set
  config:    executablePath not set
  system:    no Chrome installation found
  playwright: not installed
```

To inspect what is installed on your system:
```bash
szkrabok doctor detect              # shows full chain with pass/fail/skip/absent status
szkrabok doctor detect --write-config  # detect + pin the path to ~/.config/szkrabok/config.toml
```
