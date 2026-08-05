# launch.js optimizations — findings (not all recommended)

**Status:** notes only, no implementation decided. Triggered by `packages/runtime/launch.js`
growing scope (Chromium + Firefox branching, clone/template paths, restore logic) during
Firefox engine work. Table below is prioritized by maintainability/token-efficiency, not style.
**Explicit exclusion:** do NOT move inline doc comments to markdown (Low/Comments row) — verbose
in-source comments are wanted, not a liability.

## Findings

| Sev | Area | Issue | Recommendation |
|-----|------|-------|-----------------|
| High | Architecture | `launch()` does ~10 responsibilities | Split into pipeline fns: `resolveConfig`, `restoreState`, `launchContext`, `registerPool`, `persistMeta` |
| High | Config | Precedence chain repeated across call sites | Centralize into `buildEffectiveConfig()` |
| High | State | `savedMeta !== null && savedMeta !== undefined && ...` repeated | `savedMeta?.created ?? Date.now()` style — optional chaining/nullish coalescing |
| High | Resources | Manual cleanup scattered across error paths | `finallyCleanup()` helper |
| High | Browser abstraction | Chromium/Firefox `if` branches repeated at 4+ sites | Strategy pattern (`BrowserAdapter`: `launch/resolve/prepareOptions/restore`) |
| Med | Persistence | Meta object hand-assembled per call site | Builder/factory (`SessionMetadata.from(...)`) |
| Med | Pool | `pool.add(profile, context, page, cdpPort, preset, label, false, null, null, null, pid, hash, browserEngine)` — 13 positional args | Object param: `pool.add({ profile, context, page, pid, hash, browserEngine, ... })` |
| Med | Launch | `_launchPersistentContext()` mixes option-building with launching | Split option generation from the launch call |
| Med | Clone | `launchClone()` / `cloneFromLive()` share >80% logic | Extract common path |
| Med | Logging | String interpolation instead of structured fields | Structured logger fields only |
| Med | PID | `browser.osProcess()._process.pid` — private Playwright API | Isolate in a compatibility module; breaks silently on PW upgrade, `undefined` on forks |
| Med | Storage restore | Cookie/localStorage restore is one large procedural block | `restoreStorageState(context, state)`, split per-store (cookies/localStorage/indexedDB) |
| Med | Config hash | Hash built field-by-field manually | Hash the whole normalized config object |
| Med | Constants | Poll-timing constants duplicated in spirit across call sites | Single configurable timeout object |
| Low | Naming | `launchFn`, `_launchImpl`, `_launchPersistentContext` inconsistent | Standardize on `launcher` |
| Low | API | Boolean flags (`reuse`, `stealth`) combinatorial growth | Launch-policy object instead of flag soup |
| ~~Low~~ | ~~Comments~~ | ~~Large doc blocks in source~~ | **Rejected** — keep inline comments as-is |

## Known bugs / risk areas (not yet filed as issues)

1. **PID extraction fragile** — `browser.osProcess()._process.pid` uses a private Playwright
   field. Breaks silently on Playwright upgrade; `undefined` on forked processes.
2. **localStorage restore assumes `origin + '/favicon.ico'` exists**, accepts navigation, and CSP
   permits execution. Consider `about:blank` → temp iframe → origin nav, or a dedicated restore
   abstraction.
3. **`waitForExit()` uses `process.kill(pid, 0)`** — PID-reuse race: browser exits, OS reuses the
   PID, wait loop thinks it's still alive. Rare, real.
4. **`process.once('beforeExit')` cleanup doesn't run on SIGKILL/crash/uncaught fatal exit** — not
   sufficient as the sole GC mechanism.
5. **Silent `catch {}` blocks** scattered through cleanup paths hide root cause; prefer
   `catch (e) { log.debug(...) }`.
6. **Cookie restore aborts the whole batch on one bad cookie** — restore individually instead.
7. **`savedMeta.config` has no schema version** — future config field additions may produce
   inconsistent restores from old session metadata.

## Token/LOC estimate if pursued

Largest token consumers: repeated null checks, duplicated Firefox/Chromium branches, repeated
launch-option construction, repeated cleanup/restore logic, positional parameter lists.
Rough estimate: source LOC -20–30%, LLM prompt tokens -25–40%, branching-driven maintenance
complexity ~30% lower. Highest-leverage single change: `BrowserAdapter` + `SessionManager` +
`EffectiveConfig` pipeline — collapses most of the duplicated conditional logic.

## Scope note

This is a findings dump, not a commitment. Pick items opportunistically (e.g. `pool.add()`
positional-args cleanup is low-risk/high-value; full `BrowserAdapter` extraction is a bigger
lift best done as its own branch after Firefox engine support lands).
