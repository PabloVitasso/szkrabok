# Claude Code - Szkrabok

## Docs

- [README.md](./README.md) - what szkrabok is
- [docs/architecture.md](./docs/architecture.md) - layer map, file layout, tool ownership, hacks
- [docs/development.md](./docs/development.md) - fork relationship, adding tools, coding style, [upgrading playwright-core](./docs/development.md#upgrading-playwright-core)
- [docs/testing.md](./docs/testing.md) - run tests via MCP and CLI
- [docs/mcp-client-library.md](./docs/mcp-client-library.md) - MCP client library architecture
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) - upstream reference

## Key Locations

| What                  | Where                                                            |
| --------------------- | ---------------------------------------------------------------- |
| Runtime package       | `packages/runtime/` (`@szkrabok/runtime`)                        |
| Runtime public API    | `packages/runtime/index.js`                                      |
| Browser launch        | `packages/runtime/launch.js`                                     |
| Stealth               | `packages/runtime/stealth.js`                                    |
| MCP entry             | `src/index.js`                                                   |
| CLI entry             | `src/cli/index.js`                                               |
| CLI commands          | `src/cli/commands/`                                              |
| Tool registry         | `src/tools/registry.js`                                          |
| MCP config            | `src/config.js` (re-exports `initConfig`/`getConfig` from runtime) |
| Startup error log     | `~/.cache/szkrabok/startup.log`                                  |
| Publish smoke test    | `scripts/smoke-test.js` (runs as `prepublishOnly`)               |
| Playwright config     | `playwright.config.js`                                           |
| Config modules        | `config/` (env, paths, toml, preset, session, browser, projects) |
| MCP client library    | `packages/mcp-client/` — `mcpConnect()`, `spawnClient()`, codegen |
| Integration tests     | `tests/playwright/integration/`                                  |
| E2E tests             | `tests/playwright/e2e/`                                          |
| Node tests            | `tests/node/`                                                    |
| Session storage       | `sessions/{id}/`                                                 |

## Workflow Rules

- **Always ask before committing or pushing.** Never commit or push without explicit user approval
- **Test after every change.** Run the relevant test before considering work done. If a test cannot be run, say so explicitly and ask how to proceed

## Restart MCP Server

After editing source files: `/mcp` -> **restart** szkrabok

## Run Tests - Required Order

`browser.run_test` requires an active session with CDP port. Always:

1. `session_manage { "action": "open", "sessionName": "<name>" }` - launches Chrome with CDP port
2. `browser.run_test { "sessionName": "<name>", ... }` - connects via CDP

Calling `browser.run_test` without an open session fails with a clear error.
