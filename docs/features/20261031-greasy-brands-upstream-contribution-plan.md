# Feature: greasy brands — optional upstream contribution to rebrowser-patches

**Implements:** the greasy-brands patch offered to rebrowser-patches as a public patch
**Depends on:** nothing
**Related:** [20261031-verified-core-and-vendored-evasions-plan.md](./20261031-verified-core-and-vendored-evasions-plan.md) P0 / D8 — greasy brands is szkrabok's own patch and ships independently; nothing in szkrabok waits on this

## Status

Optional. Patch, test suite and issue draft ready; host evidence measured. As of 2026-11-02: worker matrix captured (CfT 145 + ungoogled-chromium 155); stock-vs-patched before/after table measured; extended-metadata fix verified for page/dedicated/SW. rebrowser-patches 1.1.2 (main `00c62cd`, 2026-10-19); drop-ins 1.64.101; upstream playwright-core 1.64.1.

## Facts

### Algorithm (Chromium `components/embedder_support/user_agent_utils.cc`, main, read 2026-10-31)

- `GetGreasedUserAgentBrandVersion`: chars `{" ","(",":","-",".","/",")",";","=","?","_"}` (11), brand `Not{c[s%11]}A{c[(s+1)%11]}Brand`, version `{"8","99","24"}[s%3]` (`+".0.0.0"` in the full-version list)
- `GenerateBrandVersionList`: list `[GREASE, Chromium, <product>]`, then `ShuffleBrandList`: entry i → index `order[i]`, `order = GetRandomOrder(s,3)` (6-permutation table)
- seed `s` = major version → deterministic per major
- szkrabok's port: `packages/runtime/stealth-evasions/ua-brands.js`. Checked against published real-Chrome `Sec-CH-UA` values for 120, 124, 126, 129, 131, 138 (`tests/node/ua-brands.test.js`). The six 3-brand milestone headers are recalled, not captured. The live capture (`CAPTURED_145`, Google Chrome for Testing 145.0.7632.46, Chromium-branded 2-brand build) confirms the GREASE derivation and the `fullVersionList` form; a real Chrome channel capture would settle the 3-brand ordering

- **Worker evidence (2026-11-01, host):** brands-only metadata leaves `fullVersionList` leaking the binary build or empty; SW/shared-worker UA string needs a browser launch flag; shared-worker `userAgentData` stays native. Method: `probe4.mjs` (szkrabok stack) / `probe3.mjs` (raw core); matrices in `/tmp/ua-sw-research/`; binaries ungoogled-chromium 155.0.8059.79 + CfT 145.0.7632.46. Matrix + actions in [20261031-verified-core-and-vendored-evasions-plan.md](./20261031-verified-core-and-vendored-evasions-plan.md) risks 9-12.
- **Measured 2026-11-02, host:** stock-vs-patched 6-cell table (`/tmp/greasy/cells.jsonl`) and extended-metadata verification (`/tmp/greasy/full.jsonl`); cell-checked in a live re-run (`/tmp/greasy2/rows.jsonl`, `full.jsonl`; both dirs disposable). Details in the same plan's "Stock vs patched, measured" and "Extended `calculateUserAgentMetadata` verified" sections. Headline: brands-only metadata leaves the **wire `Sec-CH-UA-Full-Version-List` at the binary build** (brands 120 vs FVL 155.0.8059.79 in the same request); extending the metadata fixes page/dedicated/SW but not the shared worker. Worker-target Emulation fixes brands/FVL/header UA on shared/SW targets but reverts on detach for both, and never changes the worker's `navigator.userAgent` string.

### Stock behavior with a `userAgent` override

`content/browser/devtools/protocol/emulation_handler.cc` `SetUserAgentOverride`: brands / fullVersionList / fullVersion not sent → **the browser's default** lists are used (the binary's own when no `--user-agent` launch flag is set; empty when the flag is set). Playwright's `calculateUserAgentMetadata()` sends no brands, so a UA override reports the binary's own brands: bundled Chromium → `[GREASE, Chromium]` at the binary's major ([rebrowser-patches-research.md](../rebrowser-patches-research.md): only `Chromium/143`), whatever major the UA claims. With a real Chrome channel and UA major == binary major, stock is already right.

### Upstream acceptance

