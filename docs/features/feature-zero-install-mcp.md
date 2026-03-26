# Plan: F + B — Runtime shim + fixture dynamic import

## Goal

Fix bug2 (runtime import fails in user projects using npx MCP) in two complementary phases:

- **Phase 0 — F:** Add runtime shim injection to `browser_run_test`. Safety net for all existing fixtures. Zero architectural change.
- **Phase 1 — B:** Restructure fixture templates to eliminate the static runtime import. MCP path becomes zero-dependency by design.

F fixes existing users. B fixes the template going forward. Together they make the "add MCP and go" story unconditionally true.

---

## Phase 0 — F: Runtime shim injection

### What changes

One file: `src/tools/szkrabok_browser.js`

At the top of the file, add shim generation helpers. In `browser_run_test`, inject the shim path into `NODE_OPTIONS` before spawning the Playwright subprocess.

### Implementation steps

**Step 1 — Add imports at top of `szkrabok_browser.js`**

Add `createRequire` from `node:module`, `writeFileSync` from `node:fs`, `tmpdir` from `node:os`, `randomUUID` from `node:crypto`. These are all Node built-ins, no new dependencies.

**Step 2 — Add `getRuntimeEntry()` — lazy, cached, silent-on-failure**

```js
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const _require = createRequire(import.meta.url);
let _runtimeEntry = null;

const getRuntimeEntry = () => {
  if (_runtimeEntry === null) {
    try {
      _runtimeEntry = _require.resolve('@pablovitasso/szkrabok/runtime');
    } catch {
      _runtimeEntry = false; // not resolvable — skip shim silently
    }
  }
  return _runtimeEntry || null;
};
```

The `false` sentinel means the resolve is only attempted once per process lifetime. If the MCP server was installed via npx, `resolve` will find the runtime in the same npx cache. If for any reason it fails, the shim is simply skipped — no error, no regression.

**Step 3 — Add `writeRuntimeShim()` — UUID filename, returns path or null**

```js
const writeRuntimeShim = () => {
  const entry = getRuntimeEntry();
  if (!entry) return null;
  const shimPath = join(tmpdir(), `szkrabok-runtime-${randomUUID()}.mjs`);
  writeFileSync(shimPath, `export * from ${JSON.stringify(entry)};\n`);
  return shimPath;
};
```

UUID in the filename prevents collisions when multiple `browser_run_test` calls run concurrently (e.g. multiple MCP tool calls, parallel sessions).

**Step 4 — Inject into subprocess env inside `browser_run_test`**

In the existing `env` block (after `SZKRABOK_CDP_ENDPOINT` is set, before `spawn`):

