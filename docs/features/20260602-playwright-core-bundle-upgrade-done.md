# Feature: Upgrade playwright-core patch system for 1.60.0+ (coreBundle era)

## Goal

Upgrade `playwright-core` from `1.59.1` to `1.60.0` (and keep the weekly CI check
green going forward). The upgrade is blocked because 1.60.0 ships a completely
different file layout — the individual source files targeted by our patch script no
longer exist as separate `.js` files in the npm package.

## Background

### What changed in 1.60.0

Between `v1.59.1` (tagged `d466ac5`) and `v1.60.0` (tagged `87bb9dd`), Pavel Feldman
merged two PRs that collapsed all Playwright server-side code into a single esbuild
bundle:

| PR | Title | Date |
|----|-------|------|
| [#40057](https://github.com/microsoft/playwright/pull/40057) | chore: export coreBundle | 2026-04-06 |
| [#40074](https://github.com/microsoft/playwright/pull/40074) | chore: build coreBundle | 2026-04-07 |

**Before (1.59.1):** ~200+ individual `.js` files under `lib/server/`, `lib/client/`,
`lib/cli/`, `lib/generated/`.

**After (1.60.0):** A single `lib/coreBundle.js` (3.1 MB esbuild output) plus
`utilsBundle.js`, thin `lib/entry/` entry points, and `lib/tools/` (CLI client).

The npm tarball confirms: none of our 8 patched source files
(`crConnection.js`, `crDevTools.js`, `crPage.js`, `browserContext.js`,
`crServiceWorker.js`, `frames.js`, `page.js`, `generated/utilityScriptSource.js`)
exist in 1.60.0. The `postinstall` patch script immediately errors when it tries to
`copyFile` the first target.

**Source files still exist upstream.** The TypeScript sources are still in the
playwright GitHub repo at `v1.60.0` — they are just no longer compiled to individual
`.js` files for npm distribution. Only the build output changed.

### esbuild section headers — the reliable anchors

esbuild emits a comment before each compiled module. These appear at column 0 and use
the path prefix `// packages/playwright-core/src/`:

| Source path | Line in 1.60.0 |
|-------------|---------------|
| `src/generated/utilityScriptSource.ts` | 15579 |
| `src/server/frames.ts`                 | 17091 |
| `src/server/page.ts`                   | 19609 |
| `src/server/chromium/crConnection.ts`  | 33673 |
| `src/server/chromium/crPage.ts`        | 35764 |
| `src/server/chromium/crServiceWorker.ts` | 36744 |
| `src/server/chromium/crDevTools.ts`    | 41180 |
| `src/server/browserContext.ts`         | 46944 |

All 8 of our patch targets are present inside `coreBundle.js`.

> **Section boundary for splitting:** Use `\n// packages/playwright-core/src/` (not
> just `\n// packages/`) — the UtilityScript embedded source contains a
> `// packages/injected/src/utilityScript.ts` comment with a real newline that would
> otherwise create a false split.

### Breaking changes versus 1.59.1 — patch-by-patch

Every patch target has changed. Summary before the detailed plan:

| Patch | What changed |
|-------|-------------|
| crConnection — `__re__` inject | Class ends with `};` not `}`, `CDPSession` declared as assignment not keyword |
| crDevTools — `Runtime.enable` AST | Unchanged logic; `session2.send(...)` variable name only |
| crPage — Worker constructor callsite | `import_page.Worker` → `Worker`, `url` → `url2`, `session` available as `session2` |
| crPage — greasy brands | Moved out of `browserContext` entirely; inject into `_updateUserAgent()` here |
| crServiceWorker — `Runtime.enable` AST | Unchanged logic |
| frames — `executionContextsCleared` | `_onLifecycleEvent` renamed to `onLifecycleEvent` (underscore dropped) |
| frames — `_context()` rewire | Method renamed from `_context` to `context`; recursive call must match |
| page — Worker constructor | Added `onDisconnect` 3rd param; our `targetId`/`session` go 4th/5th |
| page — Worker `evaluateExpression` | Now takes `progress2` as first param; `js.evaluateExpression` → `evaluateExpression` |
| page — `PageBinding.dispatch` | Variable renamed `context` → `context2` |
| utilityScriptSource — UtilityScript rename | Embedded string still contains `var UtilityScript = class {`; same approach |

## Approach options

### Option A: Patch `coreBundle.js` directly (recommended)

Update `patch-playwright.js` to read and write `lib/coreBundle.js`. The existing Babel
AST approach and string-replace helpers work without modification — esbuild output is
readable, unminified JS. Add a `patchSection(src, path, fn)` helper that extracts the
substring between consecutive `// packages/playwright-core/src/` headers, applies the
transform, then stitches the result back. This prevents any patch from accidentally
matching the wrong class when the same pattern appears in multiple sections.

**Pros:** No build toolchain; same postinstall; existing AST transforms reusable;
single file instead of 8; section headers are stable across minor versions.

**Cons:** `patch-package` diff will cover the entire 3.1 MB file (kept as historical
snapshot only — the operational patch is already our custom script, not `patch-package`).
Concrete string anchors inside each section still drift with upstream refactors.

### Option B: Build from TypeScript source

Clone playwright at the release tag, patch the `.ts` source files, run
`npm run build`, replace `lib/coreBundle.js`. Pros: typed, readable patches. Cons:
heavyweight build dependency, minutes of build time, brittle build toolchain. Not
recommended.

## Chosen approach: Option A

Patch `coreBundle.js` directly.

---

## Implementation plan

### Step 1 — Bump versions

In `package.json` and `packages/runtime/package.json`:

```json
"playwright": "1.60.0",
"playwright-core": "1.60.0"
```

Exact pins, no `^`. Run `npm install --ignore-scripts`. Confirm both files still have
exact pins — npm sometimes re-adds `^` on install.

---

### Step 2 — Add `patchSection` helper to `patch-playwright.js`

Replace the per-file `backup / read / write` loop with a single-file flow on
`lib/coreBundle.js` plus a section-scoping helper.

```js
// Section headers emitted by esbuild for each compiled module.
// Use the full path prefix to avoid matching `packages/injected/` comments
// inside the embedded UtilityScript string.
const SECTIONS = {
  utilityScriptSource: 'packages/playwright-core/src/generated/utilityScriptSource.ts',
  frames:              'packages/playwright-core/src/server/frames.ts',
  page:                'packages/playwright-core/src/server/page.ts',
  crConnection:        'packages/playwright-core/src/server/chromium/crConnection.ts',
  crPage:              'packages/playwright-core/src/server/chromium/crPage.ts',
  crServiceWorker:     'packages/playwright-core/src/server/chromium/crServiceWorker.ts',
  crDevTools:          'packages/playwright-core/src/server/chromium/crDevTools.ts',
  browserContext:      'packages/playwright-core/src/server/browserContext.ts',
}

function extractSection(src, sectionPath) {
  const header = `// ${sectionPath}`
  const start = src.indexOf(header)
  if (start === -1)
    throw new Error(`[patch] Section not found: ${sectionPath}`)
  // Find the next playwright-core section boundary (column 0, full prefix)
  const boundary = '\n// packages/playwright-core/src/'
  const next = src.indexOf(boundary, start + header.length)
  const end = next === -1 ? src.length : next + 1
  return { before: src.slice(0, start), section: src.slice(start, end), after: src.slice(end) }
}

function patchSection(src, sectionPath, transform) {
  const { before, section, after } = extractSection(src, sectionPath)
  return before + transform(section, sectionPath) + after
}
```

The new `patches` array becomes a list of `{ name, section, steps }` applied to the
single `coreBundle.js` file. The outer loop no longer iterates over files — it
iterates over patches, each of which calls `patchSection` on an accumulator.

---

### Step 3 — Rewrite the 8 patch transforms

#### 3.1 — crConnection: inject `__re__` helpers

**Section:** `crConnection.ts`

The `CRSession` class in 1.60.0 ends as a class expression assignment (not a class
declaration), so the closing brace is followed by `};` then a new assignment:

1.59.1 anchor (no longer present):
```
    this._callbacks.clear();
  }
}
class CDPSession
```

1.60.0 anchor:
```
        this._callbacks.clear();
      }
    };
    CDPSession = class _CDPSession extends SdkObject {
```

Inject the `__re__emitExecutionContext` / `__re__getMainWorld` / `__re__getIsolatedWorld`
methods immediately before the `\n    };\n    CDPSession = class` boundary. The helpers
themselves are unchanged from 1.59.1.

#### 3.2 — crDevTools: suppress `Runtime.enable` (AST)

**Section:** `crDevTools.ts`

`Runtime.enable` appears at line 41224 inside a `Promise.all([...])`. The variable
name is `session2` (not `session` as in 1.59.1). The `astSuppressRuntimeEnable` Babel
transform scopes by argument value (`'Runtime.enable'`), not by variable name — no
change to the transform itself.

#### 3.3 — crPage: Worker constructor callsite

**Section:** `crPage.ts`

1.59.1 anchor:
```
const worker = new import_page.Worker(this._page, url);
```

1.60.0 anchor — the import namespace is gone (esbuild inlines), variable renamed:
```
const worker = new Worker(this._page, url2);
```

At this callsite `session2` is the active CDP session and
`event.targetInfo.targetId` is available. The `onDisconnect` parameter (new in 1.60.0)
is `undefined` for target-attached workers — pass it as `undefined` explicitly to keep
the argument positions clear.

Replacement:
```js
const worker = new Worker(this._page, url2, undefined, event.targetInfo.targetId, session2);
```

#### 3.4 — crPage: greasy brands (moved from browserContext)

**Section:** `crPage.ts`  
**Injected into:** `_updateUserAgent()` at line ~36607

In 1.59.1 the brands lived in `calculateUserAgentEmulation()` in `browserContext.js`.
In 1.60.0 `calculateUserAgentMetadata()` returns only device metadata
(mobile, platform, architecture) — no `brands`. Brands must be injected at the CDP
callsite in `_updateUserAgent()`.

1.60.0 anchor (full function):
```js
async _updateUserAgent() {
  const options2 = this._crPage._browserContext._options;
  await this._client.send("Emulation.setUserAgentOverride", {
    userAgent: options2.userAgent || "",
    acceptLanguage: options2.locale,
    userAgentMetadata: calculateUserAgentMetadata(options2)
  });
}
```

Replace with:
```js
async _updateUserAgent() {
  const options2 = this._crPage._browserContext._options;
  // ── szkrabok: greasy brands ──────────────────────────────────────────────
  const _uaMeta = calculateUserAgentMetadata(options2);
  const _chromeMatch = (options2.userAgent || '').match(/Chrome\/(\d+)/);
  if (_uaMeta && _chromeMatch) {
    const seed = parseInt(_chromeMatch[1], 10);
    const order = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]][seed % 6];
    const esc = [' ', ' ', ';'];
    const grease = `${esc[order[0]]}Not${esc[order[1]]}A${esc[order[2]]}Brand`;
    const _brands = [];
    _brands[order[0]] = { brand: grease, version: '99' };
    _brands[order[1]] = { brand: 'Chromium', version: String(seed) };
    _brands[order[2]] = { brand: 'Google Chrome', version: String(seed) };
    _uaMeta.brands = _brands;
  }
  // ── end szkrabok greasy brands ────────────────────────────────────────────
  await this._client.send("Emulation.setUserAgentOverride", {
    userAgent: options2.userAgent || "",
    acceptLanguage: options2.locale,
    userAgentMetadata: _uaMeta
  });
}
```

#### 3.5 — crServiceWorker: suppress `Runtime.enable` (AST)

**Section:** `crServiceWorker.ts`

One `Runtime.enable` call at line ~36791, wrapped in `.catch(() => {})`. The
`astSuppressRuntimeEnable` transform handles both the statement-level and
promise-array variants — no change needed.

#### 3.6 — frames: emit `executionContextsCleared` on commit

**Section:** `frames.ts`

The lifecycle method was renamed: `_onLifecycleEvent` → `onLifecycleEvent` (no
underscore in 1.60.0 esbuild output).

1.59.1 anchor:
```
    this._page.mainFrame()._recalculateNetworkIdle(this);
    this._onLifecycleEvent("commit");
  }
