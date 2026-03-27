# Szkrabok

MCP server supplementing [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) with persistent sessions, stealth mode, and scripted automation.

**Core Enhancements:**

* **Named Sessions:** Persistent cookies, localStorage, and Chromium profiles.
* **Profile Cloning:** Ephemeral session clones — template profile is deep-cloned to `$TMPDIR`, browser runs against the clone, clone is destroyed on close. Zero contamination of the template.
* **Stealth:** Integrated `playwright-extra` + stealth plugin and anti-bot CDP patches.
* **Deterministic Ports:** Fixed CDP ports per session for `connectOverCDP()`.

---

## Tools & Capabilities

### 1. session_manage

Manage browser sessions. Actions: open (launch/resume), close (save/delete), list (all), delete (templates; globs support), endpoint (CDP/WS). `open` + `isClone:true` returns a clone ID; use this ID for subsequent calls.

- **action** (required): `open` | `close` | `list` | `delete` | `endpoint`
- **sessionName**: Session name or glob (delete only). For clones, use the ID returned by `open` (`isClone:true`), not the template name. Required for open/close/delete/endpoint, not for list
- **url**: URL to navigate after opening (open only)
- **launchOptions** (open only):
  - **preset**: Preset name. Mutually exclusive with userAgent/viewport/locale/timezone. See [Presets](#presets)
  - **stealth**: Enable stealth mode, default `true`
  - **disableWebGL**: Disable WebGL, default `false`
  - **headless**: Run headless
  - **userAgent**: Custom UA string
  - **viewport**: `{ width, height }`
  - **locale**: BCP 47 locale
  - **timezone**: IANA timezone
  - **isClone**: Create an ephemeral clone of the template session. The returned `sessionName` is a generated id. Clone dir is deleted on close; no state is saved. Template must be closed before cloning.

  Examples:
  - With preset: `{ preset: "desktop-chrome-win", headless: false, stealth: true }`
  - With explicit fields: `{ userAgent: "...", viewport: { width: 1280, height: 800 }, locale: "en-US", timezone: "America/New_York", headless: false }`
  - **Note:** `preset` is mutually exclusive with `userAgent`, `viewport`, `locale`, `timezone`. `headless` and `stealth` are always allowed alongside either.

Returns: `{ success, sessionName, url, reused, preset, label, isClone, templateSession, cdpEndpoint }`

When `isClone: true` is set in `launchOptions`, the returned `sessionName` is a generated id (e.g. `myprofile-1748234205-a3f2c1b0`). Use that id for all subsequent calls. On close, the clone dir is deleted and no state is saved.

### 2. session_run_test

Composite single-command primitive: open/clone session → navigate → run tests → apply post-policy. Deterministic invariants: per-name lock prevents concurrent page mutation, navigation barrier waits for `networkidle`, workers forced to 1.

- **session** (required):
  - **name** (required): logical session name
  - **mode**: `clone` (default, ephemeral) | `template` (persistent)
  - **templateConflict**: `fail` (default) | `close-first` | `clone-from-live` — what to do when template is open in clone mode
  - **enforceLaunchOptionsMatch**: hard-fail if open session has different launchOptions config hash, default `false`
  - **launchOptions**: same options as `session_manage open`
  - **navigation**: `{ policy: "always"|"ifBlank"|"never", url, timeout }` — navigates before test; `url` required when policy is not `"never"`
- **test** (required): same as `browser_run_test` — `spec`, `grep`, `params`, `config`, `project`, `reportFile`
- **postPolicy**: `{ action: "destroy"|"save"|"keep", recreateCloneOnKeep: false }` — default `destroy` for clone, `save` for template

Returns: `{ session: { logicalName, runtimeName, mode }, test: { passed, failed, ... } }` or `{ error, phase: "session"|"test"|"postPolicy" }` on failure.

### 3. browser_scrape

Scrape current page into LLM-ready text.

- **sessionName** (required)
- **selectors**: CSS selectors to target. Omit for auto (main or body)

Returns: `{ raw: [{ tag, text }], llmFriendly, tokenCountEstimate }`

### 4. browser_run

Execute Playwright JS on session page.

- **sessionName** (required)
- **code**: Inline async function as string. Mutually exclusive with `path`
- **path**: Path to `.mjs` file. Mutually exclusive with `code`
- **fn**: Named export from path, default `"default"`
- **args**: Object passed as second param to function

Returns: `{ result, url }`

### 5. browser_run_test

Run `.spec.js` tests via CDP. Requires `scaffold_init` and open session.

- **sessionName** (required)
- **files**: File/directory paths for playwright test
- **grep**: Filter tests by name (regex)
- **params**: Key/value → uppercased env vars (e.g. `{url:"..."}` → `process.env.URL`)
- **config**: Config path, default `playwright.config.js`
- **project**: Playwright project name
- **keepOpen**: Reconnect session after test if MCP context invalidated, default `false`
- **reportFile**: Repo-relative JSON report path. Default: `sessions/<sessionName>/last-run.json`. Returns resolved path

Returns: `{ passed, failed, skipped, tests: [{ title, status, error, result }], log, reportFile }`

Run from VSCode with Playwright extension — no MCP required:

```js
// tests/playwright/e2e/rebrowser.spec.js
import { test, expect } from './fixtures.js';

test('rebrowser-check', async ({ page }) => {
  await page.goto('https://bot-detector.rebrowser.net/');
  // ... test logic
});
```

Full example: [tests/playwright/e2e/rebrowser.spec.js](./tests/playwright/e2e/rebrowser.spec.js)

### 6. scaffold_init

Init szkrabok project (idempotent). Prerequisite for browser runs.

- **dir**: Target directory, default cwd
- **name**: Package name, default dirname
- **preset**: `minimal` (default, MCP-only — config + devDeps, no local szkrabok install) or `full` (+ automation fixtures + example specs, for standalone Playwright runs)
- **install**: Run npm install after, default `false`

Returns: `{ created, skipped, staged, merged, installed, warnings }` — `staged` lists files whose content differed from the template; the updated template is written as `filename.new` alongside the original.

### Presets

`default`, `chromium-honest`, `desktop-chrome-win`, `desktop-chrome-mac`, `desktop-firefox-win`, `desktop-safari-mac`, `mobile-iphone-15`, `mobile-android-chrome`, `tablet-ipad-pro`

### IDE Integration

Run Playwright tests directly from VSCode while using MCP-managed sessions:

```js
// tests/playwright/e2e/rebrowser-mcp.spec.js
import { test, expect } from 'playwright/test';
import { mcpConnect } from '@szkrabok/runtime';

const SESSION = 'rebrowser-mcp-harness';

test('rebrowser-check via MCP', async () => {
  const mcp = await mcpConnect(SESSION, { launchOptions: { headless: true } });
  try {
    const result = await mcp.browser_run_test({ files: ['tests/playwright/e2e/rebrowser.spec.js'] });
    expect(result.passed).toBe(8);
  } finally {
    await mcp.close();
  }
});
```

Full example: [tests/playwright/e2e/rebrowser-mcp.spec.js](./tests/playwright/e2e/rebrowser-mcp.spec.js)

---

## Setup

**Install**

Global (all projects):
```bash
claude mcp add --scope user szkrabok -- npx -y @pablovitasso/szkrabok
gemini mcp add --scope user szkrabok npx -y @pablovitasso/szkrabok
kilo mcp add szkrabok npx -y @pablovitasso/szkrabok
```
(Cursor: use UI → Features → MCP)

This project only:
```bash
claude mcp add szkrabok -- npx -y @pablovitasso/szkrabok
```

Shared config (Claude Desktop / Gemini / Kilo / Cursor) — add to config file:
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
Locations: Claude Desktop → `claude_desktop_config.json`, Gemini → `~/.gemini/settings.json`, Kilo → `mcp_settings.json`, Cursor → UI

OpenCode:
```json
{ "mcp": { "szkrabok": { "type": "local", "command": ["npx", "-y", "@pablovitasso/szkrabok"], "enabled": true } } }
```

Codex (TOML):
```toml
[mcp_servers.szkrabok]
command = "npx"
args = ["-y", "@pablovitasso/szkrabok"]
```

New project:
```bash
npx @pablovitasso/szkrabok init
```

> **Browser not found?** Run `szkrabok detect-browser` to find installed browsers, or `szkrabok install-browser` to install Playwright's Chromium. Requires **Node.js ≥ 20**.

**Configure**

Optionally create `szkrabok.config.local.toml` in your project root to set a custom browser binary or user agent:

```toml
[default]
executablePath = "/path/to/your/chrome"
overrideUserAgent = true
userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
log_level = "debug"
```

**Config discovery** — the server finds your TOML automatically. Priority order:

1. `SZKRABOK_CONFIG` env var (absolute path to a `.toml` file)
2. `SZKRABOK_ROOT` env var (walk-up within that dir)
3. MCP roots sent by the client at handshake (walk-up within each root)
4. `process.cwd()` walk-up (CLI / fallback)
5. `~/.config/szkrabok/config.toml`
6. empty defaults

Place `szkrabok.config.toml` or `szkrabok.config.local.toml` anywhere in your project tree and it will be found as long as the MCP client sends that project's directory as a root.

---

## Usage

```
scaffold_init { "dir": "/path/to/project", "preset": "full" }

# Option A — manual session lifecycle
session_manage { "action": "open", "sessionName": "my-session", "url": "https://example.com" }
browser_scrape { "sessionName": "my-session" }
browser_run_test { "sessionName": "my-session", "files": ["automation/example.spec.js"] }
session_manage { "action": "close", "sessionName": "my-session" }

# Option B — composite single command (session_run_test)
session_run_test {
  "session": { "name": "my-session", "navigation": { "policy": "always", "url": "https://example.com" } },
  "test": { "spec": "automation/example.spec.js" }
}
```

### CLI

`szkrabok` is both the MCP server and the CLI. With no arguments it starts the MCP server; with a subcommand it runs the CLI:

```bash
szkrabok open <profile>              # Launch browser, print CDP endpoint, stay alive
szkrabok open <profile> --clone      # Clone template into ephemeral copy; clone destroyed on exit
szkrabok session list                # Show all sessions (active + stored)
szkrabok session inspect <id>        # Dump cookie/localStorage counts
szkrabok session delete <id>         # Delete a session (supports glob: "cfg-*", "*")
szkrabok session delete "*"          # Delete all stored sessions
szkrabok session cleanup --days 30   # Delete sessions unused for N days
szkrabok endpoint <sessionName>      # Print CDP + WS endpoints
szkrabok detect-browser              # List usable Chrome/Chromium installations
szkrabok install-browser             # Install Playwright's Chromium
```

---

## Project Structure

* **`@szkrabok/runtime`** (`packages/runtime/`): Browser bootstrap, stealth, session pool, MCP client (`mcpConnect`, `spawnClient`, codegen).
* **Config**: `szkrabok.config.toml` (defaults) deep-merged with `szkrabok.config.local.toml` (machine-specific, gitignored).
* **Release**: `npm run deps:update` updates dependencies, `npm run release:patch` bumps version + tags, then `npm run release:publish`.

---

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/architecture.md](./docs/architecture.md) | Layer map, file layout, session lifecycle, invariants |
| [docs/development.md](./docs/development.md) | Adding tools, CLI design, release workflow |
| [docs/testing.md](./docs/testing.md) | Test categories, how to run, writing specs |
| [docs/mcp-client-library.md](./docs/mcp-client-library.md) | MCP client library and codegen |
| [docs/scaffold-init.md](./docs/scaffold-init.md) | scaffold_init presets and template structure |
