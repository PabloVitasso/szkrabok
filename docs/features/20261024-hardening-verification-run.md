# Hardening verification run — 2026-10-24

Full run of the verification plan against `wip/claude-docker-hardening` @ `ba07d84`
("test: hardening suite in npm test; fix env-mutation check leaking values").
Host machine (not the container), Node v24.13.1, npm ci from clean lockfile.

## Summary

| Step | Command | Result |
|---|---|---|
| 1 Setup | `npm ci` | pass (postinstall patches applied) |
| 1 Setup | `npx szkrabok doctor` (local 2.1.5) | All checks passed — Chromium found |
| 2 Lint | `npx eslint .` (plain) | **exit 0** — no ignore needed, see D1 |
| 3 Node | `node --test tests/node/*.test.js` | 127/128 — 1 fail, see D2 |
| 3 Node | `npm run test:hardening` | **180/180** — plan expected 179/180, see D3 |
| 3 Node | `npm run test:runtime:unit` | 17/17 |
| 3 Node | `npm run test:runtime:integration` | 3/3 |
| 4 Playwright | `npx playwright test --project=integration` | **exit 0** — 32 passed, 6 skipped, 0 failed (1.2m), first run ever |
| 5 e2e | `npm run test:auto` | 3 passed, 3 failed — all 3 failures explained below, none is a code regression |

## Discrepancies vs the plan

**D1. The lint claim does not reproduce.** Plain `npx eslint .` exits 0 without the
`--ignore-pattern`. `INVALID` is used (`run-test-env-v2.test.js:46`,
`invalidField` calls it); no unused variable exists since commit `ba07d84`.
The step-2 workaround is unnecessary; `npm test`'s lint stage passes.

**D2. The 128/128-vs-127 expectation is right on count, wrong on cause.**
The one failure is `firefox-engine-guard.test.js:111`
("open() response includes browserEngine: firefox") and it is **not** missing
Firefox:

```
TypeError: page.on is not a function
    at watchPage (src/tools/nav_guard.js:33)
    at installNavGuard (src/tools/nav_guard.js:56)
    at src/tools/szkrabok_session.js:141
```

The nav guard calls `page.on` on the test's mock page, which has no `on`
method. Deterministic — it fails the same way with Firefox installed. Expected
127/128 until nav guard or mock is fixed. See R1.

**D3. 179/180 is stale.** The v2 F8 test was fixed in `ba07d84` (key-name-only
comparison of `process.env`, values never printed — this is also the fix for
the GH_TOKEN leak). The hardening suite is fully green: 180/180.

## Step 4 — Playwright integration, first run

32 passed, 6 skipped, 0 failed. Per-spec passed counts:

| Spec | Passed | Notes |
|---|---|---|
| scrape.spec.js | 15 | fixtures via `setContent`; see R2 |
| session.spec.js | 5 | nav guard active in every session |
| session_run_test.spec.js | 4 | new argv builder, reports under `reports/<session>/` |
| browser-run.spec.js | 3 | Node form through `--allow-node-code` |
| config-mcp-roots.spec.js | 2 | now asserts MCP-root config is ignored — D8 verified live |
| stealth.spec.js | 1 | |
| tools.spec.js | 1 | |
| interop.spec.js | 1 | 1 skipped (playwright-mcp attach) |

Skipped (6): 4 × firefox-engine.spec.js (needs Firefox binary), 1 ×
scaffold-smoke.spec.js ("browser_run_test uses CDP path in sk-skills project"),
1 × interop.spec.js (playwright-mcp attach).

**R2 (watch item).** 15 logged `page.setContent: Timeout 30000ms exceeded`
errors inside scrape.spec.js runs, yet all tests pass and each affected test
takes ~31s — consistent with the 30s setContent timeout being hit and the spec
recovering. Investigate why `setContent` waits for "load" and times out; it is
the slowest part of the suite.

## Step 5 — e2e, 3 passed / 3 failed

None of the three is a regression from the hardening changes.

| Spec | Failure | Root cause |
|---|---|---|
| example-com.spec.js:8 | `h1` not found, expected "Example Domain" | **Stale spec vs live site.** Verified by curl: live example.com serves 0 `<h1>` elements; `<title>` is still "Example Domain" (the title assertion passes). The page snapshot in `error-context.md` shows only paragraphs + "Learn more" link |
| rebrowser.spec.js:75 | expected 8/10 checks, received **9** | **Better than expected.** One entry of `KNOWN_FAILURES` now passes; the assertion pins an exact count. Stale expectation list |
| rebrowser-mcp.spec.js:36 | expected 8/10, received **9** | Same as above, via MCP |

## Open items

| # | Item | Severity | Blocks |
|---|---|---|---|
| R1 | nav_guard crashes on mock pages (`page.on is not a function`, `nav_guard.js:33`) — fix: stub `on` in the mock or guard the call (`page.on?.(...)`) | medium — test-only surface, but deterministic | `npm test` full green |
| R2 | `setContent` 30s timeouts ×15 in scrape specs (tests pass, suite slow) | low | nothing |
| R3 | e2e expectation drift: example.com `h1` selector, rebrowser `KNOWN_FAILURES` exact-count assertions | low | `npm test` full green |

With R1 fixed and R3 updated, `npm test` is expected to run green end to end
(lint is already clean, hardening 180/180, runtime 20/20, integration 32/32).
