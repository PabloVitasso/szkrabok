# Szkrabok

Fork of [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) extended with persistent sessions, stealth mode, and CDP test integration.

## What it adds over upstream

- Named persistent sessions — cookies, localStorage, Chromium profile survive restarts
- Stealth mode — playwright-extra + puppeteer-extra-plugin-stealth (active in both MCP and standalone Playwright runs)
- Anti-bot patches — suppress CDP `Runtime.enable` leak (detected by Cloudflare/DataDome) and rename internal `UtilityScript` class to defeat stack-trace fingerprinting; applied automatically via `postinstall`
- Deterministic CDP port per session — external Playwright scripts can `connectOverCDP()`
- `browser.run_test` — run `.spec.js` tests against a live MCP session via CDP
- `browser.run_file` — run a named export from an `.mjs` script against a live session

## Install

```bash
./install.sh --scope user        # user-wide (Claude Code)
./install.sh --scope local       # project-local (Claude Code)
```

## Quick start

```
"Open session 'work' and go to example.com"
"Extract h1 text"
"Close session 'work'"
```

## Configuration

Two config files at repo root — only the first is committed:

| File | Committed | Purpose |
|---|---|---|
| `szkrabok.config.toml` | ✓ | Repo defaults — browser identity, presets, stealth |
| `szkrabok.config.local.toml` | ✗ gitignored | Machine-specific overrides (executablePath, UA, etc.) |

`szkrabok.config.local.toml` is deep-merged on top of the base — only keys you set there override the default. Everything else inherits. Create it on a new machine:

```bash
bash scripts/detect_browsers.sh    # find your Chrome/Chromium binary
```

```toml
# szkrabok.config.local.toml
[default]
executablePath    = "/home/you/.local/bin/ungoogled-chromium"
overrideUserAgent = true
userAgent         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/145.0.0.0 ..."
label             = "My local Chrome"
```

**Which binary to use:** the Playwright bundled binary (`Chrome for Testing`) works but
brands itself as automation tooling — detectable. `detect_browsers.sh` scans for Google
Chrome stable (best), ungoogled-chromium, Chromium, Brave, and Edge.

`overrideUserAgent = false` (repo default) lets the browser report its real binary UA,
keeping `navigator.userAgent` and `navigator.userAgentData` consistent.
Set `overrideUserAgent = true` with a `userAgent` string to spoof a specific identity.

Presets are named browser identities (viewport + locale + timezone + userAgent + label).
`[default]` is the TOML fallback. Pass a preset per-session:

```
session.open { "id": "mobile-test", "config": { "preset": "mobile-iphone-15" } }
```

For Playwright standalone runs, set `SZKRABOK_PRESET=mobile-iphone-15` before running tests.

## Documentation

| Doc                                                                        | Contents                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [docs/architecture.md](./docs/architecture.md)                             | Component map, tool ownership, szkrabok hacks, data flow                        |
| [docs/development.md](./docs/development.md)                               | Fork relationship, merging upstream, adding tools, branches                     |
| [docs/testing.md](./docs/testing.md)                                       | Run tests via MCP and CLI, writing specs, troubleshooting                       |
| [docs/rebrowser-patches-research.md](./docs/rebrowser-patches-research.md) | Anti-bot patch research: detection results, what each patch fixes, known limits |
| [docs/waitForSelector-bug.md](./docs/waitForSelector-bug.md)               | Investigation of utility-world name bug and fix (relevant for upstream merges)  |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)    | Upstream reference (config, tools, options)                                     |
| [CONTRIBUTING.md](./CONTRIBUTING.md)                                       | Contribution guidelines                                                         |
| [SECURITY.md](./SECURITY.md)                                               | Security policy                                                                 |