```

1.60.0 anchor:
```
        this._page.mainFrame()._recalculateNetworkIdle(this);
        this.onLifecycleEvent("commit");
      }
```

Inject `crSession` emission after the lifecycle call (same logic, different indentation):

```js
        this._page.mainFrame()._recalculateNetworkIdle(this);
        this.onLifecycleEvent("commit");
        const crSession = (this._page.delegate._sessions?.get(this._id) || this._page.delegate._mainFrameSession)?._client
        if (crSession) crSession.emit('Runtime.executionContextsCleared')
      }
```

> `_sessions` (Map) and `_mainFrameSession` (FrameSession) are confirmed present in
> the crPage section of 1.60.0 — the delegate reference is unchanged.

#### 3.7 — frames: rewire `context()` to use `__re__emitExecutionContext`

**Section:** `frames.ts`

The method was renamed from `_context(world)` to `context(world)` (underscore dropped).
The recursive call inside the rewired method must also use `context` (not `_context`).

1.60.0 anchor:
```js
context(world) {
  return this._contextData.get(world).contextPromise.then((contextOrDestroyedReason) => {
    if (contextOrDestroyedReason instanceof ExecutionContext)
      return contextOrDestroyedReason;
    throw new Error(contextOrDestroyedReason.destroyedReason);
  });
}
```

Replace with (same rebrowser logic, method name and recursive call updated):
```js
context(world, useContextPromise = false) {
  if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] === '0' || this._contextData.get(world).context || useContextPromise) {
    return this._contextData.get(world).contextPromise.then((contextOrDestroyedReason) => {
      if (contextOrDestroyedReason instanceof ExecutionContext)
        return contextOrDestroyedReason;
      throw new Error(contextOrDestroyedReason.destroyedReason);
    });
  }
  const crSession = (this._page.delegate._sessions?.get(this._id) || this._page.delegate._mainFrameSession)?._client
  return crSession.__re__emitExecutionContext({ world, targetId: this._id, frame: this, utilityWorldName: this._page.delegate?.utilityWorldName })
    .then(() => this.context(world, true))
    .catch(error => {
      if (error.message.includes('No frame for given id found'))
        return { destroyedReason: 'Frame was detached' }
      console.error('[rebrowser-patches][frames.context] error:', error)
    })
}
```

#### 3.8 — page: Worker constructor — add `targetId` and `session` params

**Section:** `page.ts`

In 1.60.0 the Worker constructor already has a third param `onDisconnect`. Our
`targetId` and `session` go in 4th and 5th position.

1.60.0 anchor:
```js
constructor(parent, url2, onDisconnect) {
  super(parent, "worker");
  this._executionContextPromise = new ManualPromise();
  this._workerScriptLoaded = false;
  this.existingExecutionContext = null;
  this.openScope = new LongStandingScope();
  this.attribution.worker = this;
  this.url = url2;
  this._onDisconnect = onDisconnect;
}
```

Replace with:
```js
constructor(parent, url2, onDisconnect, targetId, session) {
  super(parent, "worker");
  this._executionContextPromise = new ManualPromise();
  this._workerScriptLoaded = false;
  this.existingExecutionContext = null;
  this.openScope = new LongStandingScope();
  this.attribution.worker = this;
  this.url = url2;
  this._onDisconnect = onDisconnect;
  this._targetId = targetId;
  this._session = session;
}
```

#### 3.9 — page: Worker `evaluateExpression` — use `getExecutionContext()`

**Section:** `page.ts`

In 1.60.0 `evaluateExpression` and `evaluateExpressionHandle` take a leading `progress2`
argument and call the free function `evaluateExpression` (not `js.evaluateExpression`).

1.60.0 anchor (two methods in sequence):
```js
async evaluateExpression(progress2, expression2, isFunction2, arg) {
  return progress2.race(evaluateExpression(await this._executionContextPromise, expression2, { returnByValue: true, isFunction: isFunction2 }, arg));
}
async evaluateExpressionHandle(progress2, expression2, isFunction2, arg) {
  return progress2.race(evaluateExpression(await this._executionContextPromise, expression2, { returnByValue: false, isFunction: isFunction2 }, arg));
}
```

Replace with (insert `getExecutionContext()`, update promise reference):
```js
async getExecutionContext() {
  if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] !== '0' && !this.existingExecutionContext) {
    await this._session.__re__emitExecutionContext({ world: 'main', targetId: this._targetId })
  }
  return this._executionContextPromise
}
async evaluateExpression(progress2, expression2, isFunction2, arg) {
  return progress2.race(evaluateExpression(await this.getExecutionContext(), expression2, { returnByValue: true, isFunction: isFunction2 }, arg));
}
async evaluateExpressionHandle(progress2, expression2, isFunction2, arg) {
  return progress2.race(evaluateExpression(await this.getExecutionContext(), expression2, { returnByValue: false, isFunction: isFunction2 }, arg));
}
```

#### 3.10 — page: `PageBinding.dispatch` — guard non-JSON payloads

**Section:** `page.ts`

Variable renamed from `context` to `context2` in 1.60.0.

1.60.0 anchor:
```js
static async dispatch(page, payload, context2) {
  const { name, seq, serializedArgs } = JSON.parse(payload);
```

Replace with:
```js
static async dispatch(page, payload, context2) {
  if (process.env['REBROWSER_PATCHES_RUNTIME_FIX_MODE'] !== '0' && !payload.includes('{')) return;
  const { name, seq, serializedArgs } = JSON.parse(payload);
```

#### 3.11 — utilityScriptSource: rename `UtilityScript` class

**Section:** `utilityScriptSource.ts`

The UtilityScript bundle is inlined as a string literal inside `coreBundle.js`. The
string uses real newline characters (template literal), not `\n` escape sequences.
String-replace still works on raw file content.

Two replacements (same as 1.59.1, same anchor strings, just scoped to the
`utilityScriptSource.ts` section of the bundle):

```
'var UtilityScript = class {'       →  'var __pwUs = class {'
'UtilityScript: () => UtilityScript' →  'UtilityScript: () => __pwUs'
```

---

### Step 4 — Update `PATCH_MARKERS`

Change both markers to reference `coreBundle.js`:

```js
const PATCH_MARKERS = [
  { file: 'coreBundle.js', marker: '__re__emitExecutionContext' },
  { file: 'coreBundle.js', marker: 'szkrabok: greasy brands'   },
]
const STAMP_FILE = '.szkrabok-patched'
```

The `isAlreadyPatched` check reads the two markers from the single file.

---

### Step 5 — Update `scripts/verify-playwright-patches.js`

Replace the 7-entry `PATCHES` array with entries all pointing at `coreBundle.js`:

```js
const PATCHES = [
  { file: 'lib/coreBundle.js', marker: '__re__emitExecutionContext' },
  { file: 'lib/coreBundle.js', marker: 'szkrabok: greasy brands'   },
  { file: 'lib/coreBundle.js', marker: 'getExecutionContext'        },
  { file: 'lib/coreBundle.js', marker: 'var __pwUs = class'         },
  { file: 'lib/coreBundle.js', marker: 'REBROWSER_PATCHES_RUNTIME_FIX_MODE' },
]
```

5 distinct markers are sufficient; 3 of the old 7 entries were redundant aliases of
`REBROWSER_PATCHES_RUNTIME_FIX_MODE`.

---

### Step 6 — Update `tests/node/playwright-patches.test.js`

Change each test's `file` path to `lib/coreBundle.js`. Replace the 7 per-file tests
with 5 marker-based tests matching the new verify script:

```js
const PATCHES = [
  { file: 'lib/coreBundle.js', marker: '__re__emitExecutionContext' },
  { file: 'lib/coreBundle.js', marker: 'szkrabok: greasy brands'   },
  { file: 'lib/coreBundle.js', marker: 'getExecutionContext'        },
  { file: 'lib/coreBundle.js', marker: 'var __pwUs = class'         },
  { file: 'lib/coreBundle.js', marker: 'REBROWSER_PATCHES_RUNTIME_FIX_MODE' },
]
```

Test description strings should change from `playwright-core patch applied: lib/server/...`
to `playwright-core patch applied: lib/coreBundle.js — <marker>`.

---

### Step 7 — Full verification sequence

```bash
# 1. Clean install at 1.60.0 without scripts
rm -rf node_modules/playwright-core
npm install playwright-core --ignore-scripts

# 2. Apply patches
node packages/runtime/scripts/patch-playwright.js
# Expected: "Applying 8 patch entries ... All patches applied."

# 3. Verify markers
node scripts/verify-playwright-patches.js
# Expected: 5× PASS

# 4. Node patch tests
node --test tests/node/playwright-patches.test.js
# Expected: 5 passing

# 5. Full node test suite
node --test tests/node/*.test.js

# 6. Integration tests (requires open session — run MCP first)
npm run test:self
```

---

### Step 8 — Regenerate `patches/playwright-core+1.60.0.patch`

```bash
npx patch-package playwright-core
```

The diff will cover the full 3.1 MB `coreBundle.js`. This is expected. The file is
kept as a historical snapshot and for diffing between versions, not for replay.

---

### Step 9 — Update `docs/development.md`

In the "Upgrading playwright-core" section:

- Replace the 8-row patch locations table with the single `lib/coreBundle.js` entry
- Document the `patchSection` helper and section-header boundary convention
- Add a note about the greasy brands anchor change (`calculateUserAgentEmulation` →
  `_updateUserAgent` in crPage)
- Update "Patch locations" for 1.60.0 (single file, section-scoped transforms)
- Confirm the upgrade checklist steps are otherwise unchanged

---

### Step 10 — Commit

```bash
git add package.json packages/runtime/package.json package-lock.json \
  patches/playwright-core+1.60.0.patch \
  packages/runtime/scripts/patch-playwright.js \
  scripts/verify-playwright-patches.js \
  tests/node/playwright-patches.test.js \
  docs/development.md
git commit -m "chore: upgrade playwright-core to 1.60.0 (coreBundle patch)"
```

Old patch files (`playwright-core+1.58.2.patch`, `playwright-core+1.59.1.patch`) are
kept as historical record.

---

## Definition of done

### Version bump
- [ ] `package.json` and `packages/runtime/package.json` both pin `playwright` and
      `playwright-core` to `1.60.0` — exact, no `^`
- [ ] `package-lock.json` updated

### Patch script
- [ ] `patch-playwright.js` reads/writes `lib/coreBundle.js` only
- [ ] `patchSection(src, sectionPath, fn)` helper scopes each transform to the correct
      module using `// packages/playwright-core/src/` boundary
- [ ] Patch 3.1: crConnection `__re__` injection uses updated `};` / assignment anchor
- [ ] Patch 3.3: crPage Worker callsite uses `Worker(this._page, url2, undefined, ...)` anchor
- [ ] Patch 3.4: greasy brands injected in `_updateUserAgent()` in crPage section
- [ ] Patch 3.6: frames lifecycle uses `onLifecycleEvent` (no underscore) anchor
- [ ] Patch 3.7: frames `context(world)` rewrite uses `context` (no underscore) and
      recursive call is `this.context(world, true)`
- [ ] Patch 3.8: Worker constructor appends `targetId`/`session` after `onDisconnect`
- [ ] Patch 3.9: Worker `evaluateExpression` uses `progress2` signature + `getExecutionContext()`
- [ ] Patch 3.10: `PageBinding.dispatch` uses `context2` anchor
- [ ] Script exits 0: `node packages/runtime/scripts/patch-playwright.js`

### Verify script
- [ ] `scripts/verify-playwright-patches.js` — 5 markers, all `PASS`, targeting `coreBundle.js`

### Tests
- [ ] `node --test tests/node/playwright-patches.test.js` — 5 tests pass
- [ ] `node --test tests/node/*.test.js` — green
- [ ] `npm run test:self` — green (lint + integration + node)

### Patch file
- [ ] `patches/playwright-core+1.60.0.patch` committed

### CI
- [ ] Weekly "Check playwright-core upgrade" workflow passes on the branch

### Docs
- [ ] `docs/development.md` patch locations table updated for single-file `coreBundle.js`

---

## Notes on future upgrades

Once the patch system targets `coreBundle.js`, the upgrade procedure from
`docs/development.md` applies with one change: **only `coreBundle.js` needs
inspection**, not 8 separate files. The section-header anchors
(`// packages/playwright-core/src/...`) are the most stable reference — look there
first when a concrete string anchor breaks.

If esbuild ever stops emitting source file comments, the anchors disappear. The
fallback is to use unique surrounding identifiers in the compiled output. Watch for
this if a future version silently drops section headers.

The weekly CI check will alarm whenever `npm view playwright-core version` exceeds the
pinned version. The upgrade checklist in `docs/development.md` remains authoritative.
