# Feature: vendored evasions (B1) + verified pre-patched core (C1); postinstall = greasy brands only

**Implements:** P0 + B1 + C1 + V
**Depends on:** nothing
**Related:** [20261031-greasy-brands-upstream-contribution-plan.md](./20261031-greasy-brands-upstream-contribution-plan.md) — optional upstream contribution of greasy brands to rebrowser-patches

## Status

P0 done; W1–W3 not started. As of 2026-10-31: upstream `playwright-core` 1.64.1; rebrowser drop-ins 1.64.101; electrovir drop-ins (`@electrovir/rebrowser-playwright(-core)`) 1.61.101 (upstream 1.61.1 — lagging, fallback only).

## Chosen design

| ID | Choice | Kills |
|----|--------|-------|
| P0 | greasy brands = szkrabok's own core patch, separate from the rebrowser patches; the only postinstall step after W3 (D8) | — |
| B1 | vendor evasion payloads + own loader; delete `puppeteer-extra*` + `playwright-extra` | glob/rimraf/inflight warnings, guard Proxy, `USER_PREFERENCES_STUB`, enabledEvasions dance |
| C1 | pre-patched playwright-core as package for the **rebrowser** patches; the postinstall keeps only szkrabok's greasy-brands step. Primary: verified `rebrowser-playwright-core` drop-in. Fallback: own `@pablovitasso/playwright-core` fork (design below) when rebrowser lags | patch-package, `--ignore-scripts` losing the rebrowser patches |
| V | verification procedure below — depend on drop-in **only after** proving contents = official core + public patches. Reproducible evidence (hashes + log) | supply-chain trust in third-party fork |

End state: one install script (greasy brands), zero deprecated-dep warnings. `--ignore-scripts` drops greasy brands; doctor / `launch()` warn (marker check).

Why:
- Rebrowser patches via postinstall: needs install scripts — broken under `npm --ignore-scripts`, pnpm 10 (unapproved builds), Bun (`trustedDependencies`) → stock core, stealth silently gone; rewrites another package's files in the consumer tree (side effects on consumer's own `@playwright/test`); lockfile `integrity` covers the tarball, not files rewritten after; install-time code from a dependency; hoisting-sensitive resolution heuristics.
- Stealth plugin stack: szkrabok already reimplements 5 configurable evasions first-party (`applyStealthToExistingPage`, ~200 LOC CDP + init scripts) and fights the framework (guard Proxy, `USER_PREFERENCES_STUB`, enabledEvasions dance); evasion surface ~2,534 LOC non-test (incl. 583 `_utils`); whole `puppeteer-extra*`+`playwright-extra` glue ~10,161 LOC; injection shim = `evaluateOnNewDocument` → `addInitScript` (playwright-extra dist/index.cjs.js:233); upstream frozen since 2023-03; stealth/playwright-extra MIT, Playwright Apache-2.0; rebrowser patch versions jump 1.52.0 → 1.64.x (= why szkrabok self-patched 1.58.2–1.63.0).

---

## P0 — greasy brands, szkrabok's own patch — done

Greasy brands is szkrabok's own, one version. Separate from the rebrowser patches, so that with the rebrowser drop-in the postinstall applies greasy brands only.

