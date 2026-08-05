# Feature: runtime launch/session pipeline cleanup — work order

## Status

Done. Items 1-6 implemented on `refactor/runtime-launch-cleanup` (based on
`origin/main` @ `9e90297`, post firefox-engine merge). Item 7 (localStorage
restore via `favicon.ico`) was intentionally deferred per its own note below —
not worth doing speculatively before it actually breaks in practice.

Each item landed with the existing test suite green throughout (`node --test
tests/node/*.test.js tests/node/runtime/*.test.js`: 391 pass, 0 fail, 1 skip),
plus a new TDD-driven regression test for item 4
(`tests/node/runtime/cookie-restore-batch.test.js`). `npm run lint` is clean.

Scope: `packages/runtime/launch.js` (610 lines), `pool.js`, `sessions.js`,
`storage.js`, `resolve.js`.

## Work order (priority order)

### 1. Collapse `pool.add()` positional args into an object (High, low risk)

`pool.js:10` — 13 positional params, `null`-padded at every call site:

```js
export const add = (id, context, page, cdpPort, preset, label, isClone = false,
  cloneDir = null, templateName = null, leaseHandle = null, pid = null,
  configHash = null, browserEngine = 'chromium') => { ... }
```

Called 4 times with positional nulls (`launch.js:448`, `launch.js:498`,
`sessions.js:129`). Easiest, highest-value item — mechanical rename to a single
options object, no behavior change. Do this first; it also de-risks the
`launch()` refactor below since fewer positional args need tracking.

### 2. Merge `launchClone()` and `cloneFromLive()` (High)

`launch.js:529-597`. Both do: `ensureGcOnExit`, `checkBrowser`, `cleanupClones`,
`ensureSessionsDir`, resolve `browserEngine`, `cloneProfileAtomic`, call
`launchFn`, then `_addCloneToPool`. Only real differences:
- `launchClone` calls `storage.ensureProfileDir(profile)` first; `cloneFromLive`
  calls `pool.get(templateName)` (throws if not open) and captures
  `template.context.storageState()` to pass as `storageState`.

Extract the shared tail into one function taking `{ templateDir, templateName,
storageState? }`.

### 3. Split `launch()` into named steps (High)

`launch.js:282-485`, ~200 lines, one function doing: browser resolution,
reuse-check + early return, meta load, preset resolution, effective-config
computation, config hash, `launchFn` invocation, cookie/localStorage restore,
iframe-fingerprint init script, pool registration, meta persistence, and
building the returned handle (with its own `close()` closure). The reuse-path
`close()` (`launch.js:300-309`) and the fresh-launch `close()`
(`launch.js:475-484`) are near-identical — factor into one `makeCloseHandle(profile,
context)` helper shared by both branches.

Suggested seams (function extraction only, not a new class hierarchy):
- `resolveEffectiveConfig(cfg, savedMeta, options)` → returns the 6
  `effective*` fields + `configHash`
- `restoreSessionState(context, profile)` → the cookie/localStorage block
  (`launch.js:380-425`)
- `makeCloseHandle(profile, context, { onClose })` → shared close logic

### 4. Fix cookie restore batch failure (Medium — real bug)

`launch.js:390-395`:

```js
try {
  await context.addCookies(savedState.cookies);
  ...
} catch (err) {
  log(`Cookie restore failed for ${profile}: ${err.message}`);
}
```

One malformed/expired cookie fails the whole `addCookies` call, silently
dropping *all* cookies for the profile (only a log line, no partial retry).
Restore individually (or bisect on failure) so one bad cookie doesn't cost the
rest of the session state.

### 5. Reduce verbose null-guard boilerplate (Medium, easy win)

`launch.js` has ~6 instances of the pattern:

```js
if (savedMeta !== null && savedMeta !== undefined && savedMeta.config !== null && savedMeta.config !== undefined) {
```

(lines 316, 328, 453, plus similar in `tryBrowserPid`, `_launchPersistentContext`
options handling). Replace with `savedMeta?.config ?? {}` etc. Confirm no
`eslint`/style rule in this repo forbids optional chaining before doing a bulk
pass (none found in `eslint.config.js` as of this writing — verify at
implementation time).

### 6. Encapsulate PID extraction (Medium)

`launch.js:42-86`, `tryBrowserPid()` — already defensive (nested try/catch,
falls back from `browser.process()` to private `browser.osProcess()._process.pid`),
but the private-API dependency is real and Playwright-version-sensitive. Move
to its own module (e.g. `pid.js`) with a comment pointing at the Playwright
version this was verified against, so a future upgrade failure is easy to find
and isolated from `launch.js`'s main logic. Not urgent — it already degrades to
`null` safely — but worth doing opportunistically during item 3's extraction pass.

