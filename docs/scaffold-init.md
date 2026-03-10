# scaffold.init — Design & Implementation Plan

## Problem

An LLM using szkrabok MCP tools has no way to discover that `browser.run_test`
and `browser.run_file` require a project scaffold to exist. The tools are
registered and callable, but they silently fail or produce confusing errors when
`playwright.config.js`, `@szkrabok/runtime`, or `szkrabok.config.toml` are
absent.

Real example: `ducatoelearn-portable` had `browser.run_test` in its allowed
permissions but never had anything to run it against — no config, no spec files,
no runtime dep. The tool appeared available; the scaffold was never created.

The LLM has no signal to infer "init first". Nothing in the tool signatures
says so.

---

## Root Cause Analysis

The MCP tool `description` field is the **only** LLM-facing interface for
capability discovery. The current `browser.run_test` description says:

> "IMPORTANT: session.open must be called first."

That covers session ordering. It says nothing about project structure. The gap:

| What LLM needs to know          | Currently communicated? |
|----------------------------------|-------------------------|
| session.open before run_test     | Yes (description)       |
| playwright.config.js must exist  | No                      |
| @szkrabok/runtime dep needed     | No                      |
| szkrabok.config.toml needed      | No                      |
| ESM ("type":"module") required   | No                      |
| How to create the scaffold       | No                      |

---

## Decisions

### Drop workflow.login and workflow.fillForm

`workflow.login` and `workflow.fillForm` are redundant with `browser.run_code`.
An LLM can fill a login form in two lines of Playwright JS via `run_code`, and
will reach for that when selectors need debugging anyway. These tools are removed.

### Keep workflow.scrape

`workflow.scrape` has no clean equivalent in `@playwright/mcp` without
`browser_evaluate`. It returns structured `{ key: [texts] }` — a useful shape
for LLM consumption without requiring arbitrary JS. Kept.

### scaffold.init — install opt-in

`scaffold.init` writes files by default. `npm install` is opt-in via
`install: true`. Default is fast and predictable; LLMs can follow up with Bash.

---

## Solution: `scaffold.init` Tool

Add a first-class MCP tool that the LLM can discover and call to bootstrap a
new project. Its existence in the tool list — with a clear description — is
itself the signal.

### Tool Signature

```
scaffold.init({
  dir?: string,         // target directory, defaults to cwd
  name?: string,        // package name, defaults to dirname
  preset?: "minimal" | "full",  // minimal = config only, full = + example spec
  install?: boolean     // run npm install after writing files, default false
})
```

Returns:
```json
{
  "created": ["playwright.config.js", "szkrabok.config.local.toml.example"],
  "skipped": ["package.json"],
  "installed": ["@playwright/test", "@szkrabok/runtime"],
  "warnings": []
}
```

### Description (the LLM-facing text)

```
[szkrabok] Initialize a new szkrabok project in a directory.
Creates playwright.config.js, szkrabok.config.local.toml.example, and
package.json with required deps. Call this once before using browser.run_test
or browser.run_file in a new project. Safe to call on an existing project —
skips files that already exist.
```

The phrase "Call this once before using browser.run_test or browser.run_file"
creates the correct mental model without requiring external docs.

---

## Files Created by scaffold.init

### `playwright.config.js`
```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './automation',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { headless: false },
});
```

### `package.json` (merge if exists, create if not)
```json
{
  "type": "module",
  "scripts": {
    "test": "playwright test"
  },
  "dependencies": {
    "@szkrabok/runtime": "latest",
    "@szkrabok/runtime": "latest"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.1"
  }
}
```

Key: `"type": "module"` — this is the ESM requirement that caught the
ducatoelearn project. The scaffold bakes it in.

### `szkrabok.config.local.toml.example`
Copy of the standard example. Signal to the LLM that this needs to be
configured for credentials and browser path.

### `automation/` directory
With preset `"full"`: creates `automation/example.spec.js` — a minimal
passing spec that the LLM can use as a template.

---

## Implementation Stages

All stages are independently testable. Each ends with a commit.

---

### Stage 1 — Drop workflow.login and workflow.fillForm

**Files changed:**
- `src/tools/workflow.js` — remove `login` and `fillForm` exports
- `src/tools/registry.js` — remove `workflow.login` and `workflow.fillForm` entries
- `tests/node/` — remove any tests covering the dropped tools

**Test:** Run node tests. Confirm `workflow.login` and `workflow.fillForm` no
longer appear in `registerTools()` output. Confirm `workflow.scrape` still works.

---

### Stage 2 — Add run_test preflight check

**Files changed:**
- `src/tools/szkrabok_browser.js` — at top of `run_test`, check for
  `playwright.config.js` before spawning subprocess

```js
import { existsSync } from 'node:fs';

const configPath = resolve(REPO_ROOT, args.config ?? 'playwright.config.js');
if (!existsSync(configPath)) {
  return {
    error: `playwright.config.js not found at ${configPath}`,
    hint: 'Run scaffold.init to create the project scaffold.',
  };
}
```

**Test:** Node test — call `run_test` with a non-existent config path, assert
structured error returned with `hint` field.

---

### Stage 3 — Update browser.run_test and browser.run_file descriptions

**Files changed:**
- `src/tools/registry.js` — append to both descriptions:
  > "Requires project scaffold — call scaffold.init first if playwright.config.js is absent."

**Test:** Run node schema tests. Confirm description strings contain "scaffold.init".

---

### Stage 4 — Implement scaffold.init

**Files changed:**
- `src/tools/scaffold.js` (new) — handler logic
- `src/tools/registry.js` — add `scaffold.init` entry

**Handler logic:**
1. Resolve `dir` (default: `process.cwd()`)
2. For each file, check existence — skip if present, write if not
3. `package.json`: read+merge if exists, preserving scripts/deps; write if not
4. If `preset === "full"`: write `automation/example.spec.js`
5. If `install === true`: spawn `npm install` in `dir`, catch failures as warnings
6. Return `{ created, skipped, installed, warnings }`

**Files written by the tool:**
- `playwright.config.js`
- `package.json` (merged)
- `szkrabok.config.local.toml.example`
- `automation/example.spec.js` (full preset only)

**Test:** `tests/node/scaffold.test.js` (new):
- scaffold.init in empty tmpdir creates expected files
- scaffold.init on existing project skips existing files
- created/skipped lists are correct
- package.json merge preserves existing keys

---

## Non-Goals

- Not a full project generator (no ESLint, Prettier, CI config)
- Not interactive / no prompts
- Does not install Chrome/Playwright browsers (`playwright install` is separate)
- Does not write `szkrabok.config.local.toml` — only the `.example` (credentials
  are never auto-generated)