- Every merged PR is by the maintainer (`rebrowsernet`). Outside PRs: doc fixes thanked and closed; #130 (port to 1.63.0) replaced by the maintainer's own automated porting (#131).
- Maintainer stance (issue #63): passing simple UA tests "doesn't mean that it will work for DataDome"; real fix = own Chromium build or their commercial remote browser (rebrowser.net). README leaves "proper user-agent" to the user.
- No issue or PR on brands / userAgentData / Sec-CH-UA in rebrowser-patches.
- → Lead with an **issue** carrying the ready patch and evidence; expect them to re-implement.

### Port shape

- Hook: `calculateUserAgentMetadata` (crPage.ts), also called by `crServiceWorker.ts:110` → pages **and service workers**. Same hook as szkrabok's patch.
- Opt-out `REBROWSER_PATCHES_UA_BRANDS_FIX=0` (matches `REBROWSER_PATCHES_WEBDRIVER_FIX`).
- Skips UAs with ` Edg/` / ` OPR/` (product brand and version scheme not verified).
- Target `patches/playwright-core/1.64.1` only; `playwright-python/1.64.0/build.patch` builds from the patched core, so Python inherits it.
- Their workflow: edit `src.patch`, then `release/port.mjs playwright-core 1.64.1 --regen --write` builds the original and patched trees and regenerates `lib.patch`, verified against the npm tarball. Runs in the sandbox (no browser).

## Contribution plan

| # | Step | Detail | Status |
|---|------|--------|--------|
| 1 | **Algorithm** | port of Chromium's GREASE algorithm (above). Open: one live capture on the host (real Chrome `navigator.userAgentData.brands` + `getHighEntropyValues(['fullVersionList'])`) | done (live capture open) |
| 2 | **Port to their format** | `src.patch` hunk in `calculateUserAgentMetadata` + `lib.patch` via `port.mjs --regen --write`, 1.64.1. Type-check on, original build == npm tarball, tarball + `lib.patch` verified; patched bundle exercised in node (real-Chrome values, Edge skipped, opt-out). Artifact: [20261031-greasy-brands-upstream/](./20261031-greasy-brands-upstream/) (`git am` on main `00c62cd`) | done |
| 3 | **House style** | opt-out env var, `[rebrowser-patches]` comments, README section, suite `uabrands` (controls: unpatched + opt-out; gate: patched page brands == real Chrome 131). Their runner downloads Chrome → host only | done (suite run open) |
| 4 | **Evidence + issue** | before/after brands from the host browser (stock vs patched, UA major ≠ binary major), worker brands, rebrowser-bot-detector. Issue with the patch attached; PR only if the maintainer asks. Draft: [20261031-issue-draft.md](./20261031-greasy-brands-upstream/20261031-issue-draft.md) | not started (draft ready) |
| 5 | **Playwright issue** | `calculateUserAgentMetadata` omits `brands`, so a UA override keeps the binary's brands | not started |

## Open questions

| # | Question | Note |
|---|----------|------|
| Q1 | set `fullVersionList` too? | **Confirmed leak and fix verified (2026-11-02).** Unset leaves the binary build in the JS API and in the wire header (`Sec-CH-UA-Full-Version-List`): measured brands 120 vs FVL 155.0.8059.79 in the same request on ungoogled 155; SW/shared empty. Setting `fullVersionList`/`fullVersion`/`bitness` in `calculateUserAgentMetadata` fixes page, dedicated worker and service worker metadata + headers. The shared worker needs a target hook; a worker-target override fixes brands/FVL/header UA there but reverts on session detach (shared and service worker targets alike). Value choice: `N.0.0.0` is internally consistent but not what real Chrome sends — `CAPTURED_145` has Chromium FVL `145.0.7632.46` and GREASE `99.0.0.0`. Recommend a real build number per preset/milestone; fall back to `N.0.0.0` only when no build is known. Upstream: offer the field as optional and document the reduced-UA tradeoff |
| Q2 | Edge / Opera UAs | skipped in the upstream patch; szkrabok presets have none |

## Risks

| # | Risk | Mitigation |
|---|------|------------|
| 1 | maintainer-only merges, commercial product next door | issue first; szkrabok does not depend on it |
| 2 | Chromium changes the GREASE scheme | algorithm is source-cited; `ua-brands.test.js` pins real-Chrome values per milestone — add milestones on Chrome upgrades |
| 3 | `calculateUserAgentMetadata` moves upstream | port against their `src.patch` TS base with `port.mjs` |
| 4 | brands-only metadata leaves `fullVersionList` leaking the binary build or empty; the wire header leaks it too; page/worker contexts diverge; worker-target overrides revert on session detach (shared and SW) | set `fullVersionList`/`fullVersion`/`bitness` in the patched metadata (verified for page/dedicated/SW); keep the shared-worker target session attached after the override; prefer a real build number over `N.0.0.0`; extend the suite to assert FVL consistency in JS and wire headers; document the reduced-UA tradeoff upstream |

## Where the work runs

| Work | Sandbox | Note |
|------|---------|------|
| source research, clones, GitHub queries | yes | done |
| upstream `src.patch` / `lib.patch` via `port.mjs` | yes | done (~5 min build) |
| their test suite, live captures, bot-detector | no | needs a browser → host, via szkrabok MCP |
| issue / PR on GitHub | technically yes (`gh` logged in) | outward-facing → only on explicit go-ahead |

## Implementation status

Status values: `not started` | `in progress` | `done`

| Item | Status |
|------|--------|
| 1 algorithm port + tests | done (live capture done: CAPTURED_145; worker matrix measured) |
| 2 upstream `src.patch` + `lib.patch` (1.64.1) | done |
| 3 opt-out + README + suite | done (suite run open) |
| 4 evidence + issue | in progress (stock-vs-patched + extended-metadata tables measured; draft needs the measured wire-header leak) |
| 5 Playwright issue | not started |
