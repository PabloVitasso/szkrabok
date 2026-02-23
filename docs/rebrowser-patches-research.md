# rebrowser-patches Research

Reference repo: https://github.com/rebrowser/rebrowser-patches
Cloned to: `vendor/rebrowser-patches/` (gitignored, update with `git pull` inside)
Bot detector: https://bot-detector.rebrowser.net/

---

## What the patches fix

Three categories of CDP leaks that anti-bot systems detect:

### 1. Runtime.enable leak (runtimeEnableLeak)

Playwright calls `Runtime.enable` on every frame/worker/service-worker session.
Anti-bot systems (Cloudflare, DataDome) detect this CDP command.
**Fix:** Suppress all `Runtime.enable` calls. Instead, obtain execution-context IDs
via one of three modes (env var `REBROWSER_PATCHES_RUNTIME_FIX_MODE`):

| Mode                   | How                                                        | Trade-off                                                                            |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `addBinding` (default) | Runtime.addBinding round-trip to get main-world context ID | Main world access preserved; UtilityScript still detectable                          |
| `alwaysIsolated`       | createIsolatedWorld for all evaluations                    | mainWorldExecution + sourceUrlLeak pass; dummyFn fails (no main-world window access) |
| `enableDisable`        | Runtime.enable then immediate Runtime.disable              | Slight race risk                                                                     |

### 2. sourceURL leak (sourceUrlLeak)

**Puppeteer:** adds `//# sourceURL=pptr:evaluate;...` to scripts — rebrowser-patches changes to `app.js`.
**Playwright:** UtilityScript class wraps all evaluations. Page intercepts `document.getElementById`,
captures `new Error().stack`, checks for `UtilityScript.` string.

