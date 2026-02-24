# launchPersistentContext + stealth evasion timing issue

## Symptom

Stealth evasions using `onPageCreated` hooks don't apply to the initial page of
`launchPersistentContext`. Affected evasions:

| Evasion | Property | Status |
|---|---|---|
| `user-agent-override` | `navigator.userAgentData` | null — unfixed (see below) |
| `user-agent-override` | `navigator.platform` | fixed via Option B |
| `navigator.hardwareConcurrency` | value | real — init script doesn't fire cross-session |
| `webgl.vendor` | VENDOR/RENDERER | real GPU — init script doesn't fire cross-session |
| `navigator.languages` | value | partial — header fixed, navigator value real |

Working fine: `navigator.webdriver`, `navigator.plugins`, `chrome.*`, `navigator.vendor`.

## Root cause

`launchPersistentContext` creates context + initial page atomically before
playwright-extra's plugin hooks register. `onPageCreated` never fires for that page.
With `launch()` + `newPage()` the hooks fire correctly (standalone test mode).

Upstream refs: puppeteer-extra [#6](https://github.com/berstend/puppeteer-extra/issues/6),
[#323](https://github.com/berstend/puppeteer-extra/issues/323),
playwright [#24029](https://github.com/microsoft/playwright/issues/24029)

## Workarounds attempted

### about:blank navigation — FAILED
`onPageCreated` fires on CDP `Target.targetCreated`, not on page navigation.

### close + context.newPage() — FAILED
`browserContext.newPage()` throws `Protocol error (Target.createTarget): Failed to
open a new tab` on playwright-extra wrapped persistent contexts.

## Option B — manual CDP application (partial fix)

Implemented in `src/core/szkrabok_stealth.js` as `applyStealthToExistingPage()`,
called from `src/upstream/wrapper.js` after `launchPersistentContext`.

### What works
`Network.setUserAgentOverride` — **target-scoped**: persists regardless of which CDP
session drives navigation. Fixes `navigator.platform`, `navigator.userAgent`,
`Accept-Language` header.

### What doesn't work
`Page.addScriptToEvaluateOnNewDocument` — **effectively session-scoped**: scripts
registered via the MCP server's CDP session do not fire when navigations are
initiated from a separate CDP session (the test runner's or MCP tool's Playwright).
Result: `hardwareConcurrency`, `webgl.vendor`, `navigator.languages` remain real.

### navigator.userAgentData — unfixed
`Network.setUserAgentOverride` accepts `userAgentMetadata` (brands, platform, etc.)
but Chrome does not expose it as `navigator.userAgentData` in the page. Rebrowser
flags this. No CDP-only fix known.

### Disabling WebGL — not viable
`--disable-webgl` makes `getContext('webgl')` return `null` — real users never have
this, immediate bot signal. SwiftShader (`--disable-gpu`) exposes a known-bot
renderer string. Current real GPU passthrough with Linux Mesa strings is the least
bad option until init scripts can be applied correctly.

## Current test results (desktop-chrome-win + stealth)

- **Intoli/sannysoft**: 10/10 ✓ — UA/platform spoofing sufficient for these checks
- **Rebrowser**: 7/10 — 3 failures:
  - `useragent` — `navigator.userAgentData` null (no fix)
  - `mainWorldExecution` — Playwright main-world CDP call (needs rebrowser-patches binary patch)
  - `exposeFunctionLeak` — `page.exposeFunction` fingerprint (no fix available)

## Files

- `src/core/szkrabok_stealth.js` — `applyStealthToExistingPage()`
- `src/upstream/wrapper.js` — calls it after `launchPersistentContext` when stealth
- `automation/stealth-config-check.spec.js` — property report (no assertions)
- `automation/intoli-check.spec.js` — sannysoft 10/10 + fp-collect 20/20
- `automation/rebrowser-check.spec.js` — rebrowser 7/10, useragent is the target
