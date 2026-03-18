# Testing

## Contents

- [Configuration for tests](#configuration-for-tests)
- [Directory layout](#directory-layout)
- [Node tests](#node-tests)
- [Playwright integration tests](#playwright-integration-tests)
- [E2E — stealth health checks](#e2e--stealth-health-checks)
- [Authoring specs that run via browser.run_test](#authoring-specs-that-run-via-browserrun_test)
- [Calling browser.run_test from @szkrabok/runtime](#calling-browserrun_test-from-szkrabokмcp-client)
- [Regenerate mcp-tools.js](#regenerate-mcp-toolsjs)
- [Run everything](#run-everything)
- [Troubleshooting](#troubleshooting)

---

## Configuration for tests

Config is discovered at runtime via `initConfig()`. Priority order: `SZKRABOK_CONFIG` env var → `SZKRABOK_ROOT` env var → MCP roots → `process.cwd()` walk-up → `~/.config/szkrabok/config.toml` → empty defaults.

For tests, `process.cwd()` walk-up finds `szkrabok.config.toml` (committed repo defaults) and deep-merges `szkrabok.config.local.toml` (gitignored, machine-specific) on top.

**Minimum required for any browser test** — set `executablePath` in your local TOML:

```toml
# szkrabok.config.local.toml
[default]
executablePath = "/path/to/your/chrome"
```

Run `szkrabok detect-browser` to find installed binaries.

**Common overrides for test runs:**

```toml
[default]
executablePath    = "/usr/bin/google-chrome"
headless          = true                     # override per session_manage launchOptions
overrideUserAgent = true
userAgent         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
log_level         = "debug"

[presets.mobile-iphone-15]
viewport          = { width = 390, height = 844 }
locale            = "en-US"
timezone          = "America/New_York"
userAgent         = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ..."
```

**Precedence** (most specific wins):

```
launchOptions  >  savedConfig (last used)  >  TOML preset  >  TOML defaults  >  hardcoded defaults
```

`savedConfig` is the resolved config saved in `meta.json` from the previous launch of that session — it provides "resume with same settings" behaviour when no explicit args are given. Passing an explicit `preset` bypasses `savedConfig` for preset-derived fields (userAgent, viewport, locale, timezone) and starts fresh from that preset.

**`preset` is mutually exclusive with `userAgent`, `viewport`, `locale`, `timezone`** — passing both throws an error. `headless` and `stealth` are always allowed alongside either:

```
# valid — preset owns all appearance fields
session_manage { "action": "open", "sessionName": "s", "launchOptions": { "preset": "mobile-iphone-15", "headless": false } }

# valid — explicit fields
session_manage { "action": "open", "sessionName": "s", "launchOptions": { "userAgent": "...", "viewport": { "width": 390, "height": 844 } } }

# error — ambiguous
session_manage { "action": "open", "sessionName": "s", "launchOptions": { "preset": "mobile-iphone-15", "userAgent": "..." } }
```

---

## Directory layout

```
tests/
  node/                       node:test — no browser
    basic.test.js             public API smoke tests
    schema.test.js            tool schema validation
    contracts.test.js         architecture invariant checks (static analysis)
    config-discovery.test.js  initConfig() discovery algorithm (all 6 priority steps)
    config-values.test.js     getConfig() field defaults, TOML mapping, resolvePreset
    runtime/
      unit.test.js            config, storage, stealth evasions
      integration.test.js     cookie persistence across two launches

  playwright/
    integration/              Playwright, MCP over stdio, headless
      fixtures.js
      session.spec.js
      stealth.spec.js
      tools.spec.js
      interop.spec.js         (skipped when @playwright/mcp not installed)
      config-mcp-roots.spec.js  MCP roots → config → UA end-to-end
    e2e/                      Playwright, live external sites, headed browser
      fixtures.js
      setup.js / teardown.js
      rebrowser.spec.js
      rebrowser-mcp.spec.js
      intoli.spec.js
      navigator.spec.js
```

---

## Node tests

No browser. Fast.

```bash
npm run test:node              # all tests/node/*.test.js (basic, schema, contracts, config-discovery, config-values, playwright-patches)
npm run test:runtime:unit      # config, storage, stealth
npm run test:runtime:integration  # cookie persistence (launches real browser)
```

`npm run test:contracts` is a focused alias for `tests/node/contracts.test.js` only — useful for quick invariant checks, but it is already included in `test:node`.

### `basic.test.js`
`getSession` throws for missing session, `listRuntimeSessions` returns empty array, `resolvePreset` returns a valid object.

### `schema.test.js`
All tool schemas are valid JSON Schema; array properties have `items` defined.

### `contracts.test.js`
Static import analysis — no browser launched:
- No MCP tool calls `chromium.launch*` directly
- `src/core/` does not exist
- No MCP tool imports `@szkrabok/runtime/*` subpaths (public root only)
- `tests/playwright/e2e/fixtures.js` has no stealth imports
- `packages/runtime/launch.js` is the only file containing `launchPersistentContext`

### `runtime/unit.test.js`
TOML config loading, preset resolution, storage round-trip, stealth evasions (`navigator.webdriver === false`, plugins, UA).

### `runtime/integration.test.js`
Launches the same profile twice. Asserts cookies from run 1 are present in run 2, profile dir is identical, `state.json` reflects changes after close.

---

## Playwright integration tests

Each test spawns a fresh `node src/index.js` via `spawnClient()` and calls tools over MCP. Headless.

```bash
npm run test:playwright
# npx playwright test --project=integration
```

`tests/playwright/integration/fixtures.js` uses `spawnClient()` from `@szkrabok/runtime`. The `openSession()` fixture always injects `{ headless: true }`.

| File | Suite | What it tests |
|------|-------|---------------|
| `session.spec.js` | Session Management | `session_manage` open/list/close/delete, cookie persistence across close/reopen |
| `stealth.spec.js` | Stealth Mode | Session opens with stealth applied, `browser_run` reads page title |
| `tools.spec.js` | Workflow | `workflow.scrape` extracts structured data |
| `interop.spec.js` | CDP Interoperability | `session_manage endpoint` returns `wsEndpoint`; @playwright/mcp attaches and navigates shared browser. **Skipped** when `@playwright/mcp` is not installed |
| `config-mcp-roots.spec.js` | Config Discovery | Roots sent at init load project TOML; `SZKRABOK_CONFIG` env var loads config; both verified via `navigator.userAgent` |

---

## E2E — stealth health checks

Real browser against live bot-detection sites. Three run paths:

### Path A — MCP via `browser.run_test` (local source MCP config)

Requires MCP server running from `node src/index.js` (see [development.md](./development.md#mcp-config-for-developing-szkrabok)) and an active session.

With **Config A (local source)**, `REPO_ROOT` is already the szkrabok repo — the default `playwright.config.js` works without an explicit path:

```
session_manage {
  "action": "open",
  "sessionName": "check",
  "launchOptions": { "headless": false }
}
browser.run_test {
  "sessionName": "check",
  "project": "e2e"
}
```

With **Config B (npx/published)**, the server runs from the npx cache and has no knowledge of the local repo — pass the absolute config path:

```
browser.run_test {
  "sessionName": "check",
  "config": "/absolute/path/to/szkrabok/playwright.config.js",
  "project": "e2e"
}
```

**Note:** The `files` parameter cannot be combined with `project` — Playwright CLI treats the file paths as additional project names in that case. To run a specific spec, use `grep` instead, or omit `project` and pass only `files`.

### Path B — Standalone CLI, no session (direct launch)

Launches its own browser via `runtime.launch()`. No active session needed.

```bash
PLAYWRIGHT_PROJECT=e2e npx playwright test --project=e2e tests/playwright/e2e/rebrowser.spec.js
```

### Path C — Standalone CLI with existing session (CDP connect)

Connects to an already-open session browser. Useful when you want to inspect the browser during/after the run.

```bash
SZKRABOK_CDP_ENDPOINT=http://localhost:<port> PLAYWRIGHT_PROJECT=e2e npx playwright test --project=e2e tests/playwright/e2e/rebrowser.spec.js
```

---

| File | What it does | Mode |
|------|-------------|------|
| `rebrowser.spec.js` | bot-detector.rebrowser.net — **8/10 passing** | **headed only** |
| `rebrowser-mcp.spec.js` | Same via MCP client harness | headed |
| `intoli.spec.js` | bot.sannysoft.com — 10 Intoli + 20 fp-collect checks | headless or headed |
| `navigator.spec.js` | whatismybrowser.com navigator props + userAgentData | headed |

### rebrowser score: 8/10

Permanent failures:
- `mainWorldExecution` — requires rebrowser-patches binary (conflicts with dummyFn)
- `exposeFunctionLeak` — `page.exposeFunction` fingerprint, no fix available

---

## Authoring specs that run via `browser.run_test`

```js
// tests/playwright/e2e/my-task.spec.js
import { test, expect } from './fixtures.js';

test('my task', async ({ page }) => {
  await page.goto('https://example.com');
  expect(await page.title()).toBeTruthy();
});
```

`tests/playwright/e2e/fixtures.js` handles two modes automatically:
- **MCP** (`SZKRABOK_CDP_ENDPOINT` set) — connects to live session via CDP
- **Standalone** — calls `runtime.launch({ profile: 'dev', reuse: true })`

Pass params from MCP:
```
browser.run_test {
  "sessionName": "s",
  "files": ["tests/playwright/e2e/my-task.spec.js"],
  "project": "e2e",
  "grep": "my task",
  "params": { "url": "https://example.com" }
}
```
`params` keys are available as `process.env.TEST_<KEY>` in the spec (e.g. `TEST_URL`).

---

## Calling `browser.run_test` from `@szkrabok/runtime`

Use this when driving szkrabok programmatically from another Playwright spec or Node script:

```js
import { mcpConnect } from '@szkrabok/runtime';

// mcpConnect spawns `node src/index.js` as a subprocess.
// That process reads szkrabok.config.toml + szkrabok.config.local.toml —
// so executablePath, userAgent, headless, and presets all apply as configured.
const mcp = await mcpConnect('my-session', {
  launchOptions: { headless: false, preset: 'mobile-iphone-15' },  // optional
  sidecarEnabled: false,   // optional: log large results to .mcp-log/ files
  // adapter: customAdapter, // optional: override session adapter
});

const result = await mcp.browser.run_test({
  files: ['tests/playwright/e2e/my-task.spec.js'],
  params: { url: 'https://example.com' },  // available as process.env.TEST_URL in spec
  grep: 'my task',        // optional: filter by test name
  project: 'e2e',         // optional: playwright project
});

console.log(result.passed, result.failed);
// result.tests: [{ title, status, result }]

await mcp.close();  // closes session and shuts down the MCP subprocess
```

`browser.run_test` returns `{ passed, failed, tests }` — decoded from the JSON reporter attachment.

---

## Regenerate mcp-tools.js

After any tool registry change:

```bash
npm run codegen:mcp
```

Commit the updated `packages/runtime/mcp-client/mcp-tools.js`.

---

## Run everything

```bash
npm run lint                        # static analysis (also runs as first step of test:self)
npm run test:node                   # all tests/node/*.test.js suites
npm run test:runtime:unit           # runtime unit tests
npm run test:runtime:integration    # cookie persistence (launches real browser)
npm run test:playwright             # Playwright integration (headless, MCP over stdio)
npm run test:self                   # lint + integration + node tests (pre-publish gate)
```

For e2e (live sites, headed browser) — open a session first, then use `browser.run_test` or the standalone CLI (see [E2E paths](#e2e--stealth-health-checks) above).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `run_test` fails "Session not open" | Call `session_manage { "action": "open" }` first |
| `run_test` fails "no CDP port" | Session opened before CDP support — close and reopen |
| `rebrowser` ERR_ABORTED | Site blocks headless — open session with `headless: false` |
| intoli timeout (headed) | Intermittent — rerun |
| `Executable doesn't exist` | `npx playwright install chromium` |
| Wrong browser | Run `szkrabok detect-browser`, set `executablePath` in local TOML |
| Project TOML not picked up by MCP server | Server reads config from MCP roots — ensure the client sends roots pointing at the project directory |
| `getConfig() called before initConfig()` | Call `initConfig([])` before any config read; MCP server does this automatically |
| Custom UA ignored | UA set in `szkrabok.config.local.toml` requires the server to find that file via the discovery chain — verify with `SZKRABOK_CONFIG=/path/to/toml` env var for quick testing |
