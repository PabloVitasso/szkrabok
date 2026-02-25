# Architecture

## Overview

```
Claude Code (LLM)
     |
     | MCP protocol (stdio/HTTP)
     v
   <- Node.js MCP server
     |
     | Playwright API
     v
Persistent Browser Context (stealth + userDataDir)
     |
     v
sessions/{id}/                     <- file storage
  meta.json                        <- timestamps, config
  storageState.json                <- cookies + localStorage (optional)
  profile/                         <- Chromium native profile
```

## File layout

```
src/
  index.js                MCP entry point, stdio transport, tool dispatch
  config.js               TOML + env config, resolvePreset(), findChromiumPath()
  cli.js                  bebok CLI — session list/inspect/delete/cleanup

  tools/
    registry.js           All tool definitions: name, handler, schema
    szkrabok_session.js   session.open/close/list/delete/endpoint
    szkrabok_browser.js   browser.run_test, browser.run_file  [szkrabok-only]
    navigate.js           nav.goto/back/forward
    interact.js           interact.click/type/select
    extract.js            extract.text/html/screenshot/evaluate
    workflow.js           workflow.login/fillForm/scrape
    playwright_mcp.js     browser.* (snapshot, click, type, navigate, ...)

  core/
    pool.js               In-memory session pool (id -> {context, page, cdpPort, preset, label})
    storage.js            Read/write sessions/ file storage
    szkrabok_stealth.js   playwright-extra + stealth plugin setup  [szkrabok-only]

  utils/
    errors.js             wrapError, structured error responses
    logger.js             log/logDebug/logWarn/logError; when log_level is "none"/empty/unset (the default) all logging is suppressed and no /tmp file is created (privacy); set log_level="debug" in local TOML to enable verbose file logging to /tmp/YYYYMMDDHHMMszkrabok-mcp.log

  upstream/
    wrapper.js            launchPersistentContext, navigate helpers

config/                   Playwright config modules (TypeScript, pure functions)
  env.ts                  Single process.env reader — only file that touches env vars
  paths.ts                Single filesystem authority — all paths defined here
  toml.ts                 loadToml() — loads + deep-merges base and local TOML
  preset.ts               resolvePreset() — merges [default] + [preset.<name>]
  session.ts              resolveSession() — resolves session paths from env + paths
  browser.ts              resolveExecutable() — finds bundled or system Chromium

playwright/
  projects/
    selftest.ts           selftest project definition
    client.ts             client project definition
    automation.ts         automation project definition

playwright.config.js      Root config — pure composition, no logic (~30 lines)

szkrabok.config.toml       Browser identity presets — repo defaults (committed)
szkrabok.config.local.toml Machine-specific overrides, gitignored — deep-merged on top

client/                   MCP client library (see docs/mcp-client-library.md)
  mcp-tools.js            GENERATED — namespaced handle factory + JSDoc types
  runtime/
    transport.js          spawnClient() — stdio process lifecycle
    invoker.js            createCallInvoker() — serialization, closed guard
    logger.js             createLogger() — JSONL formatter
  adapters/
    szkrabok-session.js   szkrabok session adapter — session open/close, sessionName wire key
  codegen/
    generate-mcp-tools.mjs  entry — spawns server, writes mcp-tools.js
    render-tools.js          pure: (tools[]) -> file content string
    schema-to-jsdoc.js       pure: (inputSchema) -> JSDoc type strings
  sequences/              stored JSONL call sequences for reuse

selftest/
  node/                   node:test specs — schema, basic, MCP protocol, scraping
  playwright/             playwright specs — session lifecycle, stealth, CSS tools
    fixtures.js           uses spawnClient() from client/runtime/transport.js; openSession() injects headless:true

automation/
  park4night.spec.js             cookie banner acceptance (headed + headless)
  intoli-check.spec.js           bot.sannysoft.com stealth check (10 Intoli + 20 fp-collect)
  rebrowser-check.spec.js        bot-detector.rebrowser.net (8/10 passing)
  navigator-properties.spec.js   whatismybrowser.com navigator props + userAgentData eval
  fixtures.js                    CDP session sharing + storageState fallback
  teardown.js                    saves storageState after run
  scripts/
    inspect-page.mjs             generic table+iframe inspector (browser.run_file)
```

## Tool ownership

**Szkrabok** (custom, `id`-based, CSS selectors):
`session.{open,close,list,delete,endpoint}` `nav.{goto,back,forward}` `interact.{click,type,select}` `extract.{text,html,screenshot,evaluate}` `workflow.{login,fillForm,scrape}` `browser.{run_test,run_file}`

**Playwright-MCP** (ref-based via snapshot):
`browser.{snapshot,click,type,navigate,navigate_back,close,drag,hover,evaluate,select_option,fill_form,press_key,take_screenshot,wait_for,resize,tabs,console_messages,network_requests,file_upload,handle_dialog,run_code,mouse_click_xy,mouse_move_xy,mouse_drag_xy,pdf_save,generate_locator,verify_element_visible,verify_text_visible,verify_list_visible,verify_value,start_tracing,stop_tracing,install}`