### 7. localStorage restore via `favicon.ico` navigation (Low-Medium, real fragility)

`launch.js:413`:

```js
await page.goto(origin + '/favicon.ico', { waitUntil: 'commit', timeout: 10_000 });
```

Assumes the origin will commit *some* navigation to run `page.evaluate` in that
origin's context; doesn't require the favicon to actually exist (any 404 still
commits), but does depend on the origin being reachable and not blocking the
request outright (e.g. strict CSP `navigate-src` or a redirect to a different
origin would break the localStorage-origin assumption silently). Already has a
10s timeout so it fails loud rather than hanging. Worth a `about:blank` + same-origin
iframe alternative if this shows up in real failures — not worth doing
speculatively before it does.

## Rejected / not worth doing

Findings from the original review that did not hold up on inspection of the
actual code:

- **"Config hash built manually, should hash entire normalized config object"**
  — wrong direction. `sessions.js:computeConfigHash` deliberately whitelists
  `CONFIG_FIELDS` to exclude transient/derived fields (`pid`, `cloneDir`,
  `leaseHandle`). Hashing the entire config would reintroduce false-positive
  mismatches. Leave as-is.
- **"beforeExit cleanup insufficient, not sole GC"** — true that `beforeExit`
  doesn't fire on `SIGKILL`/crash, but the code already documents and relies on
  `rmWithRetry` + the TTL-based `cleanupClones` scavenger (`storage.js:295-330`)
  as the actual primary/backstop mechanisms; `beforeExit` is explicitly a
  best-effort extra, not the sole guard. No action needed.
- **"waitForExit() PID reuse race"** — real in theory, but `launch.js:90-94`
  documents that `rmWithRetry` (not PID liveness) is the primary directory-removal
  guard and doesn't depend on PID lifecycle. The race would only matter if
  something *else* depended on `waitForExit` for correctness, and nothing does.
  No action needed.
- **"Silent failures — many `catch {}` blocks hide root cause"** — checked the
  actual `catch {}` sites (`resolve.js` chrome-launcher/playwright probes,
  `_addCloneToPool` lease close); each has an inline comment explaining why the
  failure is expected/ignorable (e.g. "chrome-launcher unavailable"). Not a
  real problem as found.
- **"Precedence chain repeated across the codebase"** — checked; the
  `effectiveViewport`/`effectiveUserAgent`/etc. pattern (`launch.js:337-340`)
  appears exactly once, not repeated elsewhere in `src/` or `packages/runtime`.
  4 similar lines in one place don't justify an abstraction.
- **"Boolean flags (`reuse`, `stealth`) grow combinatorially"** — only 2
  independent boolean options exist today (plus `headless`, which isn't a
  policy flag). No combinatorial problem in the actual code; revisit if a third
  interacting flag gets added.
- **"Poll timing constants duplicated semantics"** — `CHROME_EXIT_POLL_MS`/`_TIMEOUT_MS`
  (`launch.js`) and `RM_RETRY_POLL_MS`/`_TIMEOUT_MS` (`storage.js`) happen to
  share values (100ms/15s) but guard conceptually different things (PID
  liveness vs. directory-removal retry). Coincidental value overlap isn't
  duplication worth centralizing.
- **"Chromium/Firefox branching" as a strategy-pattern `BrowserAdapter`** —
  the branching is real (`launch.js:150-232`, `:261-268`, `:365-376`, `:530-597`)
  but it's currently ~5 `isFirefox`/`browserEngine === 'firefox'` checks across
  one file, each doing something genuinely engine-specific (no CDP port, no
  stealth, different prefs, no `connect()` support). A full adapter class
  hierarchy is more machinery than the current branching complexity justifies.
  If a third engine is added, revisit; until then, item 3's step-extraction
  naturally isolates most of this branching into smaller functions anyway.
- **Structured logging / builder for `SessionMetadata` / naming bikeshedding
  (`launchFn`/`_launchImpl`)** — stylistic only, no correctness or
  maintainability payoff big enough to warrant its own task. Skip.

## Suggested order of execution

1 (pool.add) → 2 (merge clone paths) → 5 (null-guard cleanup, mechanical) →
3 (split launch()) → 4 (cookie restore) → 6 (PID isolation) → 7 (localStorage
restore, only if it actually breaks in practice).

Each step should land as its own commit with the existing test suite
(`npm run test:node`, `tests/node/runtime/*`, Firefox-specific
`tests/node/runtime/launch-firefox.test.js` / `firefox-live.test.js`) passing
before moving to the next, since items 1-3 touch the same call sites.
