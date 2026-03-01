# Szkrabok

Fork of [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) extended with persistent sessions, stealth mode, and CDP test integration.

Layered monorepo: `@szkrabok/runtime` owns all browser lifecycle; the MCP server is transport only.

## What it adds over upstream

- Named persistent sessions — cookies, localStorage, Chromium profile survive restarts
- Stealth mode — playwright-extra + puppeteer-extra-plugin-stealth, applied exclusively by runtime
- Anti-bot patches — suppress CDP `Runtime.enable` leak and rename `UtilityScript` class; applied automatically via `postinstall`
- Deterministic CDP port per session — external Playwright scripts can `connectOverCDP()`
- `browser.run_test` — run `.spec.js` tests against a live MCP session via CDP
- `browser.run_file` — run a named export from an `.mjs` script against a live session
- MCP client library — generated typed handle (`mcp.nav.goto(...)`, `mcp.browser.run_test(...)`) for driving szkrabok from Playwright specs

## Install

**1. Run `install.sh`**

```bash
./install.sh --scope user        # user-wide — available in all Claude Code projects
./install.sh --scope local       # project-local — this directory only
```

`install.sh` runs `npm ci`, scans for Chrome/Chromium binaries, and registers the MCP server with Claude Code via `claude mcp add`.

**`--scope user` vs `--scope local`**

|           | `user`                                   | `local`                                          |
| --------- | ---------------------------------------- | ------------------------------------------------ |
| Stored in | `~/.claude.json`                         | `.claude/settings.local.json` in this repo       |
| Available | All Claude Code sessions on this machine | Only when Claude Code is opened inside this repo |
| Use when  | You want szkrabok always available       | You want to isolate it to this project           |

**2. Create `szkrabok.config.local.toml`** (first machine setup)

```bash
bash scripts/detect_browsers.sh    # find your Chrome/Chromium binary
```

Copy the printed output into a new file at the repo root:

```toml
# szkrabok.config.local.toml
[default]
executablePath    = "/path/to/your/chrome"
overrideUserAgent = true
userAgent         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/145.0.0.0 ..."
log_level         = "debug"        # optional — logs to /tmp/YYYYMMDDHHMMszkrabok-mcp.log
```

## Quick usage

```
session.open { "sessionName": "p4n-test" }
browser.run_test { "sessionName": "p4n-test", "files": ["automation/park4night/park4night.spec.js"] }
```

The test navigates to park4night.com, handles the cookie banner, and returns structured JSON.

```json
{
  "passed": 2,
  "failed": 0,
  "tests": [
    { "title": "accept cookies and login", "status": "passed", "result": { "cookieResult": { "action": "skipped" }, "isLogged": true } },
    { "title": "search by gps", "status": "passed", "result": { "isLogged": true, "results": [{ "label": "Poland East", "dumpPath": "/tmp/..." }] } }
  ]
}
```

**The same test can be run directly with Playwright** — no MCP needed:

```bash
# With an active MCP session (connects to its live browser via CDP):
SZKRABOK_CDP_ENDPOINT=http://localhost:PORT npx playwright test automation/park4night/park4night.spec.js

# Without an active session (runtime.launch() starts its own stealth browser):
npx playwright test automation/park4night/park4night.spec.js
```

## Configuration

Two config files at repo root — only the first is committed:

| File                         | Committed | Purpose                                            |
| ---------------------------- | --------- | -------------------------------------------------- |
| `szkrabok.config.toml`       | ✓         | Repo defaults — browser identity, presets, stealth |
| `szkrabok.config.local.toml` | ✗         | Machine-specific overrides (executablePath, UA)    |

`szkrabok.config.local.toml` is deep-merged on top of the base. Create it on a new machine:

```bash
bash scripts/detect_browsers.sh
```

```toml
# szkrabok.config.local.toml
[default]
executablePath    = "/home/you/.local/bin/ungoogled-chromium"
overrideUserAgent = true
userAgent         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/145.0.0.0 ..."
label             = "My local Chrome"
```

Presets are named browser identities (viewport + locale + timezone + userAgent):

```
session.open { "sessionName": "mobile-test", "launchOptions": { "preset": "mobile-iphone-15" } }
```

## Documentation

| Doc                                                                        | Contents                                                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [docs/architecture.md](./docs/architecture.md)                             | Layer map, file layout, tool ownership, session lifecycle, hacks       |
| [docs/development.md](./docs/development.md)                               | Fork relationship, merging upstream, adding tools, branches            |
| [docs/testing.md](./docs/testing.md)                                       | Run tests via MCP and CLI, writing specs, troubleshooting              |
| [docs/mcp-client-library.md](./docs/mcp-client-library.md)                 | MCP client library architecture                                        |
| [docs/separation-progress.md](./docs/separation-progress.md)               | Consumer portability: what is done, what remains (phases 8-10)         |
| [docs/rebrowser-patches-research.md](./docs/rebrowser-patches-research.md) | Anti-bot patch research: detection results, what each patch fixes      |
| [docs/waitForSelector-bug.md](./docs/waitForSelector-bug.md)               | Utility-world name bug investigation (relevant for upstream merges)    |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)    | Upstream reference                                                     |
