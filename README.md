# Szkrabok

Fork of [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) — adds persistent sessions, stealth mode, anti-bot patches, and a typed MCP client library.

Layered monorepo: `@szkrabok/runtime` owns all browser lifecycle; the MCP server is transport only.

---

## What it adds over upstream

- **Named persistent sessions** — cookies, localStorage, Chromium profile survive restarts
- **Stealth mode** — playwright-extra + puppeteer-extra-plugin-stealth, applied exclusively in `@szkrabok/runtime`
- **Anti-bot patches** — suppress CDP `Runtime.enable` leak, rename `UtilityScript` class; applied via `postinstall`
- **Deterministic CDP port per session** — external Playwright scripts can `connectOverCDP()`
- **`browser.run_test`** — run `.spec.js` tests against a live MCP session via CDP
- **`browser.run_file`** — run a named export from an `.mjs` script against a live session
- **`@szkrabok/mcp-client`** — generated typed handle (`mcp.nav.goto(...)`, `mcp.browser.run_test(...)`) for driving szkrabok from Playwright specs

---

## Packages

| Package | Location | Purpose |
|---------|----------|---------|
| `@szkrabok/runtime` | `packages/runtime/` | Browser bootstrap, stealth, session pool, storage |
| `@szkrabok/mcp-client` | `packages/mcp-client/` | Typed MCP client, `mcpConnect()`, codegen |

Both are packaged as npm tarballs via `npm run release:patch` → `dist/`.

---

## Install (MCP server for Claude Code)

**1. Run `install.sh`**

```bash
./install.sh --scope user        # user-wide — available in all Claude Code projects
./install.sh --scope local       # project-local — this directory only
```

Runs `npm ci`, scans for Chrome/Chromium, registers with Claude Code via `claude mcp add`.

**2. Create `szkrabok.config.local.toml`**

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

```
session.open { "sessionName": "my-session" }
nav.goto { "sessionName": "my-session", "url": "https://example.com" }
extract.text { "sessionName": "my-session" }
session.close { "sessionName": "my-session" }
```

Run a Playwright spec against a live session:

```
browser.run_test { "sessionName": "my-session", "files": ["automation/my.spec.js"] }
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
| [docs/development.md](./docs/development.md) | Fork relationship, merging upstream, adding tools, release workflow |
| [docs/testing.md](./docs/testing.md) | All test categories, how to run, writing specs, troubleshooting |
| [docs/mcp-client-library.md](./docs/mcp-client-library.md) | MCP client library architecture and codegen |
| [docs/separation-progress.md](./docs/separation-progress.md) | Consumer portability — all phases complete |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | Upstream reference |
