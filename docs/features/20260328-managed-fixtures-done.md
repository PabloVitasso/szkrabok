# Feature: Managed fixtures — `@pablovitasso/szkrabok/fixtures` export

**Status:** done (v1.1.6)
**Depends on:** scaffold staged-write (.new sidecar, already shipped)
**Fixes:** signalAttach signal never written from sk-skills (and structural root cause)

---

## Problem

`scaffold_init --preset full` copies `fixtures.js` into the project. From that point it is
**orphaned**: szkrabok can update its template but the project copy never changes.

This creates two distinct failure modes:

### Failure mode 1 — logic drift

When sk-skills extended `fixtures.js` with `RuntimeWrapper` support it diverged from the template.
The `SZKRABOK_ATTACH_SIGNAL` write was never carried over. Every `session_run_test` call returned a
spurious error even though the test passed.

### Failure mode 2 — hidden protocol coupling

`SZKRABOK_CDP_ENDPOINT`, `SESSIONMODE`, `SZKRABOK_ATTACH_SIGNAL` are:
- implicit (env vars, no schema)
- stringly-typed (names coupled across subprocess boundary and fixture code)
- scattered (read from `process.env` inside fixture, invisible in committed config)

The signal write was also non-atomic and silently failing. Moving the write into the package fixes
**location** but not **coupling** unless the write is hardened and the env var reads are
consolidated.

---

## Solution

### Part 1 — `./fixtures` export

Move the authoritative fixture implementation into a versioned export:

```
@pablovitasso/szkrabok/fixtures
```

`scaffold_init --preset full` writes a thin shim instead of a copy. Projects that need custom
fixtures extend on top. Signal protocol logic lives in the package and cannot drift.

### Part 2 — Signal write hardened and moved to attach time

`writeAttachSignal` is extracted as a named function: best-effort atomic (tmp→rename), fail-fast
(throws, no silent catch). Written **before** `await use(session)` — i.e., at the moment CDP
attach is confirmed, not at teardown. This is the correct semantic: the signal means "attached",
not "tests complete".

### Part 3 — Env vars bridged to Playwright options via fixture defaults

Fixture option defaults read subprocess env vars directly. `playwright.config.js` stays
user-only config — no transport boilerplate.

```
browser_run_test sets SZKRABOK_CDP_ENDPOINT → subprocess env
  → fixture option default reads process.env.SZKRABOK_CDP_ENDPOINT
    → fixture receives szkrabokCdpEndpoint as typed option
```

User-set values in `playwright.config.js` `use:` always override the env-var default
(standard Playwright option precedence). Debug logging of the resolved mode is available
via `DEBUG=szkrabok*`.

### Part 4 — Explicit configuration validation

A `resolveConfig()` step runs before session creation and rejects invalid option combinations
explicitly rather than allowing silent misbehaviour via implicit branching.

---

## API design

### Exports

```js
export { expect } from '@playwright/test';
export const test;   // Playwright Test instance pre-extended with szkrabok fixtures
```

### Fixture options

The three options below are **not equivalent** — they belong to different concern layers:

| Option | Category | Default | Set by |
|---|---|---|---|
| `szkrabokProfile` | execution policy | `'sessions/dev'` | user in `playwright.config.js` |
| `szkrabokSessionMode` | execution policy | `process.env.SESSIONMODE \|\| 'template'` | fixture default (env var), or user in `playwright.config.js` |
| `szkrabokCdpEndpoint` | transport config | `process.env.SZKRABOK_CDP_ENDPOINT \|\| ''` | fixture default (env var), or user in `playwright.config.js` |
| `szkrabokAttachSignal` | side-channel signal | `process.env.SZKRABOK_ATTACH_SIGNAL \|\| ''` | fixture default (env var), or user in `playwright.config.js` |

All are worker-scoped. Flat (not a single object option) because Playwright replaces object
options at the project level rather than deep-merging — flat options allow per-project overrides
of individual fields without repeating the others.

### Fixture surface

