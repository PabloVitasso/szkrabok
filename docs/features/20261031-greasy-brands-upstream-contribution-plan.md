# Feature: greasy brands — optional upstream contribution to rebrowser-patches

**Implements:** the greasy-brands patch offered to rebrowser-patches as a public patch
**Depends on:** nothing
**Related:** [20261031-verified-core-and-vendored-evasions-plan.md](./20261031-verified-core-and-vendored-evasions-plan.md) P0 / D8 — greasy brands is szkrabok's own patch and ships independently; nothing in szkrabok waits on this

## Status

Optional. Patch, test suite and issue draft ready; live-browser evidence open. As of 2026-10-31: rebrowser-patches 1.1.2 (main `00c62cd`, 2026-10-19); drop-ins 1.64.101; upstream playwright-core 1.64.1.

## Facts

### Algorithm (Chromium `components/embedder_support/user_agent_utils.cc`, main, read 2026-10-31)

- `GetGreasedUserAgentBrandVersion`: chars `{" ","(",":","-",".","/",")",";","=","?","_"}` (11), brand `Not{c[s%11]}A{c[(s+1)%11]}Brand`, version `{"8","99","24"}[s%3]` (`+".0.0.0"` in the full-version list)
- `GenerateBrandVersionList`: list `[GREASE, Chromium, <product>]`, then `ShuffleBrandList`: entry i → index `order[i]`, `order = GetRandomOrder(s,3)` (6-permutation table)
- seed `s` = major version → deterministic per major
- szkrabok's port: `packages/runtime/stealth-evasions/ua-brands.js`. Checked against published real-Chrome `Sec-CH-UA` values for 120, 124, 126, 129, 131, 138 (`tests/node/ua-brands.test.js`). Those values are recalled, not captured; source and headers agree; a live capture confirms (step 1)

### Stock behavior with a `userAgent` override

`content/browser/devtools/protocol/emulation_handler.cc` `SetUserAgentOverride`: brands / fullVersionList / fullVersion not sent → **the binary's default** lists are used. Playwright's `calculateUserAgentMetadata()` sends no brands, so a UA override reports the binary's own brands: bundled Chromium → `[GREASE, Chromium]` at the binary's major ([rebrowser-patches-research.md](../rebrowser-patches-research.md): only `Chromium/143`), whatever major the UA claims. With a real Chrome channel and UA major == binary major, stock is already right.

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
| Q1 | set `fullVersionList` too? | unset → binary default: consistent only when UA major == binary major. Setting it needs a full version; reduced UAs only carry `N.0.0.0`, which real Chrome never reports there. szkrabok's init-script path uses the UA version (`N.0.0.0`). Decide after the live capture |
| Q2 | Edge / Opera UAs | skipped in the upstream patch; szkrabok presets have none |

## Risks

| # | Risk | Mitigation |
|---|------|------------|
| 1 | maintainer-only merges, commercial product next door | issue first; szkrabok does not depend on it |
| 2 | Chromium changes the GREASE scheme | algorithm is source-cited; `ua-brands.test.js` pins real-Chrome values per milestone — add milestones on Chrome upgrades |
| 3 | `calculateUserAgentMetadata` moves upstream | port against their `src.patch` TS base with `port.mjs` |

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
| 1 algorithm port + tests | done (live capture open) |
| 2 upstream `src.patch` + `lib.patch` (1.64.1) | done |
| 3 opt-out + README + suite | done (suite run open) |
| 4 evidence + issue | not started (draft ready) |
| 5 Playwright issue | not started |
