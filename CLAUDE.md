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
