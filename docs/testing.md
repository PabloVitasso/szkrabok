# Testing

Two suites, one root `playwright.config.ts` with two projects: `selftest` and `automation`.

---

## selftest — MCP server internal tests

Verifies the MCP server tools work correctly. No real browsing target needed.

```bash
# Playwright specs (session lifecycle, stealth, CSS tools)
npx playwright test --project=selftest

# Node:test specs (schema, basic, MCP protocol)
node --test selftest/node/*.test.js

# Both
npm run test:self
```

### Test cases

| File | Suite | What it tests |
|---|---|---|
| `selftest/playwright/session.spec.js` | Session Management | `session.open` creates session; `session.list` returns it; `session.close` persists state; `session.delete` removes it |
| `selftest/playwright/stealth.spec.js` | Stealth Mode | Session opens with stealth enabled; sannysoft result attached |
| `selftest/playwright/tools.spec.js` | CSS Selector Tools / Workflow | `navigate.goto`, `extract.text`, `extract.html`, `workflow.scrape` |
| `selftest/node/basic.test.js` | Basic | Server starts, tools listed |
| `selftest/node/schema.test.js` | Schema | All tool schemas valid |
| `selftest/node/playwright_mcp.test.js` | Playwright MCP | snapshot, click, type via CDP |
| `selftest/node/scrap.test.js` | Scraping | extract + session open/close cycle |

---

## automation — real browser workflows

Real automation tasks against live sites. Also serve as integration/stealth health checks.
Require an active MCP session with CDP (`session.open` first).

```bash
# Via MCP (recommended)
session.open { "id": "my-session" }
browser.run_test { "id": "my-session" }
browser.run_test { "id": "my-session", "grep": "acceptCookies" }

# Via CLI
SZKRABOK_SESSION=my-session npx playwright test --project=automation
SZKRABOK_SESSION=my-session SZKRABOK_PRESET=mobile-iphone-15 npx playwright test --project=automation
npm run test:auto   # requires SZKRABOK_SESSION set
```

### Test cases

| File | grep | What it does | Notes |
|---|---|---|---|
| `automation/park4night.spec.js` | `acceptCookies` | Navigates to park4night.com, dismisses cookie banner | Skips gracefully on reused session (cookies already set) |
| `automation/intoli-check.spec.js` | `intoli-check` | Runs bot.sannysoft.com — 10 Intoli checks + 20 fp-collect checks; session id: `intoli` | WebGL Renderer excluded (hardware GPU string, not a stealth evasion) |
| `automation/rebrowser-check.spec.js` | `rebrowser-check` | Runs bot-detector.rebrowser.net — 9 checks; session id: `rebrowser` | Triggers dummyFn, sourceUrlLeak, mainWorldExecution, exposeFunctionLeak before asserting |

#### intoli-check detail

**Intoli table (10 checks)** — result `td` carries class `result passed/failed/warn`:
`User Agent` · `WebDriver` · `WebDriver Advanced` · `Chrome` · `Permissions` · `Plugins Length` · `Plugins is of type PluginArray` · `Languages` · `WebGL Vendor` · `Broken Image Dimensions`

`WebGL Renderer` is excluded — it reports the hardware GPU string (SwiftShader on machines without a GPU), which stealth cannot spoof. `WebGL Vendor` covers the GL identity check.

**fp-collect table (20 checks)** — status `td` (2nd column) carries class `passed` when `ok`:
`PHANTOM_UA` · `PHANTOM_PROPERTIES` · `PHANTOM_ETSL` · `PHANTOM_LANGUAGE` · `PHANTOM_WEBSOCKET` · `MQ_SCREEN` · `PHANTOM_OVERFLOW` · `PHANTOM_WINDOW_HEIGHT` · `HEADCHR_UA` · `HEADCHR_CHROME_OBJ` · `HEADCHR_PERMISSIONS` · `HEADCHR_PLUGINS` · `HEADCHR_IFRAME` · `CHR_DEBUG_TOOLS` · `SELENIUM_DRIVER` · `CHR_BATTERY` · `CHR_MEMORY` · `TRANSPARENT_PIXEL` · `SEQUENTUM` · `VIDEO_CODECS`

---

## Scripts (`automation/scripts/`)

### inspect-page.mjs

Generic table + iframe inspector. Run via `browser.run_file` to explore any page before writing assertions.

```json
{
  "tool": "browser.run_file",
  "args": {
    "id": "my-session",
    "path": "automation/scripts/inspect-page.mjs",
    "args": {
      "url":        "https://example.com",
      "wait":       "table tr",
      "settle":     1000,
      "nameCol":    0,
      "valueCol":  -1,
      "statusCol": -1,
      "filterCls":  "error|warning",
      "filterText": "FAIL",
      "iframes":    true
    }
  }
}
```

All args optional. Omit `url` to inspect the current page. Use `filterCls`/`filterText` to reduce output.
Returns `{ rows: [{name, value, cls}], iframes: [{url, rows}] }`.

---

## Writing automation tests

```javascript
// automation/your-task.spec.js
import { test, expect } from './fixtures.js'

test('my task', async ({ page }, testInfo) => {
  await page.goto('https://example.com')
  // ... actions / assertions ...

  await testInfo.attach('result', {
    body: JSON.stringify({ url: page.url() }),
    contentType: 'application/json',
  })
})
```

Stealth is active in both modes:
- **MCP** (`browser.run_test`) — fixture connects to the live stealth session via CDP
- **Standalone CLI** — fixture launches its own stealth browser via `enhanceWithStealth(chromium)`

Both paths use the same `playwright-extra` + `puppeteer-extra-plugin-stealth` library with identical evasions. `storageState.json` from a previous session is loaded for cookies when running standalone.

Params: `browser.run_test { params: { url: "..." } }` → `TEST_URL` env var.

---

## Session state sharing

Automation tests connect to the same Chrome as the MCP session via CDP — cookies, localStorage, and browsing done via MCP tools are immediately visible without a close/reopen cycle.

Without an active MCP session, tests fall back to `storageState.json` from a previous session if present.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `run_test` fails "Session not open" | Call `session.open {id}` first |
| `run_test` fails "no CDP port" | Session opened before CDP support — close and reopen |
| WebGL Renderer FAIL on intoli-check | Not a stealth issue — it's the hardware GPU string; excluded from assertions |
| `Executable doesn't exist` | `npx playwright install chromium` |
| No JSON result in output | Add `testInfo.attach('result', {...})` to the test |
