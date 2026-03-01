# Testing

Four test categories, each validating different layers of the architecture.

---

## 1. Runtime unit tests

No MCP server. No Playwright Test runner.

```bash
npm run test:runtime:unit
# node --test selftest/runtime/unit.test.js
```

Covers: TOML config loading, preset resolution, storage round-trip, stealth evasions (`navigator.webdriver === false`, plugins, UA).

---

## 2. Runtime integration tests

```bash
npm run test:runtime:integration
# node --test selftest/runtime/integration.test.js
```

Launches the same profile twice. Asserts cookies from run 1 are present in run 2, profile dir is identical, `state.json` reflects changes after each close.

---

## 3. MCP contract tests

```bash
npm run test:contracts
# node --test selftest/mcp/contract.test.js
```

Verifies architecture invariants:
- No MCP tool calls `chromium.launch*` directly
- `src/core/` does not exist
- No MCP tool imports `@szkrabok/runtime/*` subpaths (only the public root)

---

## 4. Playwright selftests — MCP server

Each test spawns a fresh `node src/index.js` subprocess via `spawnClient()` and calls tools over MCP.

```bash
npx playwright test --project=selftest
npm run test:playwright
```

`selftest/playwright/fixtures.js` uses `spawnClient()` from `mcp-client/runtime/transport.js`. The `openSession()` fixture always injects `{ headless: true }` so tests pass in any environment.

| File | Suite | What it tests |
| ---- | ----- | ------------- |
| `session.spec.js` | Session Management | `session.open`, `session.list`, `session.close`, `session.delete` |
| `stealth.spec.js` | Stealth Mode | Session opens with stealth; sannysoft result attached |
| `tools.spec.js` | CSS Selector Tools / Workflow | `nav.goto`, `extract.text`, `extract.html`, `workflow.scrape` |

---

## 5. Node:test selftests

```bash
npm run test:node
# node --test selftest/node/*.test.js
```

| File | What it tests |
| ---- | ------------- |
| `basic.test.js` | Server starts, tools listed via public API |
| `schema.test.js` | All tool schemas valid |
| `playwright_mcp.test.js` | snapshot, click, type via CDP |
| `scrap.test.js` | extract + session open/close cycle |

---

## 6. Automation — real browser workflows

Real automation against live sites. Serve as integration and stealth health checks.

**Require an active MCP session** (`session.open` first).

```
session.open { "sessionName": "my-session" }
browser.run_test { "sessionName": "my-session", "files": ["automation/intoli-check.spec.js"] }
```

Or run standalone (runtime launches its own browser):

```bash
npx playwright test --project=automation automation/intoli-check.spec.js
```

### Test cases

| File | What it does | Mode |
| ---- | ------------ | ---- |
| `automation/park4night/park4night.spec.js` | Cookie banner + login + GPS search (serial, independently runnable) | headed |
| `automation/intoli-check.spec.js` | bot.sannysoft.com — 10 Intoli + 20 fp-collect checks | headless or headed |
| `automation/rebrowser-check.spec.js` | bot-detector.rebrowser.net — **8/10 passing** | **headed only** — site blocks headless |
| `automation/navigator-properties.spec.js` | whatismybrowser.com navigator props + userAgentData eval | headed |

#### rebrowser-check

Score: **8/10**. Permanent failures (no fix available):
- `mainWorldExecution` — requires rebrowser-patches alwaysIsolated mode (conflicts with dummyFn)
- `exposeFunctionLeak` — `page.exposeFunction` fingerprint is unfixable

Always open the session headed:
```
session.open { "sessionName": "rebrowser", "launchOptions": { "headless": false } }
browser.run_test { "sessionName": "rebrowser", "files": ["automation/rebrowser-check.spec.js"] }
```

#### intoli-check

**Intoli table (10 checks):**
`User Agent` · `WebDriver` · `WebDriver Advanced` · `Chrome` · `Permissions` · `Plugins Length` · `Plugins is of type PluginArray` · `Languages` · `WebGL Vendor` · `Broken Image Dimensions`

`WebGL Renderer` excluded — hardware GPU string, not a stealth evasion issue.

**fp-collect table (20 checks):**
`PHANTOM_UA` · `PHANTOM_PROPERTIES` · `PHANTOM_ETSL` · `PHANTOM_LANGUAGE` · `PHANTOM_WEBSOCKET` · `MQ_SCREEN` · `PHANTOM_OVERFLOW` · `PHANTOM_WINDOW_HEIGHT` · `HEADCHR_UA` · `HEADCHR_CHROME_OBJ` · `HEADCHR_PERMISSIONS` · `HEADCHR_PLUGINS` · `HEADCHR_IFRAME` · `CHR_DEBUG_TOOLS` · `SELENIUM_DRIVER` · `CHR_BATTERY` · `CHR_MEMORY` · `TRANSPARENT_PIXEL` · `SEQUENTUM` · `VIDEO_CODECS`

---

## 7. MCP client harness (project: mcp)

Tests that use the generated `mcp-client/mcp-tools.js` handle. No browser fixture — harnesses manage their own session lifecycle via `mcpConnect()`.

```bash
npx playwright test --project=mcp
npm run test:clientmcp
```

| File | What it does |
| ---- | ------------ |
| `automation/park4night/park4night.mcp.spec.js` | Opens session, delegates to park4night.spec.js via `browser.run_test`, closes |
| `automation/rebrowser-check.mcp.spec.js` | Full rebrowser run via MCP client with known-failure exclusion |

Regenerate `mcp-tools.js` after any registry change:

```bash
npm run codegen:mcp
```

---

## Writing automation tests

```javascript
// automation/your-task.spec.js
import { test, expect } from './fixtures.js';
import { attachResult } from './core/result.js';

test('my task', async ({ page }, testInfo) => {
  await page.goto('https://example.com');
  // ... actions / assertions ...
  await attachResult(testInfo, { url: page.url() });
});
```

`automation/fixtures.js` handles two modes automatically:
- **MCP** (`SZKRABOK_CDP_ENDPOINT` set) — connects to live session via CDP
- **Standalone** — calls `runtime.launch({ profile: 'dev', reuse: true })` for a fresh stealth browser

Pass params via `browser.run_test`:
```
browser.run_test { "sessionName": "s", "params": { "url": "https://..." } }
```
→ available as `process.env.TEST_URL` in the spec.

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `run_test` fails "Session not open" | Call `session.open` first |
| `run_test` fails "no CDP port" | Session opened before CDP support — close and reopen |
| `MCP registry drift detected` | Run `npm run codegen:mcp` then commit updated `mcp-tools.js` |
| `rebrowser-check` ERR_ABORTED | Site blocks headless — open session with `headless: false` |
| intoli-check timeout (headed) | Intermittent — rerun |
| `Executable doesn't exist` | `npx playwright install chromium` |
| No JSON result in output | Use `attachResult(testInfo, {...})` from `automation/core/result.js` |
| Wrong browser | Run `bash scripts/detect_browsers.sh`, set `executablePath` in local TOML |
