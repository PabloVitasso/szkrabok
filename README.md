# Szkrabok

MCP server supplementing [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) with persistent sessions, stealth mode, and scripted automation.

**Core Enhancements:**

* **Named Sessions:** Persistent cookies, localStorage, and Chromium profiles.
* **Stealth:** Integrated `playwright-extra` + stealth plugin and anti-bot CDP patches.
* **Deterministic Ports:** Fixed CDP ports per session for `connectOverCDP()`.

---

## Tools & Capabilities

### 1. session_manage

Manage browser sessions. Actions: open (launch/resume), close (save+close), list (all stored), delete (remove data), endpoint (get CDP/WS URLs).

- **action** (required): `open` | `close` | `list` | `delete` | `endpoint`
- **sessionName**: Session identifier. Required for open/close/delete/endpoint, not for list
- **url**: URL to navigate after opening (open only)
- **save**: Persist session on close, default `true`
- **launchOptions** (open only):
  - **preset**: Preset name. Mutually exclusive with userAgent/viewport/locale/timezone. See [Presets](#presets)
  - **stealth**: Enable stealth mode, default `true`
  - **disableWebGL**: Disable WebGL, default `false`
  - **headless**: Run headless
  - **userAgent**: Custom UA string
  - **viewport**: `{ width, height }`
  - **locale**: BCP 47 locale
  - **timezone**: IANA timezone

  Examples:
  - With preset: `{ preset: "desktop-chrome-win", headless: false, stealth: true }`
  - With explicit fields: `{ userAgent: "...", viewport: { width: 1280, height: 800 }, locale: "en-US", timezone: "America/New_York", headless: false }`
  - **Note:** `preset` is mutually exclusive with `userAgent`, `viewport`, `locale`, `timezone`. `headless` and `stealth` are always allowed alongside either.

Returns: `{ success, sessionName, url, reused, preset, label, cdpEndpoint }`

### 2. workflow.scrape

Scrape current page into LLM-ready text.

- **sessionName** (required)
- **selectors**: CSS selectors to target. Omit for auto (main or body)

Returns: `{ raw: [{ tag, text }], llmFriendly, tokenCountEstimate }`

### 3. browser_run

Execute Playwright JS on session page.

- **sessionName** (required)
- **code**: Inline async function as string. Mutually exclusive with `path`
- **path**: Path to `.mjs` file. Mutually exclusive with `code`
- **fn**: Named export from path, default `"default"`
- **args**: Object passed as second param to function

Returns: `{ result, url }`

### 4. browser.run_test

Run `.spec.js` tests via CDP. Requires `scaffold.init` and open session.

- **sessionName** (required)
- **files**: File/directory paths for playwright test
- **grep**: Filter tests by name (regex)
- **params**: Key/value → `TEST_*` env vars
- **config**: Config path, default `playwright.config.js`
- **project**: Playwright project name
- **keepOpen**: Reconnect session after test if MCP context invalidated, default `false`

Returns: `{ passed, failed, skipped, tests: [{ title, status, error, result }], log }`

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

### 5. scaffold.init

Init szkrabok project (idempotent). Prerequisite for browser runs.

- **dir**: Target directory, default cwd
- **name**: Package name, default dirname
- **preset**: `minimal` (config only) or `full` (fixtures + specs)
- **install**: Run npm install after, default `false`

Returns: `{ created, skipped, merged, installed, warnings }`

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
    const result = await mcp.browser.run_test({ files: ['tests/playwright/e2e/rebrowser.spec.js'] });
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
scaffold.init { "dir": "/path/to/project", "preset": "full" }
session_manage { "action": "open", "sessionName": "my-session", "url": "https://example.com" }
workflow.scrape { "sessionName": "my-session" }
browser.run_test { "sessionName": "my-session", "files": ["automation/example.spec.js"] }
session_manage { "action": "close", "sessionName": "my-session" }
```

### CLI

`szkrabok` is both the MCP server and the CLI. With no arguments it starts the MCP server; with a subcommand it runs the CLI:

```bash
szkrabok open <profile>              # Launch browser, print CDP endpoint, stay alive
szkrabok session list                # Show all sessions (active + stored)
szkrabok session inspect <id>        # Dump cookie/localStorage counts
szkrabok session delete <id>         # Delete a session
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
| [docs/scaffold-init.md](./docs/scaffold-init.md) | scaffold.init presets and template structure |
