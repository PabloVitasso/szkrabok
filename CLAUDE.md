# Claude Code - Szkrabok

## Docs

- [README.md](./README.md) - what szkrabok is
- [docs/architecture.md](./docs/architecture.md) - layer map, file layout, tool ownership, hacks
- [docs/development.md](./docs/development.md) - fork relationship, merging upstream, adding tools
- [docs/testing.md](./docs/testing.md) - run tests via MCP and CLI
- [docs/mcp-client-library.md](./docs/mcp-client-library.md) - MCP client library architecture
- [docs/separation-progress.md](./docs/separation-progress.md) - what is done and what remains for consumer portability
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) - upstream reference

## Key Locations

| What                  | Where                                                            |
| --------------------- | ---------------------------------------------------------------- |
| Runtime package       | `packages/runtime/` (`@szkrabok/runtime`)                        |
| Runtime public API    | `packages/runtime/index.js`                                      |
| Browser launch        | `packages/runtime/launch.js`                                     |
| Stealth               | `packages/runtime/stealth.js`                                    |
| MCP entry             | `src/index.js`                                                   |
| Tool registry         | `src/tools/registry.js`                                          |
| MCP config            | `src/config.js` (TIMEOUT, LOG_LEVEL, DISABLE_WEBGL only)         |
| Playwright config     | `playwright.config.js`                                           |
| Config modules        | `config/` (env, paths, toml, preset, session, browser, projects) |
| MCP client library    | `mcp-client/` — `mcpConnect()`, `spawnClient()`, codegen         |
| Automation fixtures   | `automation/fixtures.js`                                         |
| Automation tests      | `automation/`                                                    |
| Selftest              | `selftest/`                                                      |
| Session storage       | `sessions/{id}/`                                                 |

## Workflow Rules

- **Always ask before committing or pushing.** Never commit or push without explicit user approval
- **Test after every change.** Run the relevant test before considering work done. If a test cannot be run, say so explicitly and ask how to proceed

## Coding Style

- **No repeated string literals for dispatch.** If a string (tool name, event type, key) controls branching in more than one place, put it in a registry/map keyed by that string. The string appears once as the key; behaviour is a value. Adding a new case = adding one entry, not touching multiple `if`/`switch` blocks
- **No ANSI codes in programmatic output.** Subprocess output piped into structured data must be clean text. Set `FORCE_COLOR=0` (or equivalent) when spawning CLI tools whose output is parsed or logged

## Architecture invariants — never violate

1. Only `@szkrabok/runtime` calls `launchPersistentContext`
2. Stealth runs only in runtime launch — never conditionally, never elsewhere
3. MCP tools never import stealth, config internals, or storage directly
4. `automation/fixtures.js` never imports stealth or launches a browser directly
5. `browser.run_test` subprocess connects via CDP — it never calls `runtime.launch()`

## Restart MCP Server

After editing source files: `/mcp` -> **restart** szkrabok

## Run Tests - Required Order

`browser.run_test` requires an active session with CDP port. Always:

1. `session.open { "sessionName": "<name>" }` - launches Chrome with CDP port
2. `browser.run_test { "sessionName": "<name>", ... }` - connects via CDP

Calling `browser.run_test` without an open session fails with a clear error.
