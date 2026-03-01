# Testing

Six test categories validating different layers.

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

Verifies architecture invariants via static import analysis — no browser launched:
- No MCP tool calls `chromium.launch*` directly
- `src/core/` does not exist
- No MCP tool imports `@szkrabok/runtime/*` subpaths (only the public root)
- `packages/runtime/launch.js` is the only file containing `launchPersistentContext`

---

## 4. Node:test selftests

```bash
npm run test:node
# node --test selftest/node/*.test.js
```

| File | What it tests |
|------|---------------|
| `basic.test.js` | `getSession` throws for missing session, `listRuntimeSessions` returns empty, preset resolves |
| `schema.test.js` | All tool schemas valid JSON Schema, array properties have `items` |
| `playwright_mcp.test.js` | snapshot, click, type via CDP against live browser |
| `scrap.test.js` | extract + session open/close cycle against bot-detector |

---

## 5. Playwright selftests

Each test spawns a fresh `node src/index.js` via `spawnClient()` and calls tools over MCP.

```bash
npm run test:playwright
# npx playwright test --project=selftest
```

`selftest/playwright/fixtures.js` uses `spawnClient()` from `@szkrabok/mcp-client`. The `openSession()` fixture always injects `{ headless: true }`.

| File | Suite | What it tests |
|------|-------|---------------|
| `session.spec.js` | Session Management | `session.open`, `session.list`, `session.close`, `session.delete` |
| `stealth.spec.js` | Stealth Mode | Session opens with stealth applied |
| `tools.spec.js` | CSS Selector / Workflow | `nav.goto`, `extract.text`, `extract.html`, `workflow.scrape` |

---

## 6. Automation — stealth health checks

Real browser against live bot-detection sites. **Require an active MCP session.**

```
session.open { "sessionName": "check" }
browser.run_test { "sessionName": "check", "files": ["automation/rebrowser-check.spec.js"] }
```

Or standalone (runtime launches its own browser):

```bash
npx playwright test --project=automation automation/rebrowser-check.spec.js
```

| File | What it does | Mode |
|------|-------------|------|
| `rebrowser-check.spec.js` | bot-detector.rebrowser.net — **8/10 passing** | **headed only** |
| `rebrowser-check.mcp.spec.js` | Same via MCP client harness | headed |
| `intoli-check.spec.js` | bot.sannysoft.com — 10 Intoli + 20 fp-collect checks | headless or headed |
| `navigator-properties.spec.js` | whatismybrowser.com navigator props + userAgentData | headed |

#### rebrowser-check

Score: **8/10**. Permanent failures:
- `mainWorldExecution` — requires rebrowser-patches binary (conflicts with dummyFn)
- `exposeFunctionLeak` — `page.exposeFunction` fingerprint, no fix available

Always run headed:
```
session.open { "sessionName": "rebrowser", "launchOptions": { "headless": false } }
browser.run_test { "sessionName": "rebrowser", "files": ["automation/rebrowser-check.spec.js"] }
```

---

## Run all selftests

```bash
npm run test:node          # runtime unit + integration + node selftests
npm run test:contracts     # MCP invariants
npm run test:playwright    # Playwright selftests (browser required)
```

---

## Writing specs for `browser.run_test`

```js
// automation/your-task.spec.js
import { test, expect } from './fixtures.js';
import { attachResult } from './core/result.js';

test('my task', async ({ page }, testInfo) => {
  await page.goto('https://example.com');
  await attachResult(testInfo, { url: page.url() });
});
```

`automation/fixtures.js` handles two modes automatically:
- **MCP** (`SZKRABOK_CDP_ENDPOINT` set) — connects to live session via CDP
- **Standalone** — calls `runtime.launch({ profile: 'dev', reuse: true })`

Pass params from MCP:
```
browser.run_test { "sessionName": "s", "params": { "url": "https://..." } }
```
Available as `process.env.TEST_URL` in the spec.

---

## Regenerate mcp-tools.js

After any tool registry change:

```bash
npm run codegen:mcp
```

Commit the updated `packages/mcp-client/mcp-tools.js`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `run_test` fails "Session not open" | Call `session.open` first |
| `run_test` fails "no CDP port" | Session opened before CDP support — close and reopen |
| `rebrowser-check` ERR_ABORTED | Site blocks headless — open session with `headless: false` |
| intoli-check timeout (headed) | Intermittent — rerun |
| `Executable doesn't exist` | `npx playwright install chromium` |
| No JSON result in output | Use `attachResult(testInfo, {...})` from `automation/core/result.js` |
| Wrong browser | Run `bash scripts/detect_browsers.sh`, set `executablePath` in local TOML |
