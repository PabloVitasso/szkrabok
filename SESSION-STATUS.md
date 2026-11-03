# SESSION STATUS — 2026-10-31/11-01 — greasy-brands adoption + zero-install stealth

Resume point: work committed and pushed; `meteo/` stripped from history and re-homed as its own repo. Remaining: optional real-build map for FVL, then W2 wiring/release.

## State (2026-11-03, after commit + history strip)

- HEAD = `cd91492`; branch `main`, **pushed to `origin/main` 2026-11-03 (fast-forward `24dd164..cd91492`, no force)**.
- Committed: `34d2214` greasy-brands core patch (was `adb6b94`, rebased), `5ba3b86` stealth UA-CH/FVL + worker-UA fix, `83940c0` verified-core evidence + plan docs (retires the 20261025 patched-core proposal), `cd91492` claude-docker hardening docs.
- **`meteo/` removed from history**: `3542e50` + `15a8c77` dropped by `git rebase --onto 99db652 15a8c77 main`; the `!meteo/probes/*.png` gitignore negation went with them. No meteo path in any commit on `main`.
- Preserved before the strip: `~/mega/research/meteo/` (WIP, 9.9M; now a git repo on `main` = `91e5599`, history fetched from the bundle, no remote) + `_from-git/` (3 files that existed only in git: `cdp-click.mjs`, `cdp-emulate.mjs`, `cdp-theme.mjs`); meteo-only history bundle `../szkrabok-backups/meteo-history-20261103-210603.bundle` (2 commits, 41 files); full pre-rewrite bundle `../szkrabok-backups/full-pre-rewrite-20261103-210450.bundle`; branch `backup/pre-meteo-strip`.
- `refs/sandbox/greasy-brands-separate` deleted (pointed at the pre-rewrite `adb6b94`). `refs/sandbox/main` (`99db652`) and `refs/sandbox/wip/claude-docker-hardening` untouched.
- Verified after the rewrite: `git diff backup/pre-meteo-strip main -- . ':(exclude)meteo'` = only the 2 `.gitignore` lines; `node --test tests/node/*.test.js` 172/172; `npm run lint` clean.
- Authoritative plans: `docs/features/20261031-verified-core-and-vendored-evasions-plan.md` (P0 done, decisions adopted), `docs/features/20261031-greasy-brands-upstream-contribution-plan.md`. Gated: `docs/features/20261031-greasy-brands-upstream/` (patch + issue draft).

## Done this session

