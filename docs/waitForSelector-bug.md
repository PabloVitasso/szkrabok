# waitForSelector broken by rebrowser patches — investigation

## Status
Root cause identified. Fix designed. Not yet applied.

---

## Symptom

`page.waitForSelector(selector)` times out on every page (confirmed on example.com).
`page.waitForFunction(fn)` works fine (main world).
MCP snapshot/click tools — same risk (same code path).

Test: `automation/waitselector-probe.spec.js` — fails with 5s timeout on `h1` from example.com.
Workaround applied in `automation/intoli-check.spec.js`: replaced `waitForSelector` with `waitForFunction`.

---

## Root cause

### The hardcoded name bug in patch #1 / crConnection.js

`waitForSelector` operates in the **utility world** execution context.
Playwright registers a context as the utility world by checking:

```js
// crPage.js:543
else if (contextPayload.name === this._crPage.utilityWorldName)
    worldName = "utility";
```

where:

```js
// crPage.js:72
this.utilityWorldName = `__playwright_utility_world_${this._page.guid}`;
```

The name is **per-page** (includes the page GUID, e.g. `__playwright_utility_world_page@abc123`).

Our patch in `crConnection.js` (`__re__emitExecutionContext`) emits the context event with:

```js
// crConnection.js patch — WRONG
.then(contextId => ({ id: contextId, name: '__playwright_utility_world__', ... }))
```

This hardcoded name never matches `utilityWorldName` → the context is never bound to
the `'utility'` world → `contextData.get('utility').contextPromise` never resolves →
`waitForSelector` (and anything else in utility world) hangs forever.

The main world works because its contextPayload has `auxData.isDefault: true`,
which is matched on `isDefault` not on name — so the main world is unaffected.

---

## The fix

In `__re__emitExecutionContext` (crConnection.js patch), the utility world name in the
emitted contextPayload must be the **actual** `utilityWorldName` from the CRPage instance.

`__re__emitExecutionContext` receives `frame` as a parameter when called from `Frame._context()`.
From `frame` we can reach: `frame._page.delegate.utilityWorldName`.

### Change needed — two patches

#### Preferred approach: pass utilityWorldName explicitly via parameter

Rather than having `crConnection.js` reach into CRPage internals
(`frame._page.delegate.utilityWorldName`), pass the value from `frames.js`
which is already coupled to the page/frame internals. This limits breakage
surface: only `frames.js` needs updating if the property moves upstream.

**Patch #5b (frames.js) — `_context()` override: add `utilityWorldName` param:**

```js
// BEFORE
crSession.__re__emitExecutionContext({ world, targetId: this._id, frame: this })

// AFTER
crSession.__re__emitExecutionContext({
  world,
  targetId: this._id,
  frame: this,
  utilityWorldName: this._page.delegate?.utilityWorldName,
})
```

**Patch #1 (crConnection.js) — `__re__emitExecutionContext`: accept + use param:**

```js
// BEFORE — hardcoded, never matches per-page GUID name
async __re__emitExecutionContext({ world, targetId, frame = null }) {
  ...
  .then(contextId => ({ id: contextId, name: '__playwright_utility_world__', ... }))

// AFTER — receives name from caller, no internal CRPage knowledge needed
// Note: parameter renamed to callerUtilityWorldName to avoid shadowing the
// const utilityWorldName already declared in the function body (env-var derived).
async __re__emitExecutionContext({ world, targetId, frame = null, utilityWorldName: callerUtilityWorldName }) {
  ...
  .then(contextId => ({ id: contextId, name: callerUtilityWorldName || '__playwright_utility_world__', ... }))
```

Fallback `'__playwright_utility_world__'` covers the worker case (no frame → no utilityWorldName).

#### Why not access frame._page.delegate.utilityWorldName inside crConnection.js?

That would add a cross-module coupling: `crConnection.js` would need to know
CRPage's internal property name. If either the `delegate` accessor or
`utilityWorldName` moves, two files break. With the explicit-parameter approach,
only `frames.js` breaks — one fewer coupling point per upstream merge.

### Also: worldName for Page.createIsolatedWorld

The `worldName` passed to `Page.createIsolatedWorld` in `__re__getIsolatedWorld` is
separate from the contextPayload name — it's a DevTools label only. It can stay as `'util'`
(controlled by `REBROWSER_PATCHES_UTILITY_WORLD_NAME`). This does not need to change.

---

## Secondary question: which patch introduced the break?

All 7 patches together cause this. The break requires both:
- Patch #3 (crPage.js) — suppresses `Runtime.enable` so no automatic context events fire
- Patch #5b (frames.js) — rewires `_context()` to call `__re__emitExecutionContext`
- Patch #1 (crConnection.js) — `__re__emitExecutionContext` emits with wrong name

Individually:
- Without patch #3: `Runtime.enable` fires → Chromium sends real `executionContextCreated` events
  with correct names → utility world is registered normally → no bug
- Patches #1 + #5b alone (with Runtime.enable still running): no effect, contexts come from CDP

The wrong name has always been there; it only matters because Runtime.enable is suppressed.

To isolate which of patches 1/5b introduces the final break:
- The wrong name is in patch #1 (crConnection.js).
- The code path that calls `__re__emitExecutionContext` for utility world is in patch #5b (frames.js).
- Both are needed to reproduce.

---

## Files to change

| File | Change |
|---|---|
| `scripts/patch-playwright.js` | Fix the utility contextPayload name in patch #1 (crConnection.js injection) |
| `node_modules/playwright-core/lib/server/chromium/crConnection.js` | Re-patch (or re-run script) |
| `node_modules/playwright/node_modules/playwright-core/lib/server/chromium/crConnection.js` | Same |
| `automation/intoli-check.spec.js` | Revert `waitForFunction` back to `waitForSelector` after fix confirmed |
| `automation/waitselector-probe.spec.js` | Delete (temp probe file) |

---

## How to apply fix

```bash
# 1. Delete both playwright-core installs so patcher can re-run cleanly
rm -rf node_modules/playwright-core node_modules/playwright/node_modules/playwright-core

# 2. Edit scripts/patch-playwright.js — fix the utility name line (see above)

# 3. Reinstall and re-patch
npm install --ignore-scripts
node scripts/patch-playwright.js

# 4. Restart MCP server: /mcp -> restart szkrabok

# 5. Run probe test
# session.open { "id": "intoli" }
# browser.run_test { "id": "intoli", "grep": "waitForSelector-probe" }

# 6. If probe passes, revert intoli-check.spec.js waitForSelector change,
#    delete waitselector-probe.spec.js, run full test suite
```

---

## Playwright source references

- `crPage.js:72` — `utilityWorldName = '__playwright_utility_world_' + page.guid`
- `crPage.js:543` — match logic: `contextPayload.name === this._crPage.utilityWorldName`
- `crPage.js:341` — event listener: `Runtime.executionContextCreated` → `_onExecutionContextCreated`
- `frames.js:_context()` — patched to call `__re__emitExecutionContext` lazily
- `crConnection.js:__re__emitExecutionContext` — emits `Runtime.executionContextCreated` with wrong name

Context7 library: `/microsoft/playwright` (v1.58.2)
