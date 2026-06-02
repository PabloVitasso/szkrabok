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

**After (1.60.0):** A single `lib/coreBundle.js` (3.1 MB esbuild output) + `utilsBundle.js`
+ thin `lib/entry/` entry points + `lib/tools/` (CLI client).

The npm tarball confirms: none of our 8 patched source files
(`crConnection.js`, `crDevTools.js`, `crPage.js`, `browserContext.js`,
`crServiceWorker.js`, `frames.js`, `page.js`, `generated/utilityScriptSource.js`)
exist in 1.60.0. The `postinstall` patch script immediately errors when it tries to
`copyFile` the first target to `.bak`.

**Source files still exist upstream.** The TypeScript sources
(`packages/playwright-core/src/server/chromium/crConnection.ts`, etc.) are still in
the playwright GitHub repo at `v1.60.0` — they are just not compiled to individual
`.js` files for npm distribution anymore.

### One API name change: greasy brands injection point

In 1.59.1, our greasy brands patch targeted `calculateUserAgentEmulation()` in
`browserContext.js`, which returned `{ navigatorPlatform, userAgentMetadata }` — the
`userAgentMetadata.brands` array that we injected into.

In 1.60.0, this function was renamed and refactored to `calculateUserAgentMetadata()`.
It now returns only `{ mobile, model, architecture, platform, platformVersion }` —
**no `brands` field**. Chromium infers brands from the UA string when they are absent.
The injection must move to `_updateUserAgent()` in crPage, which calls
`Emulation.setUserAgentOverride` with the metadata.

### Source file headers are preserved in the bundle

esbuild emits a comment before each compiled module:

```
// packages/playwright-core/src/server/chromium/crConnection.ts
// packages/playwright-core/src/server/frames.ts
// packages/playwright-core/src/server/page.ts
// packages/playwright-core/src/server/browserContext.ts
// packages/playwright-core/src/server/chromium/crPage.ts
// packages/playwright-core/src/server/chromium/crServiceWorker.ts
// packages/playwright-core/src/server/chromium/crDevTools.ts
// packages/playwright-core/src/generated/utilityScriptSource.ts
```

These headers are present and at stable line numbers. They provide reliable section
anchors for scoping patches to the right module inside the bundle.

All 8 patch targets exist in `coreBundle.js` (confirmed in 1.60.0):
- `Runtime.enable` — 71 occurrences
- `this._callbacks.clear()` (CRSession) — at `init_crConnection` block, line ~33806
- `calculateUserAgentMetadata` (greasy brands, moved from browserContext) — line ~35785
- `UtilityScript` class inside embedded string literal — line ~15584

## Approach options

### Option A: Patch `coreBundle.js` directly (recommended)

Update `patch-playwright.js` to read and write `lib/coreBundle.js` instead of 8
separate files. The existing Babel AST approach (`astSuppressRuntimeEnable`, `strReplace`)
works on the bundle without modification — esbuild output is valid JS, not minified.

Scope patches to a section by extracting the substring between two consecutive source
file headers, applying the transform, then stitching back. This prevents the patch from
accidentally matching the wrong class when the same method name appears in multiple
sections (e.g. 7 classes each have `_callbacks.clear()`).

**Pros:**
- No build toolchain required; same postinstall mechanism as today
- Existing AST transforms are reusable as-is
- Single file to patch instead of 8; simpler rollback
- Section headers give reliable scoping

**Cons:**
- `patch-package` generates a diff of the entire 3.1 MB file (unwieldy but workable;
  we already use our own patch script and skip `patch-package` for the core logic)
- Anchor strings must be updated when Playwright refactors the bundle (same cost as
  today, just in one place instead of 8)

### Option B: Build from source

Clone the playwright repo at the release tag, apply patches to TypeScript source files,
run `npm run build`, copy the resulting `coreBundle.js` into `node_modules`.

**Pros:**
- Patches are on TypeScript sources — typed, readable, no anchor drift from compilation
- Build toolchain handles all bundling

**Cons:**
- Heavyweight: requires Node 20+, TypeScript, esbuild, and the full playwright dev tree
  (hundreds of MB) as a postinstall dependency
- Build takes significant time (minutes, not seconds)
- Breaks the zero-extra-dependency postinstall model
- Brittle: build scripts and TypeScript version must match exactly

Not recommended for this project.

## Chosen approach: Option A

Patch `coreBundle.js` directly. The implementation changes to `patch-playwright.js`
are mechanical: change the 8 `file:` entries to `coreBundle.js`, update the
section-scoping logic, and fix the one broken anchor (greasy brands).

## Implementation plan

### 1. Bump versions

In `package.json` and `packages/runtime/package.json`:
```json
"playwright": "1.60.0",
"playwright-core": "1.60.0"
```
Exact pins, no `^`. After `npm install --ignore-scripts`, confirm pins have not grown `^`.

### 2. Rewrite `patch-playwright.js` for coreBundle

Replace the `patches` array (8 × `{ file, steps }`) with a single entry targeting
`lib/coreBundle.js`. Add a `extractSection(src, header)` helper that returns
`{ before, section, after }` by splitting on the source file comment. Each patch
step operates on the extracted section and the helper stitches it back.

The 8 logical patches become 8 named section-transforms applied to coreBundle.js:

