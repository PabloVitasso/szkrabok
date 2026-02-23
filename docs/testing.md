# Testing Procedure

## Prerequisites

```bash
# Install Node deps (from repo root)
npm install

# Install playwright browsers (if chromium-* not in ~/.cache/ms-playwright/)
npx playwright install chromium
```

The playwright config auto-detects installed browsers — if the exact version isn't present
it falls back to the highest installed chromium. See [architecture.md](./architecture.md).

---

## Standalone playwright tests

```bash
# Run all tests
SZKRABOK_SESSION=playwright-default \
  npx playwright test --config playwright-tests/playwright.config.ts

# Run specific test by name
SZKRABOK_SESSION=playwright-default \
  npx playwright test --config playwright-tests/playwright.config.ts --grep "page title"

# Pass parameters (TEST_* env vars)
SZKRABOK_SESSION=my-session \
  TEST_URL=https://example.com \
  TEST_TITLE=Example \
  npx playwright test --config playwright-tests/playwright.config.ts --grep "page title"
```

Expected output: `2 passed` (or filtered subset).
JSON results written to `playwright-tests/test-results.json`.

---

## Via szkrabok MCP (`browser.run_test`)

**Required order — `session.open` must come first:**

```json
{"tool": "session.open", "args": {"id": "my-session", "url": "https://example.com"}}
```

This launches Chrome with a deterministic CDP port (derived from the session id).
`browser.run_test` connects to that same Chrome via `connectOverCDP` — tests share the live browser state.
Calling `browser.run_test` without an open session fails with a clear message showing the exact `session.open` call needed.

Run all tests:
```json
{"tool": "browser.run_test", "args": {"id": "my-session"}}
```

Run filtered + parametrized:
```json
{
  "tool": "browser.run_test",
  "args": {
    "id": "my-session",
    "grep": "page title",
    "params": {"url": "https://example.com", "title": "Example"}
  }
}
```

Expected response:
```json
{
  "log": [
    "Running 1 test using 1 worker",
    "step 1. navigate to https://example.com",
    "  ✓  tests/example.spec.ts › page title (1.2s)",
    "  1 passed (3.1s)"
  ],
  "passed": 1,
  "failed": 0,
  "skipped": 0,
  "tests": [
    {
      "title": "page title check",
      "status": "passed",
      "result": {"title": "Example Domain", "url": "https://example.com"}
    }
  ]
}
```

`log` — one array item per output line (console.log + list reporter).
Raw files also written to `sessions/{id}/last-run.log` and `sessions/{id}/last-run.json`.

---

## Available tests

| File | grep | What it tests |
|---|---|---|
| `tests/park4night.spec.ts` | `acceptCookies` | Cookie banner dismissed; skips on reused session |
| `tests/stealthcheck.spec.ts` | `stealthcheck` | bot.sannysoft.com — 11 Intoli + 20 fp-collect checks, asserts no `td.failed`/`td.warn` |

---

## Scripts (`playwright-tests/scripts/`)

### inspect-page.mjs

Generic table + iframe inspector. Run via `browser.run_file` to explore any page before writing assertions.

```json
{
  "tool": "browser.run_file",
  "args": {
    "id": "my-session",
    "path": "playwright-tests/scripts/inspect-page.mjs",
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

All args optional. Omit `url` to inspect the current page. Use `filterCls`/`filterText` to reduce output. Returns `{ rows: [{name, value, cls}], iframes: [{url, rows}] }`.

---

## Writing tests

Import from `fixtures` (not `@playwright/test`) to get CDP session sharing:

```typescript
// playwright-tests/tests/your-spec.ts
import { test, expect } from '../fixtures';

const TARGET = process.env.TEST_URL ?? 'https://default.example.com';

test('my test', async ({ page }, testInfo) => {
  await page.goto(TARGET);
  // ... assertions ...

  // Return structured data via attachment
  await testInfo.attach('result', {
    body: JSON.stringify({ url: page.url(), /* any data */ }),
    contentType: 'application/json',
  });
});
```

Params mapping: `params: {url: "...", myKey: "..."}` → `TEST_URL`, `TEST_MYKEY` env vars.

---

## Session state sharing

Tests connect to the same Chrome process as the MCP session via CDP — cookies, localStorage, and any browsing done via MCP tools are immediately visible to tests without needing a session close/reopen cycle.

Without an active MCP session, tests fall back to `storageState.json` saved from a previous session if present.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Executable doesn't exist` | `npx playwright install chromium` |
| `exports is not defined` | Ensure `playwright-tests/package.json` has `{"type":"commonjs"}` |
| Tests pick wrong config | Use `--config playwright-tests/playwright.config.ts` explicitly |
| No JSON result in output | Add `testInfo.attach('result', {...})` to the test |
| `run_test` fails with "Session not open" | Call `session.open {id}` before `browser.run_test` |
| `run_test` fails with "no CDP port" | Session was opened before CDP support — close and reopen |
