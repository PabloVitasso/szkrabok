# Architecture

## Overview

```
Claude Code (LLM)
     |
     | MCP protocol (stdio/HTTP)
     v
szkrabok.playwright.mcp.stealth/   ← Node.js MCP server
     |
     | Playwright API
     v
Persistent Browser Context (stealth + userDataDir)
     |
     v
sessions/{id}/                     ← file storage
  meta.json                        ← timestamps, config
  storageState.json                ← cookies + localStorage (optional)
  profile/                         ← Chromium native profile
```

## Components

### MCP Server (`src/`)

```
index.js          MCP entry point, stdio transport, tool dispatch
cli.js            bebok CLI — session list/inspect/delete/cleanup

tools/
  registry.js     All tool definitions: name, handler, schema
  session.js      session.open/close/list/delete/endpoint
  navigate.js     nav.goto/back/forward
  interact.js     interact.click/type/select
  extract.js      extract.text/html/screenshot/evaluate
  workflow.js     workflow.login/fillForm/scrape
  playwright_mcp.js  browser.* (snapshot, click, run_code, run_file, run_test, ...)

core/
  pool.js         In-memory session pool (id → {context, page})
  storage.js      Read/write sessions/ file storage
  stealth.js      playwright-extra + puppeteer-extra-plugin-stealth setup
  config.js       Env-based config, findChromiumPath()

utils/
  errors.js       wrapError, structured error responses
  logger.js       logError
```

### Playwright Test Environment (`playwright-tests/`)

```
playwright.config.ts   Config: storageState bridge, executablePath fallback
teardown.ts            globalTeardown: write/update sessions/{id}/meta.json
package.json           {"type":"commonjs"} — overrides root ESM for CJS loader
tests/
  example.spec.ts      Parametrized spec: TEST_* env vars, testInfo.attach('result')
```

## Session lifecycle

```
session.open(id)
  → load sessions/{id}/profile/ as userDataDir
  → if storageState.json exists: inject cookies/localStorage
  → store {context, page} in pool

test run (browser.run_test)
  → spawn npx playwright test with SZKRABOK_SESSION=id
  → playwright.config.ts loads storageState.json if present
  → tests run, attach JSON results via testInfo.attach('result')
  → globalTeardown updates meta.json

session.close(id)
  → save state → persist profile to disk → remove from pool
```

## Tool naming

All tools support three equivalent call formats:
- `session.open` / `session_open` / `sessionopen`

Aliases generated automatically in registry dispatch.

## browser.run_test params flow

```
MCP call: {id, params: {url: "https://..."}, grep: "title"}
  → TEST_URL=https://... env var
  → SZKRABOK_SESSION=id env var
  → npx playwright test --grep "title" --reporter json
  → parse JSON: stats + attachments decoded from base64
  → return {passed, failed, tests: [{title, status, result}]}
```

## Chromium resolution

`playwright.config.ts` calls `chromium.executablePath()` (the version `@playwright/test` expects).
If not on disk, parses path to extract cache prefix (e.g. `chromium-`) and relative exe path,
scans `~/.cache/ms-playwright/` for installed versions, uses highest. Works for all browser types.