| Fixture | Scope | Description |
|---|---|---|
| `session` | worker | `{ browser, context, mode, ownsBrowser }` — the live session |
| `browser` | **worker** | Proxy to `session.browser` |
| `page` | test | First page of context, or new page |

`browser` is worker-scoped (matches Playwright's built-in scope). `context` is intentionally
**not** overridden — Playwright 1.55+ disallows changing the scope of built-in fixtures, and
`context` is built-in test-scoped. Use `session.context` directly when the session context is
needed. `page` routes through `session.context` and works correctly in both modes.

### Session contract

```js
type Session = {
  browser:     Browser,
  context:     BrowserContext,
  mode:        'cdp' | 'standalone',
  ownsBrowser: boolean,   // true = fixture must close; false = MCP session owns it
}
```

`ownsBrowser` makes close responsibility unambiguous. Extensions that need to branch on lifecycle
use `session.ownsBrowser`, not `session.mode === 'standalone'`. This decouples ownership semantics
from transport semantics.

### Extension contract

`session` is the stable extension point:

```js
export const test = szkrabokTest.extend({
  runtime: [async ({ session }, use, testInfo) => {
    const ctx  = session.context;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await use(new RuntimeWrapper(page, testInfo));
  }, { scope: 'test' }],
});
```

---

## Implementation

### `src/attach-signal.js` (new — extracted primitive)

Extracted so it can be imported and unit-tested without pulling in `@playwright/test`.

```js
import { writeFile, rename } from 'fs/promises';

// Best-effort atomic write: tmp → rename.
// rename() is atomic when source and dest are on the same filesystem (POSIX guarantee).
// Cross-filesystem moves (e.g. tmpfs → ext4) are NOT guaranteed atomic — this is a
// test coordination signal, not a durability guarantee. No fsync is issued.
// Throws on any write failure — no silent catch.
// No-op when path is empty or falsy.
export async function writeAttachSignal(path) {
  if (!path) return;
  const tmp = path + '.tmp';
  await writeFile(tmp, 'ok');
  await rename(tmp, path);
}
```

### `src/fixtures.js` (new)

```js
import { test as base, chromium } from '@playwright/test';
import { writeAttachSignal }       from './attach-signal.js';

export { expect } from '@playwright/test';

// ── Configuration validation ──────────────────────────────────────────────────
// Runs before session creation. Rejects invalid combinations explicitly.
function resolveConfig({ szkrabokCdpEndpoint, szkrabokSessionMode }) {
  const isCdp = !!szkrabokCdpEndpoint;

  if (isCdp && szkrabokSessionMode !== 'template') {
    // szkrabokSessionMode controls standalone launch behaviour (template vs clone).
    // In CDP mode the session is managed externally — the option has no effect and
    // a non-default value almost certainly indicates a misconfiguration.
    throw new Error(
      `szkrabokSessionMode "${szkrabokSessionMode}" is invalid in CDP mode — ` +
      `session lifecycle is managed externally. Remove szkrabokSessionMode or set it to "template".`
    );
  }

  return { mode: isCdp ? 'cdp' : 'standalone' };
}

// ── Session factories ─────────────────────────────────────────────────────────

async function createCdpSession(endpoint) {
  const browser  = await chromium.connectOverCDP(endpoint);
  const context  = browser.contexts()[0] ?? await browser.newContext();
  return { browser, context, mode: 'cdp', ownsBrowser: false };
}

async function createStandaloneSession(profile, sessionMode) {
  // Dynamic import: only evaluated in standalone mode. Fails with a clear
  // "package not installed" error rather than a cryptic resolution crash.
  const { initConfig, launch, launchClone } =
    await import('@pablovitasso/szkrabok/runtime');
  initConfig();

  if (sessionMode === 'template') {
    const handle = await launch({ profile, reuse: true });
    return { ...handle, mode: 'standalone', ownsBrowser: true };
  }
  if (sessionMode === 'clone') {
    const handle = await launchClone({ profile });
    return { ...handle, mode: 'standalone', ownsBrowser: true };
  }
  throw new Error(
    `Invalid szkrabokSessionMode: "${sessionMode}". Expected "template" or "clone".`
  );
}

// ── Fixture definition ────────────────────────────────────────────────────────

export const test = base.extend({

  szkrabokProfile:      ['sessions/dev',                                    { option: true, scope: 'worker' }],
  szkrabokCdpEndpoint:  [process.env.SZKRABOK_CDP_ENDPOINT  ?? '',          { option: true, scope: 'worker' }],
  szkrabokAttachSignal: [process.env.SZKRABOK_ATTACH_SIGNAL ?? '',          { option: true, scope: 'worker' }],
  szkrabokSessionMode:  [process.env.SESSIONMODE            ?? 'template',  { option: true, scope: 'worker' }],

  session: [async ({ szkrabokProfile, szkrabokCdpEndpoint, szkrabokAttachSignal, szkrabokSessionMode }, use) => {
    const { mode } = resolveConfig({ szkrabokCdpEndpoint, szkrabokSessionMode });

    let session;
    if (mode === 'cdp') {
      session = await createCdpSession(szkrabokCdpEndpoint);
      // Signal written HERE — at attach time, before tests start.
      // Semantically correct: the signal means "CDP attached", not "tests complete".
      await writeAttachSignal(szkrabokAttachSignal);
    } else {
      session = await createStandaloneSession(szkrabokProfile, szkrabokSessionMode);
    }

    await use(session);

    if (session.ownsBrowser) await session.browser.close();
    // CDP: do not close — MCP session owns this browser (ownsBrowser: false).
  }, { scope: 'worker' }],

  browser: [async ({ session }, use) => {
    await use(session.browser);
  }, { scope: 'worker' }],

  // context not overridden — Playwright 1.55+ disallows scope change of built-in test-scoped context.
  // Use session.context directly when needed.

  page: async ({ session }, use) => {
    const ctx  = session.context;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await use(page);
  },
});
```

### `package.json` — add `./fixtures` export and optional peer dep

```json
"exports": {
  ".":          "./src/index.js",
  "./runtime":  "./packages/runtime/index.js",
  "./fixtures": "./src/fixtures.js"
},
"peerDependencies": {
  "@playwright/test": ">=1.49.1"
},
"peerDependenciesMeta": {
  "@playwright/test": {
    "optional": true
  }
}
```

`@playwright/test` is absent from szkrabok's own `node_modules` (`playwright` and `@playwright/test`
are separate packages). `src/fixtures.js` resolves it from the consumer's `node_modules` at
runtime — which works because `full` preset projects have it via scaffold devDeps. Declared as an
optional peer dep so `minimal` users (who never import `./fixtures`) see no warning.