| Logical patch | Source header to scope to |
|---------------|--------------------------|
| crConnection — inject `__re__` helpers | `src/server/chromium/crConnection.ts` |
| crDevTools — suppress `Runtime.enable` | `src/server/chromium/crDevTools.ts` |
| crPage — Worker constructor + suppress `Runtime.enable` | `src/server/chromium/crPage.ts` |
| greasy brands | `src/server/chromium/crPage.ts` (moved from browserContext) |
| crServiceWorker — suppress `Runtime.enable` | `src/server/chromium/crServiceWorker.ts` |
| frames — `executionContextsCleared` + `_context()` | `src/server/frames.ts` |
| page — Worker constructor + `PageBinding.dispatch` | `src/server/page.ts` |
| utilityScriptSource — rename `UtilityScript` class | `src/generated/utilityScriptSource.ts` |

**Greasy brands patch rewrite:** The injection point moves from
`calculateUserAgentEmulation` (1.59.1, `browserContext.js`) to `_updateUserAgent`
in the crPage section. Inject brands into the metadata object before the CDP call:

```js
// In _updateUserAgent(), before the client.send call:
const meta = calculateUserAgentMetadata(options2);
const chromeMatch = (options2.userAgent || '').match(/Chrome\/(\d+)/);
if (meta && chromeMatch) {
  const seed = parseInt(chromeMatch[1], 10);
  // ... greasy brands injection (same logic as before)
  meta.brands = brands;
}
await this._client.send('Emulation.setUserAgentOverride', {
  userAgent: options2.userAgent || '',
  acceptLanguage: options2.locale,
  userAgentMetadata: meta
});
```

### 3. Update `PATCH_MARKERS`

Change both markers to reference content in `coreBundle.js`:
```js
const PATCH_MARKERS = [
  { file: 'coreBundle.js', marker: '__re__emitExecutionContext' },
  { file: 'coreBundle.js', marker: 'szkrabok: greasy brands' },
]
```

### 4. Update `verify-playwright-patches.js`

Change all 8 `file:` references to `coreBundle.js` with `section:` scoping if the
verify script uses them, or check for the same two sentinel markers in one file.

### 5. Update `tests/node/playwright-patches.test.js`

All file-specific test assertions (`crConnection.js contains __re__emitExecutionContext`,
etc.) must change to assert against `coreBundle.js`. Check that `coreBundle.js` is not
simply absent when the test runs (it replaces all the old files).

### 6. Regenerate `patches/playwright-core+1.60.0.patch`

```bash
npx patch-package playwright-core
```

The patch file will be large (diffing 3.1 MB). This is expected; it is kept as a
historical snapshot, not for replay. The operational patch is applied by
`patch-playwright.js`, not `patch-package`.

### 7. Full verification sequence

```bash
# 1. Clean install, apply patches
rm -rf node_modules/playwright-core
npm install playwright-core --ignore-scripts
node packages/runtime/scripts/patch-playwright.js

# 2. Verify anchors present
node scripts/verify-playwright-patches.js

# 3. Node patch tests
node --test tests/node/playwright-patches.test.js

# 4. Integration tests (MCP, requires open session)
npm run test:self
```

### 8. Update `docs/development.md`

- Update the "Upgrading playwright-core" section patch locations table for 1.60.0
- Replace individual file entries with the single `coreBundle.js` entry
- Document the greasy brands anchor change
- Document the section-scoping helper pattern

### 9. Commit

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

## Definition of done

### Version bump
- [ ] `package.json` and `packages/runtime/package.json` both pin `playwright` and
      `playwright-core` to `1.60.0` with no `^`
- [ ] `package-lock.json` updated

### Patch script
- [ ] `patch-playwright.js` targets `lib/coreBundle.js` for all 8 logical patches
- [ ] Section-scoping helper (`extractSection`) prevents wrong-class collisions
- [ ] Greasy brands injection moved to `_updateUserAgent` in crPage section
- [ ] Script reports `8 patches applied` (or equivalent — section-based reporting)
- [ ] All patches apply cleanly: `node packages/runtime/scripts/patch-playwright.js`
      exits 0 with no errors

### Verify script
- [ ] `scripts/verify-playwright-patches.js` reports all PASS against `coreBundle.js`

### Tests
- [ ] `node --test tests/node/playwright-patches.test.js` — all pass
- [ ] `npm run test:self` (lint + integration + node tests) — green

### Patch file
- [ ] `patches/playwright-core+1.60.0.patch` committed (may be large)

### CI
- [ ] Weekly "Check playwright-core upgrade" workflow passes on the branch
      (can be tested by pushing the branch and checking Actions)

### Docs
- [ ] `docs/development.md` "Upgrading playwright-core" section updated for
      the new bundle layout and greasy brands anchor

## Notes on future upgrades

Once the patch system targets `coreBundle.js`, each future upgrade follows the same
procedure as before but only one file needs inspection. The source file section
headers (`// packages/playwright-core/src/...`) are the only anchors that should be
treated as stable across versions. Concrete string anchors inside each section will
continue to drift and will need updating as before.

The weekly CI check will alarm whenever `npm view playwright-core version` exceeds
the pinned version. The upgrade checklist in `docs/development.md` remains the
authoritative procedure.
