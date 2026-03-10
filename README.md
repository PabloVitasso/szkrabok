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

| Use Case | Command |
| --- | --- |
| **Claude Code — global (all projects)** | `claude mcp add --scope user szkrabok -- npx -y @pablovitasso/szkrabok` |
| **Claude Code — this project only** | `claude mcp add szkrabok -- npx -y @pablovitasso/szkrabok` |
| **Claude Desktop** | See config snippet below |
| **Scaffold a new project** | `npx @pablovitasso/szkrabok init` |
| **Development (from source)** | `npm ci && claude mcp add szkrabok node /path/to/szkrabok/src/index.js` |

Claude Desktop — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "npx",
      "args": ["-y", "@pablovitasso/szkrabok"]
    }
  }
}
```

> **Browser not installed?** Run `npx @pablovitasso/szkrabok --setup` once in your terminal, then restart Claude.
> Set `CI=true` or `SZKRABOK_SKIP_BROWSER_INSTALL=1` to suppress the auto-install in CI / Docker.

**2. Configure**

Optionally create `szkrabok.config.local.toml` to set a custom browser binary or user agent:

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

* **`@pablovitasso/szkrabok/runtime`** (`packages/runtime/`): Browser bootstrap, stealth, session pool, MCP client (`mcpConnect`, `spawnClient`, codegen).
* **Config**: `szkrabok.config.toml` (defaults) deep-merged with `szkrabok.config.local.toml` (machine-specific, gitignored).
* **Release**: `npm run release:patch` bumps version, then `npm publish --access public`.

---

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/architecture.md](./docs/architecture.md) | Layer map, file layout, session lifecycle, invariants |
| [docs/development.md](./docs/development.md) | Adding tools, CLI design, release workflow |
| [docs/testing.md](./docs/testing.md) | Test categories, how to run, writing specs |
| [docs/mcp-client-library.md](./docs/mcp-client-library.md) | MCP client library and codegen |
| [docs/scaffold-init.md](./docs/scaffold-init.md) | scaffold.init presets and template structure |