### `src/tools/templates/playwright.config.js` — user config only, no env bridging

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './automation',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/report.json' }]],
  use: {
    headless: false,
    szkrabokProfile: 'dev',
  },
});
```

Env var bridging (`SZKRABOK_CDP_ENDPOINT` → `szkrabokCdpEndpoint` etc.) is now handled by
fixture option defaults in `src/fixtures.js`. The config template only exposes what the user
should actually configure.

### `src/tools/templates/automation/fixtures.js` — becomes the shim

```js
/**
 * Szkrabok automation fixtures.
 *
 * Path A — MCP mode (browser_run_test): connects to the live session via CDP.
 * Path B — Standalone mode (npx playwright test): launches a stealth browser.
 *
 * To add project-specific fixtures, extend instead of re-exporting:
 *   import { test as szkrabokTest, expect } from '@pablovitasso/szkrabok/fixtures';
 *   export { expect };
 *   export const test = szkrabokTest.extend({ runtime: [...], ... });
 */
export { test, expect } from '@pablovitasso/szkrabok/fixtures';
```

### `sk-skills/automation/fixtures.js` — migrate to extend pattern

```js
import { test as szkrabokTest, expect } from '@pablovitasso/szkrabok/fixtures';
import { RuntimeWrapper }               from './runtime/RuntimeWrapper.js';