## Szkrabok-specific hacks (preserve on upstream updates)

- **TOML config** — two files: `szkrabok.config.toml` (committed, repo defaults) and `szkrabok.config.local.toml` (gitignored, machine-specific). Local is deep-merged on top of base at startup in both `src/config.js` and `config/toml.ts`. Keys: `overrideUserAgent`, `userAgent`, `executablePath`, `viewport`, `locale`, `timezone`, `label`, `headless`. `executablePath` selects the Chromium binary; use `bash scripts/detect_browsers.sh` to find options. Headless priority: `HEADLESS` env var -> `DISPLAY` presence -> TOML `[default].headless`.
- **Stealth** `core/szkrabok_stealth.js` — playwright-extra + stealth plugin; `user-data-dir` evasion disabled (conflicts with persistent profile); `applyStealthToExistingPage` applies evasions to the initial page which `launchPersistentContext` creates before `onPageCreated` fires; imported by both MCP session launch and standalone automation fixtures. **Critical constraints** (hard-won, do not revert):
  - `Network.setUserAgentOverride` is **target-scoped** — persists regardless of which CDP session drives navigation. Used for UA string, platform, Accept-Language.
  - `Page.addScriptToEvaluateOnNewDocument` via `newCDPSession` is **effectively session-scoped** — scripts registered this way never fire when navigations are driven by Playwright's own internal CDP session (e.g. `browser.navigate`, test runner). Dead end: do not use for init scripts.
  - **`page.addInitScript()`** is the correct API for init scripts — it uses Playwright's internal session and fires before page JS on every navigation regardless of which client navigates.
  - All property overrides must target **`Navigator.prototype`**, not the `navigator` instance. Defining on the instance makes the property visible in `Object.getOwnPropertyNames(navigator)`, which the rebrowser `navigatorWebdriver` check flags.
  - Rebrowser score: **8/10**. Permanent failures (no fix available): `mainWorldExecution` (requires rebrowser-patches binary patch), `exposeFunctionLeak` (`page.exposeFunction` fingerprint).
- **Playwright patches** `scripts/patch-playwright.js` — pattern-based patches applied to `node_modules/playwright-core` after `npm install`; patch #8 injects greasy brands generation into `calculateUserAgentMetadata` so `Emulation.setUserAgentOverride` includes correct brands; run `node scripts/patch-playwright.js` after any playwright-core version bump
- **CDP port** `tools/szkrabok_session.js` — deterministic port from session ID (`20000 + abs(hash) % 10000`); enables `chromium.connectOverCDP()`
- **Persistent profile** `core/storage.js` — sessions stored in `sessions/{id}/profile/`; no manual storageState saves
- **Test integration** `tools/szkrabok_browser.js` — `browser.run_test` spawns `npx playwright test` with `SZKRABOK_SESSION={id}`; `browser.run_file` runs a named export from an `.mjs` script; both connect via CDP — **`session.open` must be called first**

## Session lifecycle

```
session.open(id)
  -> load sessions/{id}/profile/ as userDataDir
  -> derive cdpPort from id hash
  -> launchPersistentContext with --remote-debugging-port=cdpPort
  -> store {context, page, cdpPort} in pool

browser.run_test(id, grep?, params?)
  -> verify session exists and has cdpPort
  -> spawn: npx playwright test with SZKRABOK_SESSION=id SZKRABOK_CDP_ENDPOINT=http://localhost:cdpPort
  -> fixtures.js connects to live browser via connectOverCDP
  -> tests run, attach JSON results via testInfo.attach('result')
  -> parse JSON report, return {passed, failed, tests}

session.close(id)
  -> update meta.json -> context.close() -> remove from pool
  -> profile persisted automatically (userDataDir)
```

## browser.run_test params flow

```
MCP call: {id, params: {url: "https://..."}, grep: "title"}
  -> TEST_URL=https://... env var
  -> SZKRABOK_SESSION=id, SZKRABOK_CDP_ENDPOINT=http://localhost:{port}
  -> npx playwright test --grep "title"
  -> parse JSON report: stats + base64 attachments decoded
  -> return {passed, failed, tests: [{title, status, result}]}
```

## Chromium resolution

`config/browser.ts` exports `resolveExecutable()`. It calls `chromium.executablePath()` and
returns `undefined` if the path exists (Playwright uses its bundled binary). If not found,
it parses the path to extract the cache prefix (e.g. `chromium-`), scans
`~/.cache/ms-playwright/` for installed versions, and returns the highest available.
`config.js` `findChromiumPath()` mirrors this logic for the MCP server process, with TOML
`executablePath` taking priority, then the Playwright cache, then system binaries.
