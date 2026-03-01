# Szkrabok

MCP server that supplements [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) with persistent sessions, stealth mode, and scripted automation.

Use it alongside `@playwright/mcp` — szkrabok handles session management and scripting; playwright-mcp handles browser interaction.

---

## What it adds

- **Named persistent sessions** — cookies, localStorage, Chromium profile survive restarts
- **Stealth mode** — playwright-extra + puppeteer-extra-plugin-stealth, applied exclusively in `@szkrabok/runtime`
- **Anti-bot patches** — suppress CDP `Runtime.enable` leak, rename `UtilityScript` class; applied via `postinstall`
- **Deterministic CDP port per session** — external Playwright scripts can `connectOverCDP()`
- **`browser.run_code`** — run a Playwright function string against a live session
- **`browser.run_test`** — run `.spec.js` tests against a live MCP session via CDP
- **`browser.run_file`** — run a named export from an `.mjs` script against a live session
- **`workflow.login/fillForm/scrape`** — high-level automation helpers
- **`@szkrabok/mcp-client`** — typed handle (`mcp.workflow.scrape(...)`, `mcp.browser.run_test(...)`) for driving szkrabok from Playwright specs

---

## Tools

| Tool | Description |
|------|-------------|
| `session.open` | Launch a named Chrome session |
| `session.close` | Save and close a session |
| `session.list` | List active sessions |
| `session.delete` | Delete a session permanently |
| `session.endpoint` | Get CDP/WS endpoint for external connections |
| `workflow.login` | Automated login |
| `workflow.fillForm` | Fill a form |
| `workflow.scrape` | Scrape structured data |
| `browser.run_code` | Execute a Playwright script string |
| `browser.run_test` | Run Playwright `.spec.js` tests via CDP |
| `browser.run_file` | Run a named export from an `.mjs` script |

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

Open a session, run code, scrape, close:

```
session.open { "sessionName": "my-session", "url": "https://example.com" }
browser.run_code { "sessionName": "my-session", "code": "async (page) => page.title()" }
workflow.scrape { "sessionName": "my-session", "selectors": { "title": "h1" } }
session.close { "sessionName": "my-session" }
```

Run a Playwright spec against a live session:

```
browser.run_test { "sessionName": "my-session", "files": ["tests/playwright/e2e/my.spec.js"] }
```

---

## Configuration

| File | Committed | Purpose |
|------|-----------|---------|
| `szkrabok.config.toml` | ✓ | Repo defaults — browser identity, presets, stealth evasions |
| `szkrabok.config.local.toml` | ✗ | Machine-specific overrides — executable path, UA, log level |

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
| [docs/development.md](./docs/development.md) | Adding tools, release workflow |
| [docs/testing.md](./docs/testing.md) | All test categories, how to run, writing specs, troubleshooting |
| [docs/mcp-client-library.md](./docs/mcp-client-library.md) | MCP client library architecture and codegen |
