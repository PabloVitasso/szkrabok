# Szkrabok

Fork of [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) extended with persistent sessions, stealth mode, and CDP test integration.

## What it adds over upstream

- Named persistent sessions — cookies, localStorage, Chromium profile survive restarts
- Stealth mode — playwright-extra + puppeteer-extra-plugin-stealth
- Deterministic CDP port per session — external Playwright scripts can `connectOverCDP()`
- `browser.run_test` — run `.spec.ts` tests against a live MCP session via CDP
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

## Documentation

| Doc | Contents |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | Component map, tool ownership, szkrabok hacks, data flow |
| [docs/development.md](./docs/development.md) | Fork relationship, merging upstream, adding tools, branches |
| [docs/testing.md](./docs/testing.md) | Run tests via MCP and CLI, writing specs, troubleshooting |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | Upstream reference (config, tools, options) |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution guidelines |
| [SECURITY.md](./SECURITY.md) | Security policy |
