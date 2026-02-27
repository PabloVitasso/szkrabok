# Claude Code - Szkrabok

## Docs

- [README.md](./README.md) - what szkrabok is
- [docs/architecture.md](./docs/architecture.md) - file layout, tool ownership, szkrabok hacks
- [docs/development.md](./docs/development.md) - fork relationship, merging upstream, adding tools
- [docs/testing.md](./docs/testing.md) - run tests via MCP and CLI
- [docs/mcp-client-library.md](./docs/mcp-client-library.md) - MCP client library architecture
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) - upstream reference

## Key Locations

| What                | Where                                                            |
| ------------------- | ---------------------------------------------------------------- |
| MCP entry           | `src/index.js`                                                   |
| Tool registry       | `src/tools/registry.js`                                          |
| Session pool        | `src/core/pool.js`                                               |
| Playwright config   | `playwright.config.js`                                           |
| Config modules      | `config/` (env, paths, toml, preset, session, browser, projects) |
| Project definitions | `config/projects.ts` (selftest, mcp, automation)                 |
| MCP client library  | `mcp-client/` - `mcpConnect()`, `spawnClient()`, codegen         |
| Selftest            | `selftest/`                                                      |
| Automation tests    | `automation/`                                                    |
| Session storage     | `sessions/{id}/`                                                 |

## Workflow Rules

- **Always ask before committing or pushing.** Never commit or push without explicit user approval
- **Test after every change.** Run the relevant test before considering work done. Do not assume a change is correct - verify it. If a test cannot be run, say so explicitly and ask how to proceed

## Coding Style

- **No repeated string literals for dispatch.** If a string (tool name, event type, key) controls branching in more than one place, put it in a registry/map keyed by that string. The string appears once as the key; behaviour is a value. Adding a new case = adding one entry, not touching multiple `if`/`switch` blocks
- **No ANSI codes in programmatic output.** Subprocess output piped into structured data must be clean text. Set `FORCE_COLOR=0` (or equivalent) when spawning CLI tools whose output is parsed or logged

## Restart MCP Server

After editing source files: `/mcp` -> **restart** szkrabok

## Run Tests - Required Order

`browser.run_test` requires an active session with CDP port. Always:

1. `session.open { "sessionName": "<name>" }` - launches Chrome with CDP port
2. `browser.run_test { "sessionName": "<name>", ... }` - connects via CDP

Calling `browser.run_test` without an open session fails with a clear error