```js
const shimPath = writeRuntimeShim();

const env = {
  ...process.env,
  FORCE_COLOR: '0',
  SZKRABOK_SESSION: sessionName,
  PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
  SZKRABOK_CDP_ENDPOINT: `http://localhost:${session.cdpPort}`,
  NODE_OPTIONS: [
    process.env.NODE_OPTIONS,
    shimPath ? `--import=${shimPath}` : null,
  ].filter(Boolean).join(' '),
  ...Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k.toUpperCase(), String(v)])
  ),
};
```

Note: `NODE_OPTIONS` must be built before the `params` spread, or `params` could overwrite it. The filter+join pattern preserves any existing `NODE_OPTIONS` the user may have set.

**Step 5 — Add shim cleanup on process exit**

After writing the shim, register a one-time cleanup:

```js
if (shimPath) {
  process.once('exit', () => { try { unlinkSync(shimPath); } catch {} });
}
```

Add `unlinkSync` to the `fs` import. The `once` ensures each shim gets its own handler without accumulating listeners across calls.

### Tests to add — `tests/node/browser-run-test.test.js`

Current file only tests `waitForAttach`. Add a new section:

**Test 1 — `getRuntimeEntry` returns a string path when runtime is resolvable**

Import `getRuntimeEntry` (export it from `szkrabok_browser.js`). Assert the returned value is a non-empty string ending in `.js` or `.mjs`. This confirms the resolve works from within the project.

**Test 2 — `writeRuntimeShim` creates a valid ESM re-export file**

Call `writeRuntimeShim()`. Assert it returns a non-null path. Read the file. Assert it matches `/^export \* from ".+";$/m`. Assert the file exists on disk. Clean up manually.

**Test 3 — `writeRuntimeShim` returns null when runtime is not resolvable**

Temporarily monkey-patch `_require.resolve` to throw. Assert return value is `null`. Assert no file is created.

**Test 4 — concurrent calls produce unique shim paths**

Call `writeRuntimeShim()` twice. Assert the two paths are different strings. Clean up both.

**Test 5 — `NODE_OPTIONS` preserves existing value**

Assert that when `process.env.NODE_OPTIONS` is set to `--max-old-space-size=512`, the resulting env string contains both the existing value and `--import=...`.

> Note: `getRuntimeEntry` and `writeRuntimeShim` must be exported from `szkrabok_browser.js` for these tests. They are internal helpers — export as named exports, not part of the MCP tool surface.

---

## Phase 1 — B: Fixture template restructure

### What changes

Two fixture files:
- `src/tools/templates/automation/fixtures.js` — user-facing template (scaffolded by `scaffold_init`)
- `tests/playwright/e2e/fixtures.js` — project's own e2e fixture

Both get the same three-path structure. The static top-level import of the runtime is removed. Runtime is only imported dynamically when the code path that needs it is actually taken.

### Implementation steps

**Step 1 — Rewrite `src/tools/templates/automation/fixtures.js`**

Remove:
```js
import { initConfig, launch, connect } from '@pablovitasso/szkrabok/runtime';
```

Replace with three-path logic:

```js
import { test as base, chromium } from '@playwright/test';
import { writeFile } from 'fs/promises';

export { expect } from '@playwright/test';

const cdpEndpoint = process.env.SZKRABOK_CDP_ENDPOINT || '';