export { expect };

export const test = szkrabokTest.extend({
  runtime: [async ({ session }, use, testInfo) => {
    const ctx  = session.context;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await use(new RuntimeWrapper(page, testInfo));
  }, { scope: 'test' }],
});
```

---

## Phases and tests

### Phase A — `writeAttachSignal` primitive

**Files:** `src/attach-signal.js`

**Node test** (`tests/node/attach-signal.test.js`):

```js
import { writeAttachSignal } from '../../src/attach-signal.js';

test('writes signal file with content ok', async () => {
  const dir  = await mkdtemp(join(tmpdir(), 'signal-'));
  const path = join(dir, '.attach-signal');
  await writeAttachSignal(path);
  assert.equal(await readFile(path, 'utf8'), 'ok');
  assert.ok(!existsSync(path + '.tmp'), '.tmp must be cleaned up by rename');
  await rm(dir, { recursive: true });
});

test('is a no-op when path is empty or falsy', async () => {
  await assert.doesNotReject(() => writeAttachSignal(''));
  await assert.doesNotReject(() => writeAttachSignal(null));
});

test('throws on unwritable path (fail-fast)', async () => {
  await assert.rejects(() => writeAttachSignal('/nonexistent/dir/.signal'));
});
```

Same `mkdtemp` pattern as `scaffold.test.js` — no separate sandbox.

---

### Phase B — `src/fixtures.js` contracts

**Files:** `src/fixtures.js`, `package.json`

**Contracts test** (new `describe` block in `tests/node/contracts.test.js`):

```
Invariant N: src/fixtures.js
  — no static runtime import:    /^import\s+.*szkrabok.*runtime/m  absent
  — uses writeAttachSignal:       writeAttachSignal          present
  — no silent catch:              catch\(\(\) => \{\}\)      absent
  — has resolveConfig:            resolveConfig              present
  — has ownsBrowser:              ownsBrowser                present
  — signal written before use():  writeAttachSignal appears before  await use(session)  in source
  — browser worker-scoped: scope: 'worker' appears ≥ 2 times (session + browser); context NOT overridden (scope conflict)
  — option declarations:          szkrabokCdpEndpoint / szkrabokAttachSignal /
                                  szkrabokSessionMode  all present