0. **Repoint confirmed**: `session_manage list` → `server.source = /home/jones2/mega/research/szkrabok/src/index.js` (local-dev).
0. **navigator.spec.js e2e run** (2026-11-03, CfT `145.0.7632.46`, UA `Chrome/120.0.0.0`, headless): **1 passed**. Page reports brands `120`, FVL `120.0.0.0`, platform `Windows`/`10.0`, arch `x86`, bitness `64`; `navigator.webdriver=false`. Run used a temp config (`SZKRABOK_CONFIG=/tmp/nav120.toml`) and a fresh `dev` profile — the old `sessions/dev` (ungoogled 155) makes CfT 145 crash on launch (`SIGTRAP`); original profile restored afterwards.
0. **Step 3 implemented (uncommitted)**:
   - `greasy-brands-patch.js`: block now sets `fullVersionList`, `fullVersion`, `bitness` (from the UA's full version) in `calculateUserAgentMetadata`; new second block keeps `shared_worker` sessions attached, sends `Emulation.setUserAgentOverride` + `Runtime.runIfWaitingForDebugger`, cleans up on target detach/disconnect. Marker revs are now static (`rev=2`, `rev=1`) — a hash of `greasedBrands.toString()` is unstable under the Playwright test runner's transform and produced a false "not stealth-patched" warning; `PATCH_MARKERS` now includes `SHARED_WORKER_UA_MARKER`.
   - `launch.js`: Chromium args add `--user-agent=<effective UA>` (mirrors plugin `maskLinux`), so SW/shared-worker UA strings match the page.
   - `stealth.js`: `withGreasedBrands` sets the same three metadata fields; `applyStealthToExistingPage` drops the JS `navigator.userAgentData` init script (hardcoded Windows/10.0.0/x86) and now relies on CDP metadata, with platform-derived `architecture`/`model`/`mobile`.
   - `ua-brands.js`: added `chromeFullVersion`.
   - Tests: `node --test tests/node/*.test.js` → **172/172 pass** (incl. 19 ua-brands, 6 patch markers), `tests/node/runtime/unit.test.js` **17/17**, `npm run lint` clean. Local probe (`/tmp/probe-fvl.mjs`, disposable) on CfT 145 + UA 120: page/dedicated/SW/shared all UA `Chrome/120`, brands `120`, FVL `120.0.0.0`; wire `Sec-CH-UA-Full-Version-List` on page = `120.0.0.0` (binary `145` no longer leaks); worker fetches send UA `120` but no client-hint headers (Chrome behavior, not a leak).
1. meteo move (precondition), branch review + adopt.
2. MCP config repointed: `~/.pi/agent/mcp.json` szkrabok → `node /home/jones2/mega/research/szkrabok/src/index.js` (backup `~/.pi/agent/mcp.json.bak`; old value: `~/szkrabok-local/node_modules/@pablovitasso/szkrabok/bin/szkrabok.js`). **Restart not yet done.**
3. `node_modules/playwright-core` verified patched: `szkrabok:greasy-brands rev=0479b85eb654` + rebrowser markers.
4. `tests/node/ua-brands.test.js` updated with `CAPTURED_145` ground truth → **17/17 pass**. Q1 settled: `fullVersionList` GREASE = `<greaseVersion>.0.0.0`, others full versions. Captured from Google Chrome for Testing 145.0.7632.46 (`~/.cache/puppeteer/chrome/`), native values, no UA overrides. CfT is Chromium-branded (2-brand list) — per-milestone 3-brand headers stay "recalled"; the form is capture-backed.
5. Mismatched-UA check (UA Chrome/120 vs binary 145): `userAgentData.brands` == `greasedBrands(120)` **in page AND service worker** ✓. Scripts: `/tmp/ua-truth/*.mjs` (disposable — recreate if gone; key: puppeteer-core + CfT for capture; playwright `newContext({userAgent})` + localhost SW with `clients.claim()` + controllerchange-wait + fetch-through-SW for the check; `--no-sandbox` + localhost secure-context needed).
6. **W2-V complete**: `rebrowser-playwright-core@1.64.101` = `playwright-core@1.64.1` + public `rebrowser-patches@1.1.2`, bit-identical (tree + hash diff empty; whitelist `package.json`/`README.md` only). sha512 == npm `dist.integrity`. Evidence: `docs/verification/rebrowser-playwright-core-1.64.101.md` + `verified-core.json`.
7. **Worker UA/metadata research measured + re-verified** (2026-11-02, host): 6-cell stock-vs-patched table; extended `calculateUserAgentMetadata` verification; worker-target detach behaviour. Extended metadata fixes page/dedicated/SW brands+FVL+headers; shared worker needs a target hook. Worker-target Emulation fixes brands/FVL/header UA on shared+SW targets but **reverts on session detach for both**, and never changes the worker's `navigator.userAgent` string (launch flag still needed). Wire `Sec-CH-UA-Full-Version-List` leaks the binary build even after the brands fix. `N.0.0.0` FVL is anomalous vs real Chrome (`CAPTURED_145`: Chromium `145.0.7632.46`). Docs updated: verified-core plan (risks 9-12 + measured sections), upstream plan (Q1/status/risk 4), issue draft. Harness/results `/tmp/greasy/` + `/tmp/greasy2/` (`probe.mjs`, `probe-detach2.mjs`, `probe-shared-identity.mjs`, `rows.jsonl`, `full.jsonl`, `d2-noflag.json`, `d2-flag.json`, `pwcore-stock`, `pwcore-full`; both dirs disposable; first cleared).

## Next actions (ordered)

1. Optional: real build numbers for FVL. Current FVL uses the UA's own full version (`120.0.0.0`), which stops the binary leak but still differs from real Chrome (`120.0.6099.x`). Ship a milestone→build map or a config field if that residual matters. Documented in plan risk 10.
2. Plan W2 wiring: alias `"playwright": "npm:rebrowser-playwright@1.64.101"` (its dep = `rebrowser-playwright-core` under own name; do not alias `playwright-core` separately), rework `patch-check.js` resolution (`rebrowserUtilityScriptName` replaces `__pwUs` marker), doctor keeps `npx playwright install` (rebrowser keeps the `playwright` bin). Then W1 (vendored evasions) if still planned → transition release 3b → W3 deletions.
3. Release-gated: after tagging → `scripts/smoke-test.js` (packed tarball with real postinstall chain).
4. User-gated: upstream contribution (posts publicly) — `docs/features/20261031-greasy-brands-upstream/`.

## Open threads / quirks

- **Stealth UA/FVL fix — implemented 2026-11-03 (uncommitted):** the brands-only leak is closed. `calculateUserAgentMetadata` now sets `fullVersionList`/`fullVersion`/`bitness`; `CRBrowser._onAttachedToTarget` keeps `shared_worker` sessions attached and sends the same metadata; `launch.js` adds `--user-agent=<effective UA>` for SW/shared-worker UA strings; `applyStealthToExistingPage` no longer installs the hardcoded-Windows JS UAD script. Probe on CfT 145 + UA 120: page/dedicated/SW/shared all UA `Chrome/120`, brands `120`, FVL `120.0.0.0`; page wire FVL header = `120.0.0.0`, no `145` leak. Residual: FVL is `N.0.0.0`, still anomalous vs real Chrome — needs a milestone→build map or config field (plan risk 10). Marker revs are static now; a hash of `greasedBrands.toString()` is unstable under the Playwright test runner's transform. Note: the `_onAttachedToTarget` hook is version-fragile and optional at inject time — if anchors are absent, `PATCH_MARKERS` reports the block missing rather than failing install.
- **IMPORTANT — old dev profile:** `sessions/dev/profile` was created by ungoogled 155 and makes CfT 145 crash on launch (`SIGTRAP`). Use a fresh profile for CfT e2e runs. Original restored after testing; test-generated copies are in `/tmp/szkrabok-dev-test*` / `/tmp/szkrabok-dev-orig-*`.
- meteo history stripped from `main` (2026-11-03). Old objects stay reachable via `backup/pre-meteo-strip` + reflog until that branch is deleted and `git gc --prune=now` runs — keep the branch until the push is confirmed.
- Ubuntu 24.04: direct Chrome launches need `--no-sandbox` (AppArmor userns).
- szkrabok config from XDG `~/.config/szkrabok/config.toml`; repo-root config ignored (`trustProjectConfig:false`).
- Handoff bundles live at `~/.local/share/claude-docker/git/<sha256(project-path)[0:16]>/handoff/`, not `.git/handoff/`.
- `claude-docker` nested-repo guard: `git-fetch`/`git-adopt` unaffected; container commands need `CLAUDE_DOCKER_ALLOW_NESTED_GIT=1`.

## PR triage (2026-11-03)

Two open PRs, both authored by PabloVitasso, no reviews, **no CI** (`ci.yml.disabled`; only `check-playwright-upgrade.yml` runs, and only on cron/dispatch). Both branched from `24dd164`, 7 commits behind main. GitHub reports `CONFLICTING`/`DIRTY` for both.

- **#9 `fix/chromium-sandbox`** (`chromiumSandbox: true` default, config opt-out `[browser] chromium_sandbox = false`). One conflict, `packages/runtime/launch.js` only: our `5ba3b86` put the `--user-agent` flag inside the same block #9 extracted into `_assembleLaunchOptions`. Mechanical: keep the extraction, move the UA logic into its `else` branch. Verified in a throwaway clone (`/tmp/szk-pr`, deleted): base 172/172, runtime 266 pass/1 skip, hardening 189/189, launch-sandbox 4/4, unit 17/17, lint clean; `_assembleLaunchOptions({userAgent: Linux UA, stealth:true})` still emits `--user-agent=…(Windows NT 10.0; Win64; x64)…`.
- **#10 `fix/test-browser-leaks`** (tree kill + loop-device scan in `tests/node/runtime/helpers.js`). **Stacked on #9**: the branch contains #9's 3 commits. Merges clean on top of the resolved #9. Verified: `devtools-port.test.js` 5/5, and 0 processes with a test `--user-data-dir` after the full runtime suite.

Behaviour risk of #9, measured on this host: resolved browser is the flatpak `ungoogled-chromium` wrapper — sandboxed launch OK. Playwright's **bundled** Chromium aborts with `Chromium sandboxing failed!` (no SUID helper, `apparmor_restrict_unprivileged_userns=1`); `chromiumSandbox:false` launches. Intended fail-closed, but the opt-out is documented only in `docs/architecture.md`: not in `src/tools/templates/szkrabok.config.toml`, not in the runtime test list in `docs/testing.md`, and the failure text is Chromium's own with no pointer to the key. Add those with the merge.

Leftovers: the runtime suite still leaves ~5 `/tmp/szkrabok-clone-*` dirs (dirs, not processes) — pre-existing, not addressed by #10.
