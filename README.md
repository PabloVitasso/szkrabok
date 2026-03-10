# Szkrabok

MCP server supplementing [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) with persistent sessions, stealth mode, and scripted automation.

**Core Enhancements:**

* **Named Sessions:** Persistent cookies, localStorage, and Chromium profiles.
* **Stealth:** Integrated `playwright-extra` + stealth plugin and anti-bot CDP patches.
* **Deterministic Ports:** Fixed CDP ports per session for `connectOverCDP()`.

---

## Tools & Capabilities

| Tool | Description |
| --- | --- |
| `session_manage` | Manage sessions: `open` (launch/resume), `close`, `list`, `delete`, `endpoint` (CDP/WS URLs). |
| `workflow.scrape` | Auto-scrape current page into LLM-ready text (headings, content, links, tables). Optional CSS selectors to target specific areas. |
| `browser_run` | Execute Playwright JS on session page: pass `code` (inline snippet) or `path` (named export from `.mjs` file). |
| `browser.run_test` | Run `.spec.js` tests via CDP (requires `scaffold.init`). |
| `scaffold.init` | Bootstrap project with `playwright.config.js` and templates. |

---

## Setup

**1. Install**

```bash
npm ci
claude mcp add szkrabok node /path/to/szkrabok/src/index.js
# Also add @playwright/mcp for standard browser interaction tools
claude mcp add -s user playwright npx '@playwright/mcp@latest'
```

**2. Configure**

Run `bash scripts/detect_browsers.sh` to find your binary, then create `szkrabok.config.local.toml`:

```toml
[default]
executablePath = "/path/to/your/chrome"
overrideUserAgent = true
userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
log_level = "debug"
```

---

## Usage

### Claude Code (LLM)

```
session_manage { "action": "open", "sessionName": "my-session", "url": "https://example.com" }
workflow.scrape { "sessionName": "my-session" }
session_manage { "action": "close", "sessionName": "my-session" }
```

Bootstrap a new project, then run tests:

```
scaffold.init { "dir": "/path/to/project", "preset": "full" }
session_manage { "action": "open", "sessionName": "my-session" }
browser.run_test { "sessionName": "my-session", "files": ["automation/example.spec.js"] }
```

### Bebok (CLI)

`bebok` is the human/shell interface — calls the same handlers as MCP tools:

```bash
bebok open <profile>              # Launch browser, print CDP endpoint, stay alive
bebok session list                # Show all sessions (active + stored)
bebok session inspect <id>        # Dump cookie/localStorage counts
bebok session delete <id>         # Delete a session
bebok session cleanup --days 30   # Delete sessions unused for N days
bebok endpoint <sessionName>      # Print CDP + WS endpoints
```

---

## Project Structure

* **`@szkrabok/runtime`** (`packages/runtime/`): Browser bootstrap, stealth, session pool, MCP client (`mcpConnect`, `spawnClient`, codegen).
* **Config**: `szkrabok.config.toml` (defaults) deep-merged with `szkrabok.config.local.toml` (machine-specific, gitignored).
* **Release**: `npm run release:patch` bumps version and packs to `dist/szkrabok-runtime-x.y.z.tgz`.

---

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/architecture.md](./docs/architecture.md) | Layer map, file layout, session lifecycle, invariants |
| [docs/development.md](./docs/development.md) | Adding tools, CLI design, release workflow |
| [docs/testing.md](./docs/testing.md) | Test categories, how to run, writing specs |
| [docs/mcp-client-library.md](./docs/mcp-client-library.md) | MCP client library and codegen |
| [docs/scaffold-init.md](./docs/scaffold-init.md) | scaffold.init presets and template structure |