export const test = base.extend({
  _runtimeHandle: [
    async ({}, use) => {
      if (cdpEndpoint) {
        // Path MCP: plain CDP connect — no runtime import needed.
        // The MCP session browser already has stealth applied at launch time.
        const browser  = await chromium.connectOverCDP(cdpEndpoint);
        const contexts = browser.contexts();
        const context  = contexts[0] ?? await browser.newContext();
        await use({ browser, context });
        // Do NOT close — MCP session owns this browser.
        if (process.env.SZKRABOK_ATTACH_SIGNAL) {
          await writeFile(process.env.SZKRABOK_ATTACH_SIGNAL, '').catch(() => {});
        }
      } else {
        // Path standalone: stealth launch — requires @pablovitasso/szkrabok installed.
        // Install with: npm install @pablovitasso/szkrabok
        const { initConfig, launch } = await import('@pablovitasso/szkrabok/runtime');
        initConfig();
        const handle = await launch({ profile: 'dev', reuse: true });
        await use(handle);
        await handle.close();
      }
    },
    { scope: 'worker' },
  ],

  browser: [
    async ({ _runtimeHandle }, use) => {
      await use(_runtimeHandle.browser);
    },
    { scope: 'worker' },
  ],

  context: async ({ _runtimeHandle }, use) => {
    await use(_runtimeHandle.context);
    // Do NOT close — handle lifecycle manages it.
  },

  page: async ({ _runtimeHandle }, use) => {
    const ctx   = _runtimeHandle.context;
    const pages = ctx.pages();
    const pg    = pages[0] ?? (await ctx.newPage());
    await use(pg);
    // Do NOT close — MCP session or handle lifecycle manages it.
  },
});
```

Note the comment on the standalone path — it tells users exactly what to do without them needing to read docs.

**Step 2 — Rewrite `tests/playwright/e2e/fixtures.js`**

Same structure, but using `@szkrabok/runtime` (the monorepo alias) for standalone path, and `playwright/test` (the monorepo alias) instead of `@playwright/test`.

The MCP path uses `chromium.connectOverCDP(cdpEndpoint)` exactly as in the template — no runtime.

**Step 3 — Verify e2e tests still pass**

Run the e2e suite in both modes:
- MCP mode: `session_manage open` + `browser_run_test` — should exercise the CDP path
- Standalone: `PLAYWRIGHT_PROJECT=e2e npx playwright test` — should exercise the dynamic import path

### Tests to add/update

**`tests/node/scaffold.test.js` — add 2 tests**

**Test 1 — scaffolded `fixtures.js` has no static runtime import**

After `init({ dir, preset: 'full' })`, read `automation/fixtures.js`. Assert it does NOT contain the string `import {` combined with `@pablovitasso/szkrabok/runtime` on the same line (i.e. no static top-level import of runtime). This test will catch any future regression where someone adds the import back.

```js
test('scaffolded fixtures.js has no static runtime import', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir, preset: 'full' });
    const content = await readFile(join(dir, 'automation/fixtures.js'), 'utf8');
    const hasStaticImport = /^import\s+.*@pablovitasso\/szkrabok\/runtime/m.test(content);
    assert.ok(!hasStaticImport, 'fixtures.js must not have a static top-level runtime import');
  } finally {
    await rm(dir, { recursive: true });
  }
});
```

**Test 2 — scaffolded `fixtures.js` uses `connectOverCDP` in MCP path**

Assert the file contains `connectOverCDP` — confirms the MCP path uses plain Playwright, not the runtime wrapper.

```js
test('scaffolded fixtures.js uses connectOverCDP for MCP path', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir, preset: 'full' });
    const content = await readFile(join(dir, 'automation/fixtures.js'), 'utf8');
    assert.ok(content.includes('connectOverCDP'), 'MCP path must use connectOverCDP');
  } finally {
    await rm(dir, { recursive: true });
  }
});
```

**`tests/playwright/e2e/` — no new test files needed**

The existing e2e specs (`rebrowser-mcp.spec.js`, `navigator.spec.js`, etc.) run against the fixture and constitute the integration test for Phase 1. The fixture change is transparent to them — they only use `browser`, `context`, `page`. If they pass in MCP mode after the fixture rewrite, Phase 1 is correct.

---

## Sequencing and dependencies

```
Phase 0 (F)                    Phase 1 (B)
──────────────────────────────────────────────────────
szkrabok_browser.js            templates/fixtures.js
  + writeRuntimeShim()           static import → dynamic
  + NODE_OPTIONS injection       connectOverCDP in MCP path
  + cleanup on exit
                               tests/playwright/e2e/fixtures.js
tests/node/                      same restructure
  browser-run-test.test.js
  + 5 new unit tests           tests/node/scaffold.test.js
                                 + 2 regression tests
```

Phase 0 has no dependency on Phase 1 and can ship first. Phase 1 can start immediately after or in parallel — the two changes are in different files.

Phase 1 does not depend on Phase 0 being in place, but Phase 0 being in place means the dynamic import in the standalone path of Phase 1's fixture has a safety net (F's shim) for users who already have the package. Belt and suspenders.

---

## Definition of done

**Phase 0:**
- [ ] `writeRuntimeShim` and `getRuntimeEntry` implemented and exported
- [ ] `NODE_OPTIONS` injection in place in `browser_run_test`
- [ ] Shim cleanup registered on `process.exit`
- [ ] 5 unit tests passing in `tests/node/browser-run-test.test.js`
- [ ] Existing `waitForAttach` tests still pass
- [ ] `npm run test:node` green

**Phase 1:**
- [ ] `src/tools/templates/automation/fixtures.js` has no static runtime import
- [ ] `tests/playwright/e2e/fixtures.js` has no static runtime import
- [ ] Both use `connectOverCDP` in MCP path
- [ ] Both use dynamic import in standalone path
- [ ] 2 regression tests added to `scaffold.test.js`
- [ ] `npm run test:node` green
- [ ] e2e suite passes in MCP mode (`session_manage open` + `browser_run_test`)
