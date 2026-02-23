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
| Automation tests | `automation/` |
| Selftest (MCP server) | `selftest/` |
| Session storage | `sessions/{id}/` |

## Workflow rules

- **Always ask before committing or pushing.** Never commit or push without explicit user approval.
- **Test after every change.** Run the relevant test before considering work done. Do not assume a change is correct — verify it. If a test cannot be run, say so explicitly and ask how to proceed.

## Restart MCP server

After editing source files: `/mcp` -> **restart** szkrabok.

## Run tests — required order

`browser.run_test` requires an active session with CDP port. Always:

1. `session.open { "id": "<id>" }` — launches Chrome with CDP port
2. `browser.run_test { "id": "<id>", ... }` — connects via CDP

Calling `browser.run_test` without an open session fails with a clear error.