```

All `readFile` + string/regex checks. The source-order check for signal-before-use is a line
number comparison on the raw source — crude but sufficient for a contract test.

**package.json peer dep check:**

```js
test('package.json declares @playwright/test as optional peer dep', async () => {
  const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.peerDependencies?.['@playwright/test'], 'peerDependencies entry missing');
  assert.ok(pkg.peerDependenciesMeta?.['@playwright/test']?.optional === true,
    'peerDependenciesMeta.optional must be true');
});
```

---

### Phase C — scaffold template assertions

**Files:** template `fixtures.js`, template `playwright.config.js`

**Scaffold test** (additions to `tests/node/scaffold.test.js`):

```js
test('scaffolded fixtures.js is the thin shim', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir, preset: 'full' });
    const src = await readFile(join(dir, 'automation/fixtures.js'), 'utf8');
    assert.ok(src.includes('@pablovitasso/szkrabok/fixtures'));
    assert.ok(!src.includes('connectOverCDP'));  // implementation lives in the package
    assert.ok(!src.includes('process.env'));     // no env reads in shim
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('scaffolded playwright.config.js bridges env vars to options', async () => {
  const dir = await makeTmp();
  try {
    await init({ dir });
    const src = await readFile(join(dir, 'playwright.config.js'), 'utf8');
    assert.ok(src.includes('szkrabokCdpEndpoint'));
    assert.ok(src.includes('szkrabokAttachSignal'));
    assert.ok(src.includes('szkrabokSessionMode'));
    assert.ok(src.includes('SZKRABOK_CDP_ENDPOINT'));
  } finally {
    await rm(dir, { recursive: true });
  }
});
```

---

### Phase D — sk-skills migration + smoke

**Files:** `sk-skills/automation/fixtures.js`

No new unit test needed. The existing smoke test (`tests/playwright/integration/scaffold-smoke.spec.js`)
runs `browser_run_test` against sk-skills and asserts `passed > 0, failed === 0`. It exercises the
full CDP path including `writeAttachSignal` at attach time. If the signal write is broken the smoke
test fails with the known error message — meaningful coverage without a synthetic fixture test.

Standalone path and real CDP timing are not covered by node tests and not worth a synthetic unit
test. If needed: e2e fixture test with a real browser. Deferred.

---

## Migration path for existing projects

1. User re-runs `scaffold_init` on an existing `full` project.
2. `fixtures.js` differs from shim → staged as `fixtures.js.new`.
3. `playwright.config.js` differs (new option keys) → staged as `playwright.config.js.new`.
4. User applies `playwright.config.js.new` (add the three option lines to `use:`).
5. User inspects `fixtures.js.new`: replace entirely (no custom fixtures), or migrate custom
   fixtures to `test.extend({ session })` pattern.

Both `.new` files are offered atomically on re-run. Applied independently.

---

## Known limitations

**File-based signaling is the wrong abstraction.** All improvements above optimize a mechanism
that should not exist. The correct primitive for inter-process coordination at attach time is a
named pipe, Unix socket, or similar IPC channel — not a file whose presence is polled. The current
design survives because `browser_run_test` checks for the signal file after the subprocess has
already exited, so timing is not actually critical. Any future requirement for true attach-time
lock release (releasing the `session_run_test` lock before tests complete) cannot be satisfied
by file polling without fundamental redesign. Noted here so this limitation is not obscured by
otherwise clean code.

**`writeAttachSignal` atomicity is best-effort.** `rename()` is atomic on POSIX when source and
destination are on the same filesystem. Cross-filesystem moves (e.g. tmpfs tmp → ext4 session
dir) degrade to a non-atomic copy+delete on some systems. No `fsync` is issued — the write is not
durable against a crash. Both are acceptable for a test coordination signal but must not be
mistaken for a persistence guarantee.

---

## What is NOT addressed

**`minimal` preset unchanged.** No `fixtures.js` written. `./fixtures` is unavailable without
local package install. Correct.

**User `params` env vars.** `browser_run_test` sets user params (e.g. `QUERY`, `LIMIT`) as
uppercased env vars. These are dynamic per-call and spec-specific — not option-izable. Stays
env-based intentionally.

---

## Definition of done

- [x] `src/attach-signal.js` — `writeAttachSignal`: best-effort atomic, fail-fast, no-op on empty
- [x] `src/fixtures.js` — `resolveConfig()` validates options; `session` fixture with `ownsBrowser`;
      signal written before `await use()`; `browser` worker-scoped; `context` not overridden (Playwright scope conflict); no `process.env` calls
- [x] `package.json` exports: `./fixtures` → `./src/fixtures.js`
- [x] `package.json` peer deps: `@playwright/test >=1.49.1` declared as optional peer dep
- [x] `src/tools/templates/automation/fixtures.js` → three-line shim
- [x] `src/tools/templates/playwright.config.js` → user config only (`szkrabokProfile`); env→option bridging in fixture defaults
- [x] `sk-skills/automation/fixtures.js` → extend pattern using `session`
- [x] `tests/node/attach-signal.test.js` — 3 tests (write, no-op, fail-fast)
- [x] `tests/node/contracts.test.js` — invariant for `src/fixtures.js` (resolveConfig, ownsBrowser,
      signal before use, worker scopes, no silent catch)
- [x] `tests/node/scaffold.test.js` — shim shape + config has `szkrabokProfile`, no env bridging
- [x] `npm run test:node` green
- [ ] Smoke test (`scaffold-smoke.spec.js`) passing — signalAttach end-to-end at attach time
- [x] `scaffold_init` re-run on existing `full` project stages both `.new` files
