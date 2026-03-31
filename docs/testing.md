# Testing

## Contents

- [Configuration for tests](#configuration-for-tests)
- [Directory layout](#directory-layout)
- [Node tests](#node-tests)
- [Playwright integration tests](#playwright-integration-tests)
- [E2E — stealth health checks](#e2e--stealth-health-checks)
- [Authoring specs that run via browser_run_test](#authoring-specs-that-run-via-browser_run_test)
- [Calling browser_run_test from @szkrabok/runtime](#calling-browser_run_test-from-szkrabokмcp-client)
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

Run `szkrabok doctor detect` to see all candidates and their status. Use `szkrabok doctor detect --write-config` to pin a discovered path to config.

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
    attach-signal.test.js     writeAttachSignal — 3 tests (write, no-op, fail-fast)
    basic.test.js             public API smoke tests
    schema.test.js            tool schema validation
    contracts.test.js         architecture invariant checks (static analysis)
    config-discovery.test.js  initConfig() discovery algorithm (all 6 priority steps)
    config-values.test.js     getConfig() field defaults, TOML mapping, resolvePreset
    playwright-patches.test.js verifies all 7 playwright-core patch markers present
    session_run_test.test.js  session_run_test — 21 unit tests (EX-1); all deps injected, no browser
    runtime/
      unit.test.js            config, storage, stealth evasions
      integration.test.js     cookie persistence across two launches
      pc-layer1.test.js       Profile cloning — storage unit (readDevToolsPort, cloneDir, cleanupClones)
      pc-layer2.test.js       Profile cloning — pool (isClone, cloneDir fields)
      pc-layer3.test.js       Profile cloning — destroyClone unit
      pc-layer4.test.js       Profile cloning — launchClone unit (mocked launch)
      pc-layer5.test.js       Profile cloning — MCP tool routing
      pc-layer6.test.js       Profile cloning — real browser integration

  playwright/
    integration/              Playwright, MCP over stdio, headless
      fixtures.js
      session.spec.js
      stealth.spec.js
      tools.spec.js
      interop.spec.js         (skipped when @playwright/mcp not installed)
      config-mcp-roots.spec.js  MCP roots → config → UA end-to-end
      session_run_test.spec.js  session_run_test — 3 integration tests (EX-2); real browser + subprocess
    e2e/                      Playwright, live external sites, headed browser
      fixtures.js
      setup.js / teardown.js
      noop.spec.js            minimal noop — used as inner spec by session_run_test integration tests
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
- `src/fixtures.js` structural contracts: `resolveConfig` present, `ownsBrowser` used, `writeAttachSignal` appears before `await use(session)`, `browser` worker-scoped, `context` not overridden (Playwright 1.55+ disallows scope change of built-in test-scoped fixture), no silent catch, no static runtime import, all option declarations present
- `package.json` declares `@playwright/test >=1.49.1` as optional peer dep

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
| `session.spec.js` | Session Management | `session_manage` open/list/close/delete (glob patterns supported), cookie persistence across close/reopen |
| `stealth.spec.js` | Stealth Mode | Session opens with stealth applied, `browser_run` reads page title |
| `tools.spec.js` | Workflow | `browser_scrape` extracts structured data |
| `interop.spec.js` | CDP Interoperability | `session_manage endpoint` returns `wsEndpoint`; @playwright/mcp attaches and navigates shared browser. **Skipped** when `@playwright/mcp` is not installed |
| `config-mcp-roots.spec.js` | Config Discovery | Roots sent at init load project TOML; `SZKRABOK_CONFIG` env var loads config; both verified via `navigator.userAgent` |
| `session_run_test.spec.js` | session_run_test (EX-2) | End-to-end template mode, postPolicy keep, withLock serialization |
| `scaffold-smoke.spec.js` | Zero-install smoke | `browser_run_test` CDP path works in external project (sk-skills); proves connectOverCDP fixture end-to-end |

### `session_run_test` tests (EX-1 + EX-2)

Unit tests (`tests/node/session_run_test.test.js`) call `_run` directly with injected deps — no browser, no subprocess. `mockGetSession({ throwNth })` throws from call N onwards; `Infinity` = always return.

| ID | What | Layer |
|----|------|-------|
| EX-1.1–1.3 | Clone lifecycle: isClone flag, runtimeName, sessionClose on destroy | unit |
| EX-1.4–1.6 | Template lifecycle: no isClone, runtimeName = logicalName, sessionClose on save | unit |
| EX-1.10–1.14 | Navigation policy branching: always/ifBlank/never, URL validation before I/O | unit |
| EX-1.15–1.18 | Failure propagation: session error, nav error, test error (postPolicy still runs), postPolicy error | unit |
| EX-1.21–1.23 | templateConflict: fail, close-first ordering, clone-from-live | unit |
| EX-1.24–1.25 | enforceLaunchOptionsMatch: hard fail on mismatch; warn + continue | unit |
| EX-1.26 | workers:1 and signalAttach:true always forwarded to run_test | unit |
| EX-2.1 | Template mode end-to-end: response shape, session closed after default save | integration |
| EX-2.2 | postPolicy keep: session still in `session_manage list` after test | integration |
| EX-2.3 | withLock: two concurrent same-name calls both complete (deadlock would timeout) | integration |
| EX-2.4 | Clone mode headless: launchOptions forwarded, noop passes, clone not active after destroy | integration |

EX-1.7–1.9 (postPolicy keep keep/dead/recreate) and EX-1.19–1.20 (concurrency) are not unit-tested — see feature doc for rationale. EX-2.2 and EX-2.3 cover these gaps.

---

## E2E — stealth health checks

Real browser against live bot-detection sites. Three run paths:

### Path A — MCP via `browser_run_test` (local source MCP config)

Requires MCP server running from `node src/index.js` (see [development.md](./development.md#mcp-config-for-developing-szkrabok)) and an active session. **Close the session when done** — `browser_run_test` does not close it automatically (the caller owns the lifecycle):

```
session_manage { "action": "close", "sessionName": "check" }
```

With **Config A (local source)**, `REPO_ROOT` is already the szkrabok repo — the default `playwright.config.js` works without an explicit path:

```
session_manage {
  "action": "open",
  "sessionName": "check",
  "launchOptions": { "headless": false }
}
browser_run_test {
  "sessionName": "check",
  "project": "e2e"
}
```

With **Config B (npx/published)**, the server runs from the npx cache and has no knowledge of the local repo — pass the absolute config path:

```
browser_run_test {
  "sessionName": "check",
  "config": "/absolute/path/to/szkrabok/playwright.config.js",
  "project": "e2e"
}
```

**Note:** The `files` parameter cannot be combined with `project` — Playwright CLI treats the file paths as additional project names in that case. To run a specific spec, use `grep` instead, or omit `project` and pass only `files`.

**External project configs:** `browser_run_test` spawns the Playwright subprocess with `cwd` set to `dirname(config)`. This means an absolute config path from a different project (e.g. `/path/to/sk-skills/playwright.config.js`) uses that project's own `node_modules` and playwright version — no version skew.

### Path B — Standalone CLI, no session (direct launch)

Launches its own browser via `runtime.launch()`. No active session needed.

```bash
PLAYWRIGHT_PROJECT=e2e npx playwright test --project=e2e tests/playwright/e2e/rebrowser.spec.js
```

The scaffolded `playwright.config.js` includes `['json', { outputFile: 'test-results/report.json' }]` — standalone runs write the JSON report there automatically.

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

## Authoring specs that run via `browser_run_test`

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
browser_run_test {
  "sessionName": "s",
  "files": ["tests/playwright/e2e/my-task.spec.js"],
  "project": "e2e",
  "grep": "my task",
  "params": { "url": "https://example.com" }
}
```
`params` keys are available as uppercased env vars in the spec (e.g. `{url:...}` → `process.env.URL`).

---

## Calling `browser_run_test` from `@szkrabok/runtime`

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

const result = await mcp.browser_run_test({
  files: ['tests/playwright/e2e/my-task.spec.js'],
  params: { url: 'https://example.com' },  // available as process.env.URL in spec
  grep: 'my task',        // optional: filter by test name
  project: 'e2e',         // optional: playwright project
  workers: 1,            // optional: parallel workers (session_run_test forces 1)
  reportFile: 'test-results/my-run.json',  // optional: custom report path (repo-relative)
});

console.log(result.passed, result.failed, result.reportFile);
// result.tests: [{ title, status, result }]

await mcp.close();  // closes session and shuts down the MCP subprocess
```

`browser_run_test` returns `{ passed, failed, skipped, tests, log, reportFile }`. `reportFile` is the resolved absolute path to the JSON report on disk.

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

For e2e (live sites, headed browser) — open a session first, then use `browser_run_test` or the standalone CLI (see [E2E paths](#e2e--stealth-health-checks) above).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `run_test` fails "Session not open" | Call `session_manage { "action": "open" }` first |
| `run_test` fails "no CDP port" | Session opened before CDP support — close and reopen |
| `rebrowser` ERR_ABORTED | Site blocks headless — open session with `headless: false` |
| intoli timeout (headed) | Intermittent — rerun |
| `Executable doesn't exist` | `npx playwright install chromium` |
| Wrong browser | Run `szkrabok doctor detect` to see the resolution chain; `doctor detect --write-config` pins the path |
| Project TOML not picked up by MCP server | Server reads config from MCP roots — ensure the client sends roots pointing at the project directory |
| `getConfig() called before initConfig()` | Call `initConfig([])` before any config read; MCP server does this automatically |
| `context.browser(...).process is not a function` | Playwright build does not expose `browser.process()` — `tryBrowserPid()` handles this gracefully, returning `null`. This error means the running code is stale. Restart the MCP server to pick up the source. |
| Custom UA ignored | UA set in `szkrabok.config.local.toml` requires the server to find that file via the discovery chain — verify with `SZKRABOK_CONFIG=/path/to/toml` env var for quick testing |
