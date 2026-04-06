# Claude Code - Szkrabok

## Docs

- [README.md](./README.md) - what szkrabok is
- [docs/architecture.md](./docs/architecture.md) - layer map, file layout, tool ownership, invariants
- [docs/development.md](./docs/development.md) - MCP configs, adding tools, release workflow, coding style
- [docs/testing.md](./docs/testing.md) - all test paths (MCP, standalone CLI, e2e)
- [docs/mcp-client-library.md](./docs/mcp-client-library.md) - MCP client library architecture
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) - upstream reference

## Workflow Rules

- **Always ask before committing or pushing.** Never commit or push without explicit user approval
- **Test after every change.** Run the relevant test before considering work done. If a test cannot be run, say so explicitly and ask how to proceed
- **`git reset --hard` is FORBIDDEN.** Never run `git reset --hard` (or any destructive variant: `git checkout .`, `git restore .`, `git clean -f`). If you need to undo a commit, tell the user what you want to do and ask them to approve first. These commands silently destroy uncommitted work and cannot be undone.

## MCP Server

After editing source files: `/mcp` → **restart** szkrabok

Source changes only take effect when the MCP config points at `node src/index.js`. Add the project-local entry once:

```bash
claude mcp add szkrabok -s local -- node /absolute/path/to/szkrabok/src/index.js
```

Then restart after any source edit. If the config points at npx (published), changes require a publish.

Confirm which server is running: `session_manage { "action": "list" }` returns `server.source` — the entry point path. See [docs/development.md — MCP config](./docs/development.md#mcp-config-for-developing-szkrabok).

## Run Tests

See [docs/testing.md](./docs/testing.md) for all paths. Quick reference:

- **MCP** (`browser_run_test`): requires an open session — `session_manage open` first
- **Standalone CLI**: `PLAYWRIGHT_PROJECT=e2e npx playwright test --project=e2e` — no session needed
- **Node tests**: `npm run test:node`
