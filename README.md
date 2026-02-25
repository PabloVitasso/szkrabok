# Szkrabok

Fork of [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) extended with persistent sessions, stealth mode, and CDP test integration.

## What it adds over upstream

- Named persistent sessions — cookies, localStorage, Chromium profile survive restarts
- Stealth mode — playwright-extra + puppeteer-extra-plugin-stealth (active in both MCP and standalone Playwright runs)
- Anti-bot patches — suppress CDP `Runtime.enable` leak (detected by Cloudflare/DataDome) and rename internal `UtilityScript` class to defeat stack-trace fingerprinting; applied automatically via `postinstall`
- Deterministic CDP port per session — external Playwright scripts can `connectOverCDP()`
- `browser.run_test` — run `.spec.js` tests against a live MCP session via CDP
- `browser.run_file` — run a named export from an `.mjs` script against a live session
- MCP client library — generated typed handle (`mcp.nav.goto(...)`, `mcp.browser.run_test(...)`) for driving szkrabok from Playwright specs; JSONL call log copy-pasteable for LLM invocation; registry drift detection at connect time

## Install

**1. Run `install.sh`**

```bash
./install.sh --scope user        # user-wide  — available in all Claude Code projects
./install.sh --scope local       # project-local — this directory only
```

`install.sh` does the following:
- Runs `npm ci` if `node_modules` is missing
- Scans for Chrome/Chromium binaries and prints a ready-to-paste `szkrabok.config.local.toml` snippet (see Configuration below)
- Registers the MCP server with Claude Code via `claude mcp add`

**`--scope user` vs `--scope local`**

| | `user` | `local` |
|---|---|---|
| Stored in | `~/.claude.json` | `.claude/settings.local.json` in this repo |
| Available | All Claude Code sessions on this machine | Only when Claude Code is opened inside this repo |
| Use when | You want szkrabok always available | You want to isolate it to this project |

If both scopes are registered, `local` takes precedence. Use `--clean-all` to remove both before reinstalling.

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
browser.run_test { "sessionName": "p4n-test", "grep": "park4night" }
```

The test navigates to park4night.com, accepts the cookie banner, and returns structured JSON.
Steps are printed as the test runs:

```
step 1. navigate to https://park4night.com/en
step 2. probe for cookie banner (8s timeout)
step 3. banner appeared: true
step 4. button state — visible: true, enabled: true
step 5. clicking "Only essential cookies"
step 6. waiting for banner to disappear
step 7. banner gone: true
step 8. done
  ✓  1 [automation] › automation/park4night.spec.js › acceptCookies (2.0s)
```

Return value:

```json
{
  "passed": 1,
  "failed": 0,
  "tests": [
    {
      "title": "acceptCookies",
      "status": "passed",
      "result": { "action": "clicked", "dismissed": true }
    }
  ]
}
```

**The same test can be run directly with Playwright** — no MCP needed:

```bash
# With an active MCP session (connects to its live browser via CDP):
SZKRABOK_SESSION=p4n-test \
  npx playwright test --grep "park4night"

# Without an active session (Playwright launches its own browser):
SZKRABOK_SESSION=p4n-test \
  npx playwright test --grep "park4night"
# fixtures.js detects no CDP endpoint and falls back to a fresh browser automatically
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
session.open { "sessionName": "mobile-test", "launchOptions": { "preset": "mobile-iphone-15" } }
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
