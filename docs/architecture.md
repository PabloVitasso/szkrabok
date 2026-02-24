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
    config.js             TOML + env config, resolvePreset(), findChromiumPath()

szkrabok.config.toml       Browser identity presets — repo defaults (committed)
szkrabok.config.local.toml Machine-specific overrides, gitignored — deep-merged on top

  utils/
    errors.js             wrapError, structured error responses
    logger.js             logError

  upstream/
    wrapper.js            launchPersistentContext, navigate helpers

selftest/
  node/                   node:test specs — schema, basic, MCP protocol, scraping
  playwright/             playwright specs — session lifecycle, stealth, CSS tools
    fixtures.js           MCP subprocess client fixture; openSession() injects headless:true

automation/
  park4night.spec.js             cookie banner acceptance (headed + headless)
  intoli-check.spec.js           bot.sannysoft.com stealth check (10 Intoli + 20 fp-collect)
  rebrowser-check.spec.js        bot-detector.rebrowser.net (7/10 passing)
  navigator-properties.spec.js   whatismybrowser.com navigator props + userAgentData eval
  fixtures.js                    CDP session sharing + storageState fallback
  teardown.js                    saves storageState after run
  scripts/
    inspect-page.mjs             generic table+iframe inspector (browser.run_file)

playwright.config.ts      single root config — projects: selftest + automation
```

## Tool ownership

**Szkrabok** (custom, `id`-based, CSS selectors):
`session.{open,close,list,delete,endpoint}` `nav.{goto,back,forward}` `interact.{click,type,select}` `extract.{text,html,screenshot,evaluate}` `workflow.{login,fillForm,scrape}` `browser.{run_test,run_file}`

**Playwright-MCP** (ref-based via snapshot):
`browser.{snapshot,click,type,navigate,navigate_back,close,drag,hover,evaluate,select_option,fill_form,press_key,take_screenshot,wait_for,resize,tabs,console_messages,network_requests,file_upload,handle_dialog,run_code,mouse_click_xy,mouse_move_xy,mouse_drag_xy,pdf_save,generate_locator,verify_element_visible,verify_text_visible,verify_list_visible,verify_value,start_tracing,stop_tracing,install}`

## Szkrabok-specific hacks (preserve on upstream updates)

- **TOML config** — two files: `szkrabok.config.toml` (committed, repo defaults) and `szkrabok.config.local.toml` (gitignored, machine-specific). Local is deep-merged on top of base at startup in both `src/config.js` and `playwright.config.ts`. Keys: `overrideUserAgent`, `userAgent`, `executablePath`, `viewport`, `locale`, `timezone`, `label`, `headless`. `executablePath` selects the Chromium binary; use `bash scripts/detect_browsers.sh` to find options. Headless priority: `HEADLESS` env var → `DISPLAY` presence → TOML `[default].headless`.
- **Stealth** `core/szkrabok_stealth.js` — playwright-extra + stealth plugin; `user-data-dir` evasion disabled (conflicts with persistent profile); `applyStealthToExistingPage` applies evasions (UA override, userAgentData brands JS injection, hardwareConcurrency, languages, WebGL) via CDP to the initial page which `launchPersistentContext` creates before `onPageCreated` fires; imported by both MCP session launch and standalone automation fixtures
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

`playwright.config.ts` calls `chromium.executablePath()` (the version `@playwright/test` expects).
If not on disk, parses path to extract cache prefix (e.g. `chromium-`) and relative exe path,
scans `~/.cache/ms-playwright/` for installed versions, uses highest. Works for all browser types.
