# Claude Code — Szkrabok

## Docs
- [README.md](./README.md) — what szkrabok is
- [docs/architecture.md](./docs/architecture.md) — file layout, tool ownership, szkrabok hacks
- [docs/development.md](./docs/development.md) — fork relationship, merging upstream, adding tools
- [docs/testing.md](./docs/testing.md) — run tests via MCP and CLI
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) — upstream reference

## Key locations

| What | Where |
|---|---|
| MCP entry | `src/index.js` |
| Tool registry | `src/tools/registry.js` |
| Session pool | `src/core/pool.js` |
| Playwright tests | `playwright-tests/` |
| Session storage | `sessions/{id}/` |

## Restart MCP server

After editing source files: `/mcp` -> **restart** szkrabok. No `pkill` needed.

## Run tests — required order

`browser.run_test` requires an active session with CDP port. Always:

1. `session.open { "id": "<id>" }` — launches Chrome with CDP port
2. `browser.run_test { "id": "<id>", ... }` — connects via CDP

Calling `browser.run_test` without an open session fails with a clear error.
