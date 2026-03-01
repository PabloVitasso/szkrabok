# Testing

## Contents

- [Configuration for tests](#configuration-for-tests)
- [Directory layout](#directory-layout)
- [Node tests](#node-tests)
- [Playwright integration tests](#playwright-integration-tests)
- [E2E — stealth health checks](#e2e--stealth-health-checks)
- [Authoring specs that run via browser.run_test](#authoring-specs-that-run-via-browserrun_test)
- [Calling browser.run_test from @szkrabok/mcp-client](#calling-browserrun_test-from-szkrabokмcp-client)
- [Regenerate mcp-tools.js](#regenerate-mcp-toolsjs)
- [Run everything](#run-everything)
- [Troubleshooting](#troubleshooting)

---

## Configuration for tests

Tests read `szkrabok.config.toml` (committed repo defaults) and deep-merge `szkrabok.config.local.toml` (gitignored, machine-specific) on top.

**Minimum required for any browser test** — set `executablePath` in your local TOML:

```toml
# szkrabok.config.local.toml
[default]
executablePath = "/path/to/your/chrome"
```

Run `bash scripts/detect_browsers.sh` to find installed binaries.

**Common overrides for test runs:**

```toml
[default]
executablePath    = "/usr/bin/google-chrome"
headless          = true                     # override per session.open launchOptions
overrideUserAgent = true
userAgent         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
log_level         = "debug"

[presets.mobile-iphone-15]
viewport          = { width = 390, height = 844 }
locale            = "en-US"
timezone          = "America/New_York"
userAgent         = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ..."
```

TOML values are defaults — `session.open` `launchOptions` always override them per session:

```
session.open {
  "sessionName": "my-session",
  "launchOptions": {
    "headless": false,
    "preset": "mobile-iphone-15"
  }
}
```

---

## Directory layout

```
tests/
  node/                       node:test — no browser
    basic.test.js             public API smoke tests
    schema.test.js            tool schema validation
    contracts.test.js         architecture invariant checks (static analysis)
    runtime/
      unit.test.js            config, storage, stealth evasions
      integration.test.js     cookie persistence across two launches

  playwright/
    integration/              Playwright, MCP over stdio, headless
      fixtures.js
      session.spec.js
      stealth.spec.js
      tools.spec.js
      interop.spec.js
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
npm run test:node              # basic + schema
npm run test:contracts         # architecture invariants
npm run test:runtime:unit      # config, storage, stealth
npm run test:runtime:integration  # cookie persistence (launches real browser)
```

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

`tests/playwright/integration/fixtures.js` uses `spawnClient()` from `@szkrabok/mcp-client`. The `openSession()` fixture always injects `{ headless: true }`.

| File | Suite | What it tests |
|------|-------|---------------|
| `session.spec.js` | Session Management | `session.open/list/close/delete`, cookie persistence across close/reopen |
| `stealth.spec.js` | Stealth Mode | Session opens with stealth applied, `browser.run_code` reads page title |
| `tools.spec.js` | Workflow | `workflow.scrape` extracts structured data |
| `interop.spec.js` | CDP Interoperability | `session.endpoint` returns `wsEndpoint`; @playwright/mcp attaches and navigates shared browser |

---

## E2E — stealth health checks

Real browser against live bot-detection sites. **Require an active MCP session.**

```
session.open {
  "sessionName": "check",
  "launchOptions": { "headless": false, "preset": "default" }
}
browser.run_test { "sessionName": "check", "files": ["tests/playwright/e2e/rebrowser.spec.js"] }
```

Or standalone (runtime reads `szkrabok.config.local.toml` for `executablePath`):

```bash
SZKRABOK_SESSION=check npx playwright test --project=e2e tests/playwright/e2e/rebrowser.spec.js
```

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

Always run headed:
```
session.open {
  "sessionName": "rebrowser",
  "launchOptions": {
    "headless": false,
    "preset": "default"
  }
}
browser.run_test {
  "sessionName": "rebrowser",
  "files": ["tests/playwright/e2e/rebrowser.spec.js"],
  "project": "e2e"
}
```

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

## Calling `browser.run_test` from `@szkrabok/mcp-client`

Use this when driving szkrabok programmatically from another Playwright spec or Node script:

```js
import { mcpConnect } from '@szkrabok/mcp-client';

const mcp = await mcpConnect('my-session');

const result = await mcp.browser.run_test({
  files: ['tests/playwright/e2e/my-task.spec.js'],
  params: { url: 'https://example.com' },
  grep: 'my task',        // optional: filter by test name
  project: 'e2e',         // optional: playwright project
});

console.log(result.passed, result.failed);
// result.tests: [{ title, status, result }]

await mcp.session.close({ save: true });
```

`mcpConnect` spawns the MCP server as a subprocess and returns a typed handle. `browser.run_test` returns `{ passed, failed, tests }` — decoded from the JSON reporter attachment.

---

## Regenerate mcp-tools.js

After any tool registry change:

```bash
npm run codegen:mcp
```

Commit the updated `packages/mcp-client/mcp-tools.js`.

---

## Run everything

```bash
npm run test:node          # all node:test suites
npm run test:contracts     # architecture invariants
npm run test:playwright    # Playwright integration (browser required)
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `run_test` fails "Session not open" | Call `session.open` first |
| `run_test` fails "no CDP port" | Session opened before CDP support — close and reopen |
| `rebrowser` ERR_ABORTED | Site blocks headless — open session with `headless: false` |
| intoli timeout (headed) | Intermittent — rerun |
| `Executable doesn't exist` | `npx playwright install chromium` |
| Wrong browser | Run `bash scripts/detect_browsers.sh`, set `executablePath` in local TOML |
