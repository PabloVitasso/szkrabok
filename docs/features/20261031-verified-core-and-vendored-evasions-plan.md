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
