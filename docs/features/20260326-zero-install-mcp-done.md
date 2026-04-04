# Feature: Zero-install MCP path

## Goal

Users who add szkrabok via `npx -y @pablovitasso/szkrabok` should be able to run
`browser_run_test` against their own Playwright specs without installing anything
extra — no `npm install @pablovitasso/szkrabok` required in their project.

Fixes: [bug2-runtime-import-in-mcp-mode.md](../bugs/bug2-runtime-import-in-mcp-mode.md)

---

## Solution: Option B — fixture restructure (connectOverCDP)

The static top-level runtime import in `fixtures.js` is the root cause. It is
replaced with two explicit paths:

- **MCP path** (`SZKRABOK_CDP_ENDPOINT` set by `browser_run_test`): use
  `chromium.connectOverCDP()` — no runtime import needed at all. Stealth is
  already applied at session launch time (`session_manage open`).
- **Standalone path** (no env var): dynamic `import('@pablovitasso/szkrabok/runtime')`
  with worker-scoped memoization. Fails with a clear "install required" message
  rather than a cryptic resolution error.

### Option F (shim injection) — tried and removed

`NODE_OPTIONS --import=<shim>` was implemented and then removed. Node ESM ignores
`NODE_PATH`, and `--import` preloads a module but does NOT intercept specifier
resolution — the shim exports under `file:///tmp/...shim.mjs`, not under the
`@pablovitasso/szkrabok/runtime` specifier. ESM has no `require.cache` to alias.
The fix was fundamentally the wrong tool for the problem.

---

## Changes delivered

### `src/tools/szkrabok_browser.js`

- Shim injection removed (was ineffective)
- `cwd: dirname(configPath)` instead of `cwd: REPO_ROOT` — allows external
  project configs (e.g. `sk-skills`) to use their own `node_modules` and
  playwright version. No regression for default usage (config in REPO_ROOT →
  `dirname(configPath) == REPO_ROOT`).

### `src/tools/templates/automation/fixtures.js`

- No static runtime import
- MCP path: `chromium.connectOverCDP(cdpEndpoint)`
- Standalone path: `await import('@pablovitasso/szkrabok/runtime')`
- `SZKRABOK_ATTACH_SIGNAL` write moved into MCP path teardown

### `tests/playwright/e2e/fixtures.js`

- Same restructure; uses `@szkrabok/runtime` (monorepo alias) in standalone path

### `sk-skills/automation/fixtures.js`

- Phase B applied to the companion project:
  `connectOverCDP` for MCP path, dynamic import for standalone
- `SESSIONMODE` check moved inside standalone branch only (not required for CDP path)

### `sk-skills/automation/example.spec.js`

- Updated to use `{ runtime }` fixture (what the fixture exposes)
- Works in both MCP mode (`browser_run_test`) and standalone
  (`SESSIONMODE=clone npx playwright test --project=example`)

### `sk-skills/playwright.config.js`

- Added `example` project (`testMatch: 'example.spec.js'`) as the smoke target

---

## Tests

### Regression tests (node) — `tests/node/scaffold.test.js`

Two tests added:
1. **Scaffolded fixtures.js has no static runtime import** — asserts
   `/^import\s+.*szkrabok.*runtime/m` does not match the generated file
2. **Scaffolded fixtures.js uses connectOverCDP** — asserts `connectOverCDP`
   is present in the generated file

### Architecture invariant — `tests/node/contracts.test.js`

Invariant 4 updated:
- `e2e/fixtures.js` must NOT have a static top-level runtime import
- Must reference `@szkrabok/runtime` via dynamic import only

### Smoke test — `tests/playwright/integration/scaffold-smoke.spec.js`

End-to-end MCP path test using the `sk-skills` companion project:
1. Open a headless session
2. Run `browser_run_test` targeting `sk-skills/playwright.config.js`, project `example`
3. Assert `passed > 0`, `failed === 0`

This proves `connectOverCDP` works end-to-end in a real user project without
relying on any synthetic isolation machinery.

---

## Definition of done

- [x] No static runtime import in `src/tools/templates/automation/fixtures.js`
- [x] No static runtime import in `tests/playwright/e2e/fixtures.js`
- [x] No static runtime import in `sk-skills/automation/fixtures.js`
- [x] Both fixture files use `connectOverCDP` in MCP path
- [x] Both fixture files use dynamic import with worker-scoped memoization in standalone path
- [x] 2 regression tests added to `scaffold.test.js`
- [x] Invariant 4 updated in `contracts.test.js`
- [x] `npm run test:node` green (72/72)
- [x] Smoke test passing (`scaffold-smoke.spec.js`)
- [x] Full integration suite: 13 pass, 1 skip, 1 pre-existing EX-2.1 failure
- [x] `sk-skills` adapted for new fixture structure
- [x] `cwd: dirname(configPath)` fix in `browser_run_test` subprocess spawn
