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

Open a session first (MCP call or existing session):
```json
{"tool": "session.open", "args": {"id": "test-session"}}
```

Run all tests:
```json
{"tool": "browser.run_test", "args": {"id": "test-session"}}
```

Run filtered + parametrized:
```json
{
  "tool": "browser.run_test",
  "args": {
    "id": "test-session",
    "grep": "page title",
    "params": {
      "url": "https://example.com",
      "title": "Example"
    }
  }
}
```

Expected response:
```json
{
  "passed": 1,
  "failed": 0,
  "skipped": 0,
  "exitCode": 0,
  "tests": [
    {
      "title": "page title check",
      "status": "passed",
      "result": {
        "title": "Example Domain",
        "url": "https://example.com",
        "matched": "Example"
      }
    }
  ]
}
```

---

## Writing parametrized tests that return JSON

```typescript
// playwright-tests/tests/your-spec.ts
import { test, expect } from '@playwright/test';

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

If you log in via szkrabok MCP before running tests, the session cookies are available:

```
session.open("my-session") → browse + login → storageState.json written
browser.run_test {id: "my-session"} → tests start pre-authenticated
```

The `playwright-tests/teardown.ts` runs after every test suite and updates
`szkrabok.playwright.mcp.stealth/sessions/{id}/meta.json`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Executable doesn't exist` | `npx playwright install chromium` |
| `exports is not defined` | Ensure `playwright-tests/package.json` has `{"type":"commonjs"}` |
| Tests pick wrong config | Use `--config playwright-tests/playwright.config.ts` explicitly |
| No JSON result in output | Add `testInfo.attach('result', {...})` to the test |
