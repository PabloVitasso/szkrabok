# Szkrabok

MCP server that supplements [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) with persistent sessions, stealth mode, and scripted automation.

Use alongside `@playwright/mcp` — szkrabok handles session lifecycle and scripting; playwright-mcp handles browser interaction (click, type, snapshot, etc.).

---

## What it adds

- **Named persistent sessions** — cookies, localStorage, Chromium profile survive restarts
- **Stealth mode** — playwright-extra + puppeteer-extra-plugin-stealth, applied exclusively in `@szkrabok/runtime`
- **Anti-bot patches** — suppress CDP `Runtime.enable` leak, rename `UtilityScript` class (applied via `postinstall`)
- **Deterministic CDP port per session** — external Playwright scripts can `connectOverCDP()`
- **`scaffold.init`** — bootstrap a new project with `playwright.config.js`, `package.json`, and config template
- **`browser.run_code`** — run a Playwright JS snippet against a live session (inline, quick actions)
- **`browser.run_test`** — run `.spec.js` tests against a live session via CDP (full test runner, JSON report)
- **`browser.run_file`** — call a named export from an `.mjs` script against a live session (reusable automation modules)
- **`@szkrabok/mcp-client`** — typed handle (`mcp.browser.run_test(...)`) for driving szkrabok from Playwright specs

---

## Tools

| Tool | Description |
|------|-------------|
| `session.open` | Launch or resume a named Chrome session |
| `session.close` | Save and close a session |
| `session.list` | List all sessions (active and stored) |
| `session.delete` | Delete a session permanently |
| `session.endpoint` | Get CDP/WS endpoints for external connections |
| `workflow.scrape` | Scrape structured text data by CSS selector |
| `browser.run_code` | Execute a Playwright JS snippet (inline, quick actions) |
| `browser.run_test` | Run `.spec.js` tests via CDP — needs scaffold first |
| `browser.run_file` | Call a named export from an `.mjs` script (reusable modules) |
| `scaffold.init` | Bootstrap a new project — call before `browser.run_test` |

---

## Packages

| Package | Location | Purpose |
|---------|----------|---------|
| `@szkrabok/runtime` | `packages/runtime/` | Browser bootstrap, stealth, session pool, storage |
| `@szkrabok/mcp-client` | `packages/mcp-client/` | Typed MCP client, `mcpConnect()`, codegen |

Both are packaged as npm tarballs via `npm run release:patch` → `dist/`.

---

## Install

**1. Install dependencies**

```bash
npm ci
```

**2. Register with Claude Code**

```bash
claude mcp add szkrabok node /path/to/szkrabok/src/index.js
```

Also add `@playwright/mcp` for browser interaction tools:

```bash
claude mcp add -s user playwright npx '@playwright/mcp@latest'
```

**3. Create `szkrabok.config.local.toml`**

```bash
bash scripts/detect_browsers.sh    # find your Chrome/Chromium binary
```

Then create at repo root (see `szkrabok.config.local.toml.example` for all options):

```toml
# szkrabok.config.local.toml
[default]
executablePath    = "/path/to/your/chrome"
overrideUserAgent = true
userAgent         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
log_level         = "debug"
```

---

## Quick usage (Claude Code)

Open a session, scrape, close:

```
session.open { "sessionName": "my-session", "url": "https://example.com" }
browser.run_code { "sessionName": "my-session", "code": "async (page) => page.title()" }
workflow.scrape { "sessionName": "my-session", "selectors": { "title": "h1" } }
session.close { "sessionName": "my-session" }
```

Bootstrap a new project, then run tests:

```
scaffold.init { "dir": "/path/to/project", "preset": "full" }
session.open { "sessionName": "my-session" }
browser.run_test { "sessionName": "my-session", "files": ["automation/example.spec.js"] }
```

---

## CLI (`bebok`)

A human/shell operator interface that calls the same handlers as the MCP tools.

```bash
bebok open <profile>                  # launch browser, print CDP endpoint, stay alive
bebok session list                    # list all sessions (active + stored)
bebok session inspect <id>            # dump cookies + localStorage counts
bebok session delete <id>             # delete a session
bebok session cleanup --days 30       # delete sessions unused for N days
bebok endpoint <sessionName>          # print CDP + WS endpoints for a running session
```

`bebok open` is the primary human-facing entry point — useful for opening a persistent browser without going through an LLM.

---

## Configuration

| File | Committed | Purpose |
|------|-----------|---------|
| `szkrabok.config.toml` | Yes | Repo defaults — browser identity, presets, stealth evasions |
| `szkrabok.config.local.toml` | No | Machine-specific overrides — executable path, UA, log level |

`local.toml` is deep-merged on top of the base. See `szkrabok.config.local.toml.example` for all sections.

Named presets (viewport + locale + timezone + UA):

```
session.open { "sessionName": "s", "launchOptions": { "preset": "mobile-iphone-15" } }
```

---

## Release

```bash
npm run release:patch    # bump patch version, git tag, pack to dist/
npm run release:minor    # bump minor version
```

Produces `dist/szkrabok-runtime-x.y.z.tgz` and `dist/szkrabok-mcp-client-x.y.z.tgz`.

---

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/architecture.md](./docs/architecture.md) | Layer map, file layout, tool ownership, session lifecycle, invariants |
| [docs/development.md](./docs/development.md) | Adding tools, CLI, release workflow |
| [docs/testing.md](./docs/testing.md) | All test categories, how to run, writing specs |
| [docs/mcp-client-library.md](./docs/mcp-client-library.md) | MCP client library architecture and codegen |
| [docs/scaffold-init.md](./docs/scaffold-init.md) | scaffold.init design and implementation notes |
