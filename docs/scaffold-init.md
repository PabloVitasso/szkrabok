# scaffold.init

## Contents

- [Problem](#problem)
- [Tool signature](#tool-signature)
- [Presets](#presets)
- [Two spec patterns](#two-spec-patterns)
- [Templates](#templates)
- [Non-goals](#non-goals)

---

## Problem

An LLM using szkrabok MCP tools has no way to discover that `browser.run_test`
and `browser_run` (path mode) require a project scaffold. The tools appear available
but fail with confusing errors when `playwright.config.js`, `@szkrabok/runtime`,
or `szkrabok.config.toml` are absent.

`scaffold.init` solves this by being discoverable in the tool list with a
description that explicitly says "call this first".

---

## Tool signature

```
scaffold.init({
  dir?: string,                    // target directory, defaults to cwd
  name?: string,                   // package name, defaults to dirname
  preset?: "minimal" | "full",     // see Presets below
  install?: boolean                // run npm install after writing files, default false
})
```

Returns:
```json
{
  "created": ["playwright.config.js", "automation/fixtures.js", ...],
  "skipped": ["package.json"],
  "merged": ["package.json"],
  "installed": [],
  "warnings": []
}
```

Idempotent — safe to re-run on an existing project. Existing files are skipped,
not overwritten.

---

## Presets

### `minimal` (default)

Config scaffold only. Use when you want to set up the project structure before
writing your own automation code.

Files created:

| File | Purpose |
|------|---------|
| `playwright.config.js` | Playwright config pointing at `./automation`, workers=1, headless=false |
| `package.json` | Merged — adds `@szkrabok/runtime`, `@playwright/test`, sets `"type":"module"` |
| `szkrabok.config.local.toml.example` | Template for machine-specific config (Chrome path, UA, log level) |

### `full`

Everything in `minimal` plus a complete automation scaffold — two spec patterns
and the shared fixture. Use when starting a new automation project from scratch.

Additional files created:

| File | Purpose |
|------|---------|
| `automation/fixtures.js` | Dual-mode Playwright fixture: Path A connects to MCP session via CDP (`SZKRABOK_CDP_ENDPOINT`), Path B launches standalone with stealth. Import `{ test, expect }` from this in your specs. |
| `automation/example.spec.js` | Direct spec. Runs inside the MCP session browser via `browser.run_test`, or standalone via `npx playwright test`. Uses `fixtures.js`. |
| `automation/example.mcp.spec.js` | MCP harness spec. Owns the full session lifecycle — opens a session via `mcpConnect`, calls `mcp.browser.run_test` to run inner specs, then closes. Use this pattern for CI, multi-step flows, or asserting on structured `attachResult()` data from inner tests. |

---

## Two spec patterns

```
                                             ┌──────────────────────┐
  session_manage(open) ► browser.run_test ──►│ example.spec.js      │
                                             │ (direct CDP spec)    │
                                             └──────────────────────┘

  npx playwright test ──────────────────────►│ example.mcp.spec.js  │
                                             │ (MCP harness)        │
                                             │  mcpConnect()        │
                                             │  └► session_manage   │
                                             │  └► browser.run_test ├──► example.spec.js
                                             │  └► session_manage   │
                                             └──────────────────────┘
```

**Direct spec (`example.spec.js`):**
- Receives an already-open browser via `SZKRABOK_CDP_ENDPOINT`
- No session management — the MCP caller owns open/close
- Also runnable standalone (Path B in fixtures.js launches its own browser)

**MCP harness (`example.mcp.spec.js`):**
- Outer Playwright spec that drives inner specs through MCP
- Owns the session: `mcpConnect` → `run_test` → `mcp.close()`
- Gets structured results back — assert on `result.passed`, `result.tests[n].result`
- Use for CI pipelines, multi-step automation, or when the outer spec needs to act on what the inner spec found

---

## Templates

All files written by `scaffold.init` come from `src/tools/templates/`. To
customise the scaffold for your project, edit the templates directly — the tool
reads them at runtime.

```
src/tools/templates/
  playwright.config.js
  szkrabok.config.local.toml.example
  automation/
    fixtures.js
    example.spec.js
    example.mcp.spec.js
```

---

## Non-goals

- Not a full project generator (no ESLint, Prettier, CI config)
- Not interactive / no prompts
- Does not install Chrome/Playwright browsers (`playwright install` is separate)
- Does not write `szkrabok.config.local.toml` — only the `.example` (credentials are never auto-generated)
