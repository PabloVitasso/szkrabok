# Session Progress

## Goal
Allow szkrabok MCP to run standard unmodified Playwright `.spec.ts` tests and return JSON results.
Also enable szkrabok browser sessions to share state (cookies/localStorage) with standalone playwright test runs.

## Done

### New MCP Tools
- **`session.endpoint`** (`session.js`) - returns `wsEndpoint` for external playwright `connect()`
- **`browser.run_file`** (`playwright_mcp.js`) - dynamically imports ESM script, calls named export `fn(page, args)`, returns JSON
- **`browser.run_test`** (`playwright_mcp.js`) - spawns `npx playwright test`, passes `SZKRABOK_SESSION=id`, returns JSON summary `{passed,failed,skipped,tests[],exitCode}`

All three registered in `registry.js`.

### Playwright Test Directory
`playwright-tests/` at repo root:
- `playwright.config.ts` - loads `storageState` from szkrabok session dir if present; sets `executablePath` to `~/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`; `globalTeardown: './teardown'`
- `teardown.ts` - after test run, writes/updates `sessions/{SZKRABOK_SESSION}/meta.json`
- `package.json` - `{"type":"commonjs"}` (overrides root ESM so playwright CJS loader works)
- `tests/example.spec.ts` - standard unmodified playwright spec (2 tests, both pass)

### Session State Bridge
- Tests write cookies via `storageState` fixture → file at `sessions/{id}/storageState.json`
- szkrabok `session.open()` loads that file as `storageState` if present
- Works bidirectionally: login in szkrabok → export state → tests run pre-authenticated

## How to Use

**Standalone:**
```bash
SZKRABOK_SESSION=my-session npx playwright test --config playwright-tests/playwright.config.ts
```

**Via MCP:**
```json
{"tool": "browser.run_test", "args": {"id": "my-session"}}
{"tool": "browser.run_test", "args": {"id": "my-session", "grep": "has title"}}
```

## Key Fixes Applied
- `"type":"commonjs"` in `playwright-tests/package.json` - fixes ESM/CJS conflict with root `package.json`
- `executablePath` in playwright config - root `@playwright/test` v1.59 expects `chromium_headless_shell-1210` (not installed); pointing to chromium-1200 fixes it
- `storageState` approach instead of `--user-data-dir` - playwright v1.59 rejects `--user-data-dir` as raw launch arg

## File Map
```
playwright-tests/
  playwright.config.ts    # test env config
  teardown.ts             # session meta update
  package.json            # {"type":"commonjs"}
  tests/
    example.spec.ts       # standard spec

szkrabok.playwright.mcp.stealth/src/tools/
  playwright_mcp.js       # run_file, run_test, run_code + all browser tools
  session.js              # endpoint export added
  registry.js             # all three new tools registered

docs/playwright-test-as-login.md  # concept doc
```