- `packages/runtime/greasy-brands-patch.js` (`injectGreasyBrands`, `stripGreasyBrands`, `GREASY_BRANDS_MARKER`) + postinstall `scripts/apply-greasy-brands.js`. Block in `calculateUserAgentMetadata(options)`, pattern-based (no per-version anchors); checked on stock 1.63.0, rebrowser-patched 1.63.0 and `rebrowser-playwright-core@1.64.101` (inject, idempotent, strip restores byte-exact).
- Algorithm: `packages/runtime/stealth-evasions/ua-brands.js` (Chromium's GREASE scheme, `user_agent_utils.cc`), shared with `applyStealthToExistingPage` and the guarded UA plugin.
- The hook covers every `Emulation.setUserAgentOverride` Playwright builds, its own re-sends and service workers included.
- **IMPORTANT (verified 2026-11-01, CfT 145 + ungoogled-chromium 155):** the hook covers the *brands* of every send — but per-target `Emulation.setUserAgentOverride` does **not** change the service-worker or shared-worker `navigator.userAgent` string (likely fixed at worker-global creation); dedicated workers do inherit the override. Inside a service worker `self.navigator.userAgent` stays the browser default (`HeadlessChrome/…`) while `userAgentData.brands` is greasy. A browser-level `--user-agent=<effective UA>` launch flag *does* fix it: with the flag, page/SW/dedicated/shared all report the custom string. Remaining gaps: `getHighEntropyValues().fullVersionList` leaks the binary version when only `brands` is set (page without init script, dedicated/shared worker without a launch flag) or is empty (SW; page 2/dedicated/shared with the flag; page 1 keeps the init-script 120.0.0.0 values); the first page gets a JS UAD override (`applyStealthToExistingPage`) that later pages do not; shared-worker `userAgentData` stays native (brands/platform) even with the launch flag. See risks 9-12 and the 2026-11-02 measured sections below; re-measured: worker-target overrides revert on detach for shared and service worker targets, and per-target Emulation never changes the worker's `navigator.userAgent`.
- Marker = `szkrabok:greasy-brands rev=<hash of block>`: a block of another rev reads as unpatched and is replaced on the next postinstall.
- Postinstall order: `apply-greasy-brands.js --strip` → `apply-patches.js` → `apply-greasy-brands.js` → verify. Strip first: patch-package hunks are line-position based (an insertion ahead of them fails the apply).
- `PATCH_MARKERS` = `REBROWSER_PATCH_MARKERS` (4) + `GREASY_BRANDS_MARKER`. For W2 only the rebrowser group changes. Known-present in rebrowser 1.64.1 patches: `__re__emitExecutionContext`, `REBROWSER_PATCHES_RUNTIME_FIX_MODE`, `getExecutionContext`, `rebrowserUtilityScriptName` (rebrowser renames UtilityScript **at runtime** via a `rebrowserUtilityScriptName` string-replace on the bundle — no static `__pwUs`-style marker exists). Verified 2026-10-31 against stock `playwright-core@1.64.1` coreBundle + the drop-in: `getExecutionContext`, `__re__emitExecutionContext`, `rebrowserUtilityScriptName` = 0 hits in stock, 3/3/5 in the drop-in — specific. `var UtilityScript = class` occurs in **both** (their rename matches on that literal) — unusable as marker.
- `patches/` holds the pinned version's rebrowser patch only.
- Tests: `tests/node/ua-brands.test.js` (algorithm vs published Sec-CH-UA, Playwright's `_updateUserAgent` from the installed bundle, inject / strip / replace).

## W1 — vendored evasions (B1)

| Task | Where | Notes |
|------|-------|-------|
| Copy 17 evasion dirs + `_utils` verbatim | `packages/runtime/stealth-evasions/` | ~2,534 LOC non-test; MIT header + provenance note (berstend 2019, upstream commit hash) per dir or top-level NOTICE |
| Loader: build init scripts, apply via `addInitScript`/CDP | `packages/runtime/stealth-evasions/loader.js` (~150 LOC) | replaces `evaluateOnNewDocument` shim (playwright-extra dist/index.cjs.js:233) |
| Merge two stealth paths | `packages/runtime/stealth.js` → loader call in `launch.js` | plugin path + `applyStealthToExistingPage` become one source of truth |
| Port `defaultArgs`/beforeLaunch arg munging | `packages/runtime/launch.js` args block | partly present (`--hide-crash-restore-bubble` etc.) |
| Delete: guard Proxy, stub, enabledEvasions dance | `packages/runtime/stealth.js` | keep config surface (`[puppeteer-extra-plugin-stealth]` TOML → renamed `[stealth]`, config.js:48; compat: accept both keys for one release, warn on the old) |
| Drop deps | `package.json` | `puppeteer-extra-plugin-stealth`, `playwright-extra`, `puppeteer-extra`, `puppeteer-core` |
| Update tests | `tests/node/stealth-ua-guard.test.js` (11 tests pin internals), e2e rebrowser specs | rework assertions to loader API |

Risks: `_utils` byte-exact or evasions detectable; upstream fixes lost (upstream frozen — moot).

## W2 — verified pre-patched core (C1 + V)

### V. verification procedure (gate)

Use latest rebrowser/electrovir drop-in **only after** proving: contents = official core + public patches. Evidence = hashes + log, kept in repo, consumers can re-run.

1. **Identify candidate**
   ```bash
   npm view rebrowser-playwright-core version          # → 1.64.101
   npm view rebrowser-playwright-core dist.tarball dist.integrity
   ```
   - Record the **claimed upstream base** + how derived. Verified 2026-10-31: no `package.json` field declares it (keys: name, version, description, …) — derive from the version scheme (`1.64.1xx` ↔ upstream `1.64.1`) + their README/repo tags. The step 2–3 reproduce-and-diff is the proof of the base.
2. **Reproduce locally (clean room)**
   ```bash
   mkdir /tmp/verify-rebrowser && cd /tmp/verify-rebrowser
   npm init -y
   npm install playwright-core@1.64.1 --no-save       # exact upstream the drop-in claims
   npx rebrowser-patches@1.1.2 patch --packageName playwright-core     # PINNED, never @latest
   npx rebrowser-patches@1.1.2 check --packageName playwright-core
   ```
3. **Extract + compare published package**
   ```bash
   npm pack rebrowser-playwright-core@1.64.101
   tar -xzf rebrowser-playwright-core-1.64.101.tgz
   diff -ruN node_modules/playwright-core package/ --exclude=package.json --exclude=README.md
   ```
   - Zero meaningful diff → accept. Metadata diffs (name, version, repository) expected.
   - Any other file or code change → **reject**.
4. **Evidence artifacts**
   ```bash
   # tarball hash → must equal npm dist.integrity payload (dist.integrity is base64, sha512sum is hex):
   openssl dgst -sha512 -binary rebrowser-playwright-core-1.64.101.tgz | base64
   # hash inside each tree, identical relative paths, same exclusion whitelist as step 3:
   (cd node_modules/playwright-core && find . -type f ! -name package.json ! -name README.md | sort | xargs sha256sum) > local-patched.sha256
   (cd package && find . -type f ! -name package.json ! -name README.md | sort | xargs sha256sum) > published.sha256
   diff local-patched.sha256 published.sha256
   ```
5. **Verification log** — `docs/verification/<pkg>-<ver>.md` + machine-readable `verified-core.json` (consumed by doctor):
   ```
   Date: 2026-10-31
   Candidate: rebrowser-playwright-core@1.64.101
   Upstream: playwright-core@1.64.1
   Patches: rebrowser-patches@1.1.2 (commit <captured at run time>)
   Result: bit-identical after excluding metadata (package.json, README.md only)
   Tarball integrity: sha512-yw9m3HJFcsdnMRIDNEpoNVrC7Rl7oUu7PcttdG7s1EeImea0VvnOJ2i2ropECSQGVx6kthO5901fqlYnXS8ZJg==
   Local vs published file hashes: match
   ```
6. **Depend on the verified package** (wiring below). `npm audit signatures` after install — extra check.

Procedure rules:

- `rebrowser-patches@latest` = moving target → **pin** the version; if diff non-empty at pinned version, either wrong patch version or non-patch changes → investigate/reject. Patch-version provenance is what the reproduce-and-diff step proves.
- Hash **all** files (not `*.js` only), with identical relative paths (`cd` into each tree) and the step-3 exclusion whitelist applied — the hash diff and the tree diff must agree exactly.
- Exclusion whitelist = `package.json`, `README.md` **only**. Everything else counts as content.
- Run procedure in CI (workflow_dispatch) on a schedule → detect retroactive republish/compromise.

### Wiring

| Task | Where | Notes |
|------|-------|-------|
| Alias | `package.json` | `"playwright": "npm:rebrowser-playwright@1.64.101"`. Its dep `rebrowser-playwright-core@1.64.101` (own name) → single copy, no stock-core nesting. Do **not** also alias `playwright-core` — avoid duplicate trees |
| Imports | `packages/runtime/launch.js:4` | stays `from 'playwright'` (resolves alias). Direct `playwright-core` imports if any → `rebrowser-playwright-core` or via alias |
| Rework resolution helpers | `packages/runtime/patch-check.js` | `playwrightCoreRoot()` resolves `playwright-core/package.json` → resolve `rebrowser-playwright-core/package.json` through `playwright`'s require chain |
| doctor install | `src/cli/commands/doctor.js` | keep `npx playwright install chromium` — resolved: `rebrowser-playwright` keeps the `playwright` bin name (verified), so npx resolves the local rebrowser CLI; stock-fetch risk only when the dep is absent |
| Peer dep | `@playwright/test` optional peer | consumers' spec cores stay stock → document root `overrides` `{ "playwright-core": "npm:rebrowser-playwright-core@1.64.101" }` (add `"playwright": "npm:rebrowser-playwright@1.64.101"` if the consumer uses `playwright`) + verification procedure in README |
| Bump base | 1.63.0 → 1.64.1 | e2e + node suites on new core; retire `patches/` as install input |
| Fallback fork | separate repo (design below) | trigger: needed upstream version with no rebrowser drop-in (historical: 1.52→1.64 gap). Same V procedure validates fork tarball. `patches/` becomes that repo's input |

### Fallback fork — own pre-patched package

- Build in fork repo CI (its own Actions — the szkrabok repo's disabled workflows are irrelevant): upstream `playwright-core@X` tarball + `patches/playwright-core+X.patch` applied; marker check (`missingPatchMarkers` → `[]`) on the packed tarball before publish. Publish via **npm trusted publishing (OIDC)** — no stored token; `npm publish --provenance`; `environment: release` with required reviewer; 2FA on the account. One manual first publish before OIDC binding; verify current npm trusted-publisher docs before building.
- Version `X-szk.N` (e.g. `1.63.0-szk.1`), pinned exactly. `N` bumps on a patch-only change. Prerelease form is invisible to ranges — intended: nothing should pick it up by range.
- Wiring identical to the table above (alias / imports / resolution helpers). Consumers running specs over CDP need root-project `overrides`: `{ "playwright-core": "npm:@pablovitasso/playwright-core@X-szk.N" }` — document in README, scaffold template, companion handout task 2. (`overrides` are root-project-only — cannot ship from inside a library.)
- Package name: `@pablovitasso/playwright-core` — resolved: `@pablovitasso` scope is proven owned (szkrabok 3.0.0 published under it); `@szkrabok` scope unverified (registry 404 probe).
- Firefox: resolved — `playwright-core` exports `firefox`/`chromium` (verified 2026-10-31); the Firefox launch needs nothing from the `playwright` package specifically (unpatched by design).
- Licence: Playwright is Apache-2.0. Ship `LICENSE`, `NOTICE`, and the patch (modified files must state the change, Apache-2.0 §4b).
- Playwright upgrade flow: regenerate the patch (docs/development.md) → CI publishes `X-szk.1` → bump the alias.

## W3 — deletions

- `patch-package` dep, `scripts/apply-patches.js`, the `--strip` step. **Postinstall stays** (P0 decision): `apply-greasy-brands.js` → `verify-playwright-patches.js`. `prepare` unchanged. `scripts/setup.js` is dev-only convenience (mkdir `sessions/`, `logs/` + install hint): tarball consumers never run `prepare`, and runtime `storage.js` already mkdirs lazily (verified). Replacement: document `npm run setup` in development.md; move the install hint to README.
- `patches/` + `packages/runtime/scripts/patch-playwright.js` → move to fallback-fork repo.
- `USER_PREFERENCES_STUB`, `guardedClient`/`guardedPage`/`guardUserAgentPlugin` (W1).

## Test updates

| Suite | Change |
|-------|--------|
| `tests/node/stealth-ua-guard.test.js` | brands-module unit tests; loader-API assertions replace plugin-internals assertions |
| `tests/playwright/e2e/rebrowser*.spec.js` | run against rebrowser core 1.64.1xx; verify markers still hold |
| `tests/node/` general | patch-check marker set change (P0) |
| new `tests/node/verify-core.test.js` | `verified-core.json` schema + doctor reads it |
| `tests/node/playwright-patches.test.js` | markers + launch warning — updated marker set (P0) |
| smoke test (`scripts/smoke-test.js`) | packed tarball, normal install: `szkrabok doctor` reports patched (drop-in markers + greasy marker). With `--ignore-scripts`: doctor reports the greasy marker missing (still script-dependent by decision) |
| CI (fork path) | packed fork tarball has every marker before publish |

## Risks / failure modes

| # | Risk | Mitigation |
|---|------|------------|
| 1 | drop-in adds non-patch changes | V step 3 diff rejects; CI re-verify detects later drift |
| 2 | patch apply fails on version mismatch | always pin exact upstream the drop-in claims (V step 2) |
| 3 | electrovir lag (`@electrovir/rebrowser-playwright(-core)` 1.61.101 vs upstream 1.61.1) | prefer official rebrowser; electrovir only if V-verified + version acceptable |
| 4 | rebrowser lag on future upstream | fallback fork (W2 last row) — known gap 1.52→1.64 |
| 5 | alias resolution wrong in consumer trees | patch-check markers assert at doctor/launch (keep) |
| 6 | new core drops / renames `calculateUserAgentMetadata(options)` | greasy injector throws → postinstall fails loudly; `ua-brands.test.js` runs Playwright's own `_updateUserAgent` against the injected bundle |
| 7 | `_utils` mistranscription in B1 | byte-diff vendored copy against upstream tarball in test |
| 8 | until W2: a changed rebrowser patch for the same playwright-core version is not re-applied in place (npm keeps the extracted core; patch-package prints `Failed to apply patch` and exits 0 locally) | the drop-in removes it; cheap guard if needed: `--error-on-fail` in `apply-patches.js` (exit 1 only on a mismatch, 0 on clean and already-applied) |
| 9 | **IMPORTANT** — SW/shared-worker UA **string** not overridden by per-target Emulation: `self.navigator.userAgent` stays the browser default (`HeadlessChrome/…`) while brands are greasy; UA↔UA-CH mismatch in worker context | per-target Emulation is ineffective for the string (dedicated workers inherit the page's override); set the browser default with `--user-agent=<effective UA>` in Chromium launch args (verified 2026-11-02: page/dedicated/SW/shared all report Chrome/120 with the flag). Keep greasy metadata for brands. Firefox: `general.useragent.override` (untested) |
| 10 | **IMPORTANT** — greasy metadata sets only `brands`; `getHighEntropyValues().fullVersionList` leaks the binary version and the **wire header `Sec-CH-UA-Full-Version-List` leaks it too** in pages/dedicated workers without the init-script override or a launch flag (measured: brands 120 vs FVL 155.0.8059.79 in the same request); SW/shared FVL empty. Extending `calculateUserAgentMetadata` with `fullVersionList`/`fullVersion`/`bitness` was verified to fix page, dedicated worker and service worker metadata + headers. Shared worker still needs its own target hook. `N.0.0.0` as the FVL value is anomalous vs real Chrome (`CAPTURED_145`: Chromium `145.0.7632.46`) | extend `calculateUserAgentMetadata` and the plugin's `Network.setUserAgentOverride` interceptor (`withGreasedBrands`) to set the three fields; prefer a real build number per preset/milestone over `N.0.0.0`; extend `ua-brands.test.js` with the wire-header assertion |
| 11 | **IMPORTANT** — first-page vs later-page UAD inconsistency: `applyStealthToExistingPage` injects a JS `navigator.userAgentData` getter only on the initial page; later pages rely on CDP metadata. The getter also hardcodes `platform: 'Windows'`, `platformVersion: '10.0.0'`, `architecture: 'x86'` for every preset, so Mac/Android presets report Windows in JS while CDP headers say otherwise | drop the JS override once CDP metadata is complete (verified sufficient for page UAD), or make the getter use the computed platform values and apply it to every page; add a page1-vs-page2 assertion to the e2e suite |
| 12 | **IMPORTANT** — shared-worker `userAgentData` stays native: the launch flag fixes the string, but brands/FVL/platform remain the binary's or empty (verified UA 120 vs brands Chromium/155, FVL empty). Sending `Emulation.setUserAgentOverride` on the `shared_worker` target fixes brands/FVL and the wire `User-Agent` header (not the `navigator.userAgent` string), but **the override reverts when the session is detached** — same for `service_worker` targets. Playwright's `_onAttachedToTarget` handles only page and service_worker; every other target falls through to `session2.detach()`, so shared-worker sessions are dropped | keep the shared-worker session attached after sending the override + `Runtime.runIfWaitingForDebugger`; add cleanup on target detach/context close. This is a second injected core block (more version-fragile than the metadata hook). Unfixable first-party → D1-b |

### Worker UA / metadata findings (2026-11-01, host)

Matrix: szkrabok stack (stealth plugin + persistent context + greasy patch), ungoogled-chromium 155, UA Chrome/120. `FVL` = `getHighEntropyValues().fullVersionList`.

Method: local HTTP server; page registers SW + dedicated + shared worker; each reports `navigator.userAgent`, `userAgentData.brands`, `getHighEntropyValues([...])`; server records `Sec-CH-UA*` headers. Harness: `/tmp/ua-sw-research/probe3.mjs` (raw playwright-core), `probe4.mjs` (szkrabok stealth stack: plugin + persistent context + init script; not full `launch()` path). Results: raw-core `matrix-cft145.json`, `matrix-ungoogled155.json`; szkrabok-stack `szkrabok-matrix.json`. Binaries: ungoogled-chromium 155.0.8059.79, CfT 145.0.7632.46; headless, `--no-sandbox`. Limits: one host, two binaries; no stock-vs-patched table in that pass (added below); worklets/Firefox untested; `/tmp` scripts disposable.

| context | no launch flag | + `--user-agent` |
|---|---|---|
| page 1 (init-script UAD) | UA 120, brands 120, FVL 120 | same |
| page 2 (plugin only) | UA 120, brands 120, **FVL leaks 155.0.8059.79** | UA 120, brands 120, **FVL empty** |
| service worker | **UA HeadlessChrome/155**, brands 120, FVL empty | **UA 120**, brands 120, FVL empty |
| dedicated worker | UA 120, brands 120, **FVL leaks 155** | UA 120, brands 120, FVL empty |
| shared worker | **UA HeadlessChrome/155**, brands 155, platform **Linux** | UA 120, brands 155, platform **Linux** |

Raw-core cross-check: `probe3.mjs` on CfT 145 + ungoogled 155 — same string/brand gaps; FVL leaks in page/dedicated/shared worker without a flag, empty in SW; shared native brands/platform. Matrices: `matrix-cft145.json`, `matrix-ungoogled155.json`.

### Stock vs patched, measured (2026-11-02, host)

Raw playwright-core 1.63.0 (stock = `stripGreasyBrands` copy; patched = installed core), ungoogled-chromium 155.0.8059.79, headless, UA `Chrome/120.0.0.0`, local server; contexts page/dedicated/shared/SW. Harness `/tmp/greasy/probe.mjs`, results `/tmp/greasy/cells.jsonl` (6 cells). Re-run and cell-checked 2026-11-02 in `/tmp/greasy2/rows.jsonl` (the first `/tmp/greasy/` was cleared; both dirs disposable). This is the before/after table the earlier plan lacked.

| cell | page UA | page brands | page FVL | dedicated | SW UA | SW brands | SW FVL | shared UA | shared brands | wire `sec-ch-ua` | wire FVL |
|---|---|---|---|---|---|---|---|---|---|---|---|
| stock, no override | HeadlessChrome/155 | 155 native | 155.0.8059.79 | same | 155 | 155 native | 155.0.8059.79 | 155 | 155 native | 155 | 155.0.8059.79 |
| stock + ctx UA | Chrome/120 | **155 native** | **155.0.8059.79** | same | HeadlessChrome/155 | **empty** | empty | HeadlessChrome/155 | 155 native | **155** | **155.0.8059.79** |
| patched + ctx UA | Chrome/120 | 120 greasy | **155.0.8059.79** | same | HeadlessChrome/155 | 120 greasy | empty | HeadlessChrome/155 | 155 native | 120 | **155.0.8059.79** |
| patched + ctx UA + flag | Chrome/120 | 120 greasy | empty | same | Chrome/120 | 120 greasy | empty | Chrome/120 | 155 native | 120 | empty |
| patched + ctx UA + raw full metadata (page target only) | Chrome/120 | 120 greasy | 120.0.0.0 | same | HeadlessChrome/155 | 120 greasy | empty | HeadlessChrome/155 | 155 native | 120 | 120.0.0.0 |
| patched + ctx UA + flag + raw full metadata | Chrome/120 | 120 greasy | 120.0.0.0 | same | Chrome/120 | 120 greasy | empty | Chrome/120 | 155 native | 120 | 120.0.0.0 |

Row 1 is the 2026-11-02 first pass (not re-run — trivially the no-override baseline); rows 2-6 were cell-checked in the `/tmp/greasy2/` re-run.

Key point: even with brands greasy, the **wire `Sec-CH-UA-Full-Version-List` still leaks the binary build** in the no-flag cells. A server-side detector sees brands 120 and FVL 155 in the same request. The launch flag empties FVL instead of leaking it. Shared worker follows the same pattern: FVL `155.0.8059.79` without the flag, empty with it; dedicated worker follows the page (`same` in the table).

### Extended `calculateUserAgentMetadata` verified (2026-11-02, host)

Experimental copy `/tmp/greasy2/pwcore-full` (same core with the injected block also setting `fullVersion`, `fullVersionList`, `bitness`), same probe; re-verified 2026-11-02 (`/tmp/greasy2/full.jsonl`, labels `full+ctxUA` / `full+ctxUA+flag`). Earlier `/tmp/greasy/pwcore-full` run gave the same result:

- page: UA 120, brands 120, FVL 120.0.0.0, wire FVL 120.0.0.0 — **fixed without extra hooks**.
- dedicated worker: same as page — **fixed**.
- service worker: brands 120, FVL 120.0.0.0 — **fixed** (no `_onAttachedToTarget` hook needed; `CRServiceWorker.updateUserAgent()` calls the same patched function). UA string still `HeadlessChrome/155` without the flag.
- shared worker: native 155 without the flag; with the flag the string is 120 but brands/FVL stay native/empty — **not fixed** by the function extension.
- Worker-target `Emulation.setUserAgentOverride` (puppeteer CDPSession on the worker target) sets brands/FVL and the wire `User-Agent` header in both `shared_worker` and `service_worker`, but **not** `navigator.userAgent` (stays `HeadlessChrome/155` without the launch flag; `Chrome/120` with it). **Both shared and service worker overrides revert on session detach** — re-measured 2026-11-02; the earlier pass only showed shared. A marker set through the session is visible to the page's worker port, so the session targets the same global. Playwright's `_onAttachedToTarget` handles page and service_worker only; other targets fall through to `session2.detach()`, so keeping the session attached is required for the override to persist.

Findings:

- Per-target Emulation does not change the worker's `navigator.userAgent` string; the launch flag does. It does change worker brands/FVL and the wire `User-Agent` header while the session stays attached.
- Brands-only metadata leaves FVL leaking the binary build or empty. Page 1 vs page 2 diverge.
- Extending `calculateUserAgentMetadata` fixes page, dedicated-worker and SW metadata/FVL/headers; only the shared worker needs a separate target hook.
- Shared-worker UAD stays native even with the launch flag unless an Emulation override is kept attached to the target.
- Raw `--user-agent` alone leaves brands native. Combine with context UA + greasy metadata.
- `N.0.0.0` as FVL is internally consistent but not what real Chrome sends (`CAPTURED_145`: Chromium FVL `145.0.7632.46`, GREASE `99.0.0.0`). A detector that rejects `.0.0.0` build suffixes still catches it.

Recommended actions:

1. Add `--user-agent=<effective UA>` to Chromium launch args; replicate plugin `maskLinux` transform. Required for worker UA strings; without it SW/shared stay `HeadlessChrome/…`.
2. Extend greasy metadata: set `fullVersionList`, `fullVersion`, `bitness` in `calculateUserAgentMetadata` and in the plugin's `Network.setUserAgentOverride` interceptor (`withGreasedBrands`); bump marker rev; extend `ua-brands.test.js`. Verified to fix page/dedicated/SW.
3. Unify page 1 vs later pages: drop the JS `navigator.userAgentData` init-script override once CDP metadata is complete (it is redundant and currently hardcodes `platform: 'Windows'`, `platformVersion: '10.0.0'`, `architecture: 'x86'` for every preset — wrong for Mac/Android); or, if kept, use the computed platform values and apply it to every page. Add a page1-vs-page2 assertion.
4. Shared workers: keep the `shared_worker` target session attached after sending `Emulation.setUserAgentOverride` + `Runtime.runIfWaitingForDebugger` (detaching reverts the override; `service_worker` overrides revert too). Playwright's `_onAttachedToTarget` only handles page/service_worker; other targets fall through to `session2.detach()`. Extending it is a second injected block, more version-fragile than the metadata hook. The override changes brands/FVL/header UA but not the worker's `navigator.userAgent` — the launch flag is still required for the string.
5. FVL value: prefer a real build number per preset/milestone (`CAPTURED_145` form) over `N.0.0.0`; ship a milestone→build map or a config field. Otherwise document the `.0.0.0` detection risk.
6. Untested: worklets, Firefox (`general.useragent.override` candidate).

## Sequence

1. P0 — greasy brands as a separate szkrabok patch — **done**
2. W1 — vendored evasions (independent of W2; kills warnings outright)
3. W2 — run V procedure → wire aliases → bump to 1.64.1 base
3b. Alias release: postinstall = `apply-greasy-brands.js` → verify (no patch file exists for the drop-in core, so `apply-patches.js` goes in the same release). Must ship with the reworked rebrowser-aware patch-check: `playwrightCoreRoot()` resolves the drop-in core, and the greasy step follows it automatically. Release note: consumers running specs over CDP add the `overrides` entry; others do nothing
4. W3 — delete the patch-package machinery (greasy postinstall stays)
5. Docs: README install notes, scaffold template, companion handout task 2 (install scripts still required — greasy brands)

## Decisions

| ID | Adopted | Note |
|----|---------|------|
| D8 | greasy brands = szkrabok's own patch, separate from the rebrowser patches; the postinstall keeps only it after W2/W3 | one version; see P0 |
| D2 | fork name `@pablovitasso/playwright-core` | scope proven owned (szkrabok 3.0.0 live under it) |
| D3 | evidence in `docs/verification/` + `verified-core.json` | V step 5 |
| D5 | npm trusted publishing (OIDC) + provenance + `environment: release` gate | fallback-fork publish bullet; binds only if the fork materializes |
| D6 | Firefox imports from `playwright-core` | verified — no `playwright` package needed |
| D7 | keep `npx playwright install chromium` | verified — rebrowser keeps the `playwright` bin |


## Implementation status

Status values: `not started` | `in progress` | `done`

| Item | Status |
|------|--------|
| P0 greasy brands as a separate patch | done (live browser check open) |
| W1 vendored evasions + loader | not started |
| W2 V procedure run (1.64.101) | not started |
| W2 wiring (alias, patch-check, doctor) | not started |
| W3 deletions | not started |
