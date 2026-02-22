# Claude Code — Szkrabok

## Start here
- **[README.md](./README.md)** — source of truth: install, tools, usage, troubleshooting
- **[docs/architecture.md](./docs/architecture.md)** — component map, data flow, file layout
- **[docs/testing.md](./docs/testing.md)** — install, run tests standalone + via MCP

## Key locations

| What | Where |
|---|---|
| MCP server entry | `szkrabok.playwright.mcp.stealth/src/index.js` |
| All MCP tools | `szkrabok.playwright.mcp.stealth/src/tools/` |
| Tool registry | `szkrabok.playwright.mcp.stealth/src/tools/registry.js` |
| Session pool | `szkrabok.playwright.mcp.stealth/src/core/pool.js` |
| Playwright test env | `playwright-tests/` |
| Session storage | `szkrabok.playwright.mcp.stealth/sessions/{id}/` |

## Restarting the MCP server

After editing MCP server source files, in Claude Code run `/mcp` and select **restart** for szkrabok. No `pkill` needed.

## Running tests — required order of operations

`browser.run_test` requires an active session with CDP enabled. Always follow this order:

1. `session.open { "id": "<id>" }` — must be called first; launches Chrome with CDP port
2. *(do any MCP browsing/setup here)*
3. `browser.run_test { "id": "<id>", ... }` — connects to the same Chrome via CDP

If `browser.run_test` is called before `session.open`, it will fail with a clear message showing the exact `session.open` call needed.

## Tool ownership

**Szkrabok** (custom, `id`-based, CSS selectors): session.{open,close,list,delete,endpoint} nav.{goto,back,forward} interact.{click,type,select} extract.{text,html,screenshot,evaluate} workflow.{login,fillForm,scrape} browser.{run_test,run_file}

**Playwright-MCP** (ref-based via snapshot): browser.{snapshot,click,type,navigate,navigate_back,close,drag,hover,evaluate,select_option,fill_form,press_key,take_screenshot,wait_for,resize,tabs,console_messages,network_requests,file_upload,handle_dialog,run_code,mouse_click_xy,mouse_move_xy,mouse_drag_xy,pdf_save,generate_locator,verify_element_visible,verify_text_visible,verify_list_visible,verify_value,start_tracing,stop_tracing,install}

## Szkrabok-specific hacks (keep on upstream updates)

- **Stealth** `core/stealth.js`: playwright-extra + stealth plugin; `user-data-dir` evasion disabled (conflicts with persistent profile)
- **CDP port** `tools/session.js`: deterministic port from session ID (`20000 + abs(hash) % 10000`); enables `chromium.connectOverCDP()`
- **Persistent profile** `core/storage.js`: sessions stored in `sessions/{id}/profile/`; no manual storageState saves
- **Test integration** `tools/playwright_mcp.js`: `browser.run_test` spawns `npx playwright test` with `SZKRABOK_SESSION={id}`; `browser.run_file` runs a named export from an `.mjs` script; both connect to the live browser via CDP — **`session.open` must be called first** or they fail with a clear error

## Adding a tool
1. Export async function from a file in `src/tools/`
2. Register in `registry.js` with name, handler, description, inputSchema
3. Tool is auto-exposed via MCP — no other wiring needed

## Playwright test integration
Tests in `playwright-tests/tests/` are standard `.spec.ts` files.
- Run standalone: `SZKRABOK_SESSION=<id> npx playwright test --config playwright-tests/playwright.config.ts`
- Run via MCP: `browser.run_test {id, grep?, params?}`
- Pass params: `params: {url: "https://...", title: "..."}` → `TEST_URL`, `TEST_TITLE` env vars
- Return data: `testInfo.attach('result', { body: JSON.stringify(data), contentType: 'application/json' })`
- See [docs/testing.md](./docs/testing.md) for full procedure
