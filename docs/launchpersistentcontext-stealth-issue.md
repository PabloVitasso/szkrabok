# launchPersistentContext + stealth evasion timing issue

## Symptom

Stealth evasions using `onPageCreated` hooks don't apply to the initial page of
`launchPersistentContext`. Affected evasions:

| Evasion | Property | Expected | Actual |
|---|---|---|---|
| `user-agent-override` | `navigator.userAgentData` | spoofed brands/platform | `null` |
| `user-agent-override` | `navigator.platform` | `Win32` | `Linux x86_64` |
| `navigator.hardwareConcurrency` | value | `4` | real (16) |
| `webgl.vendor` | VENDOR/RENDERER | `Intel Inc.` | real GPU |
| `navigator.languages` | value | `["en-US","en"]` | `["en-US"]` |

Working fine: `navigator.webdriver`, `navigator.plugins`, `chrome.*`, `navigator.vendor`.

## Root cause

`launchPersistentContext` creates context + initial page atomically before
playwright-extra's plugin hooks register. `onPageCreated` never fires for that page.
With `launch()` + `newPage()` the hooks fire correctly.

Upstream refs: puppeteer-extra [#6](https://github.com/berstend/puppeteer-extra/issues/6),
[#323](https://github.com/berstend/puppeteer-extra/issues/323),
playwright [#24029](https://github.com/microsoft/playwright/issues/24029)

## Workarounds attempted

### about:blank navigation — FAILED
`onPageCreated` fires on CDP `Target.targetCreated`, not on page navigation.
Navigating the existing page doesn't help.

### close + context.newPage() — FAILED
`browserContext.newPage()` throws `Protocol error (Target.createTarget): Failed to
open a new tab` on playwright-extra wrapped persistent contexts.

## Option B — manual CDP application

Implemented in `src/core/szkrabok_stealth.js` as `applyStealthToExistingPage()`,
called from `src/upstream/wrapper.js` after `launchPersistentContext`.

Uses only public APIs:
- `page.context().newCDPSession(page)` — stable public Playwright API
- `Network.setUserAgentOverride` — sets userAgent + full userAgentMetadata (brands
  via greasy-brand algorithm, platform, platformVersion, architecture)
- `Page.addScriptToEvaluateOnNewDocument` — registers init scripts for
  hardwareConcurrency, navigator.languages, webgl.vendor — runs before page JS
  on every future navigation

## Open question — session scope

**Unconfirmed**: whether `Network.setUserAgentOverride` and
`Page.addScriptToEvaluateOnNewDocument` are scoped to the CDP session (removed on
`client.detach()`) or to the browser target (persist after detach).

Testing showed evasions still not applying with `client.detach()`. Removed detach
— awaiting retest after MCP restart.

If session-scoped: CDP session must be kept alive (no detach) for the lifetime of
the page. Chrome cleans it up on page close.

If target-scoped: detach is safe and the current approach should work.

## Files

- `src/core/szkrabok_stealth.js` — `applyStealthToExistingPage()`
- `src/upstream/wrapper.js` — calls it after `launchPersistentContext` when stealth
- `automation/stealth-config-check.spec.js` — verification test (JSON report, no assertions)
- `automation/rebrowser-check.spec.js` — real-world check (useragent check is the target)
