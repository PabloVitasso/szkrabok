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

`szkrabok.config.toml` at repo root controls browser identity and presets:

```toml
[default]
label     = "Desktop / Windows 10 / Chrome 120"
userAgent = "Mozilla/5.0 ..."
locale    = "en-US"
timezone  = "America/New_York"
headless  = false
viewport  = { width = 1280, height = 800 }

[stealth]
enabled = true

[preset.mobile-iphone-15]
label     = "Mobile / iPhone 15 / Safari 17"
userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 ...)"
viewport  = { width = 393, height = 852 }
```

Presets are named browser identities (userAgent + viewport + locale + timezone + label).
`[default]` applies when no preset is specified. Named presets override individual fields.

Pass a preset in `session.open`:

```
session.open { "id": "mobile-test", "config": { "preset": "mobile-iphone-15" } }
```

The resolved preset name and label are returned in `session.open` and `session.list` responses.

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