rebrowser-patches does NOT fix this for playwright.
**Our fix (patch #7):** rename `UtilityScript` class to `__pwUs` inside `generated/utilityScriptSource.js`
compiled string. Export key stays `UtilityScript` so internal playwright code is unaffected.
Stack trace shows `__pwUs.evaluate` instead — detector check fails → passes.

### 3. mainWorldExecution

Page overrides `document.getElementsByClassName` and detects if it's called from main world.
**Fix:** `alwaysIsolated` mode — evaluations run in isolated world where the page's override
doesn't apply. Tradeoff: `window.*` vars set by page scripts are not accessible.

---

## Detection results — current state (playwright-core 1.58.2, szkrabok)

| Check              | Result | Notes                                                       |
| ------------------ | ------ | ----------------------------------------------------------- |
| dummyFn            | pass   | addBinding mode gives main world access                     |
| sourceUrlLeak      | pass   | patch #7 (UtilityScript rename)                             |
| mainWorldExecution | fail   | requires alwaysIsolated; conflicts with dummyFn             |
| runtimeEnableLeak  | pass   | Runtime.enable suppressed                                   |
| exposeFunctionLeak | fail   | unfixable — detectable `__playwright__binding__` window key |
| navigatorWebdriver | pass   | stealth plugin                                              |
| viewport           | pass   | non-default viewport                                        |
| pwInitScripts      | pass   | stealth plugin                                              |
| bypassCsp          | pass   | CSP not bypassed                                            |
| useragent          | fail   | Chrome for Testing (CfT) binary — see below                 |

**7/10 passing.** Three failures: mainWorldExecution (mode conflict), exposeFunctionLeak (no fix), useragent (binary identity).

### useragent check — root cause

`navigator.userAgentData.brands` reports only `Chromium/143` — no `Google Chrome` brand.
This is the correct, honest signal for Chrome for Testing (CfT), which Playwright downloads
via `npx playwright install chromium`. CfT deliberately omits the `Google Chrome` brand.

The session config spoofs `navigator.userAgent` (the old string API) to `Chrome/120 Windows`.
But `userAgentData` is a structured Client Hints API populated from the binary identity —
it cannot be overridden by a UA string override. The result is two contradictory signals:
old API says Chrome/120, structured API says Chromium/143. That is **more detectable** than
just being honest.

**Options:**

| Option                                             | Passes check | Honest | Cost                              |
| -------------------------------------------------- | ------------ | ------ | --------------------------------- |
| Use system Google Chrome stable (`executablePath`) | yes          | yes    | requires Chrome installed on host |
| Remove UA string spoof — report Chromium honestly  | no           | yes    | consistent signals, still fails   |
| Patch `userAgentData` brands via init script       | yes          | no     | fragile, likely detectable        |

Correct fix: support `executablePath` in `session.open` so users can point at system Chrome.
Until then: remove the fake UA string override for Chromium sessions so signals are at least
consistent (both APIs report Chromium/143).

The test now includes `useragent` in `EXPECTED_PASS` so it is tracked and reported.

---

## Our implementation

`scripts/patch-playwright.js` — pattern-based string replacement on 7 compiled lib files.
Runs as `postinstall` in `package.json`. Rolls back atomically on any failure.

**Two playwright-core installs must both be patched:**

- `node_modules/playwright-core` — used by the MCP server
- `node_modules/playwright/node_modules/playwright-core` — used by the test runner (`browser.run_test` spawns `npx playwright test` which resolves through this nested copy)

The script finds and patches all copies automatically. Each gets a `.szkrabok-patched` stamp file.

Files patched (in each install):

| File                                     | What                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `lib/server/chromium/crConnection.js`    | Add `__re__emitExecutionContext`, `__re__getMainWorld`, `__re__getIsolatedWorld`     |
| `lib/server/chromium/crDevTools.js`      | Suppress `Runtime.enable`                                                            |
| `lib/server/chromium/crPage.js`          | Suppress `Runtime.enable` (page + worker), pass targetId/session to Worker           |
| `lib/server/chromium/crServiceWorker.js` | Suppress `Runtime.enable`                                                            |
| `lib/server/frames.js`                   | Emit `executionContextsCleared` on commit; rewire `Frame._context()`                 |
| `lib/server/page.js`                     | Update Worker constructor; add `getExecutionContext()`; guard `PageBinding.dispatch` |
| `lib/generated/utilityScriptSource.js`   | Rename `UtilityScript` class → `__pwUs`                                              |

Resilience: pattern-based (not line-number-based), survived playwright 1.57→1.58 upgrade automatically.

---

## Avenues to pursue

### A. Fix mainWorldExecution without breaking dummyFn

Core conflict: `addBinding` gives main-world access (dummyFn works) but is detectable;
`alwaysIsolated` hides from detection but loses main-world `window.*` access.

Possible middle path: implement a hybrid — run evaluations in isolated world by default
(`alwaysIsolated`), but add a bridge that reads/writes specific main-world properties
via `Runtime.addBinding` when needed. Complex, no off-the-shelf solution.

Alternative: drop `page.exposeFunction('exposedFn', ...)` from the test — it's optional
and its detection is unfixable anyway. Then switch to `alwaysIsolated` mode.
Result: dummyFn would fail (can't call `window.dummyFn()` from isolated world), but
mainWorldExecution + sourceUrlLeak would pass. Net: still 7/9, different set.

### B. Fix exposeFunctionLeak

The detector checks `window.__playwright__binding__` key existence and `exposedFn.toString()`
containing `exposeBindingHandle supports a single argument`. No patch exists upstream.
Options:

- Remove `page.exposeFunction` usage from automation code entirely
- Intercept the `__playwright__binding__` creation and rename/hide the key (deep BindingsController patch)

### C. Keep vendor/rebrowser-patches up to date

```bash
cd vendor/rebrowser-patches && git pull
```

When they release fixes for newer playwright versions, check their `patches/playwright-core/src.patch`
for any new logical changes to port into our `scripts/patch-playwright.js`.

### D. Switch to rebrowser-playwright-core drop-in

If maintaining our patch script becomes burdensome, switch to their pre-patched package:

```json
"playwright-core": "npm:rebrowser-playwright-core@^1.x.x"
```

Latest tested: 1.52.0 (as of Feb 2026). Risk: they lag behind official playwright releases.

### E. Vendor playwright TypeScript source

Clone `microsoft/playwright`, apply `vendor/rebrowser-patches/patches/playwright-core/src.patch`
to TypeScript source, build and use local build. Full control, highest maintenance cost.
