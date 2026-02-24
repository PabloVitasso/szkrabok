# Investigation: stealth state as of 2026-02-24

## What works

- szkrabok uses ungoogled-chromium via flatpak wrapper at `~/.local/bin/ungoogled-chromium`
- `executablePath` read from TOML via `findChromiumPath()`
- `overrideUserAgent` read from TOML via `resolvePreset()`
- TOML default: `overrideUserAgent = true`, `userAgent = "Chrome/145..."`
- `applyStealthToExistingPage` sets correct brands via `Network.setUserAgentOverride`
- `applyStealthToExistingPage` injects `Object.defineProperty(Navigator.prototype, 'userAgentData', ...)` via `Page.addScriptToEvaluateOnNewDocument`
- patch #8 in `patch-playwright.js`: `calculateUserAgentMetadata` now generates greasy brands from Chrome major version — both playwright-core installs are patched
- `navigator-properties` test (`automation/navigator-properties.spec.js`) scrapes whatismybrowser.com and evaluates `userAgentData` directly — useful for main-world verification
- rebrowser-check passes 7/10: dummyFn, sourceUrlLeak, runtimeEnableLeak, navigatorWebdriver, viewport, pwInitScripts, bypassCsp
- `userAgentData.brands` (evaluated in main world via test runner): `[" Not;A Brand", "Google Chrome", "Chromium"]` ✓

## What fails / known issues

### rebrowser `useragent` check (7/10)
The rebrowser bot-detector reads `navigator.userAgentData` in a way that bypasses our
`Object.defineProperty(Navigator.prototype, 'userAgentData', ...)` JS override.
It reports only `{ brand: "Chromium", version: "145.0.7632.6" }` — the binary default.

Root cause: the rebrowser page accesses the native CDP-level userAgentData binding, not
the JS prototype. The `calculateUserAgentMetadata` patch (patch #8) should fix this by
making Playwright's `Emulation.setUserAgentOverride` include correct brands — but
`_updateUserAgent()` is only called when `options.userAgent || options.locale` is set.
When the test runner connects via `connectOverCDP`, those options may be empty depending
on how the test fixture sets up the page context. Needs further investigation.

### `mainWorldExecution` and `exposeFunctionLeak`
rebrowser docs say "no fix available". Permanent failures.

### `navigator.platform` not spoofed
navigator-properties shows `Linux x86_64` instead of `Win32`.
The `user-agent-override` evasion sets platform in CDP but something is overriding it,
or the evasion isn't running for this page. The UA itself is correctly Windows.

### `hardwareConcurrency` showing 16
navigator-properties shows `16` not the TOML-configured `4`.
The `navigator.hardwareConcurrency` evasion or `applyStealthToExistingPage` CDP init
script may not be applying correctly to test-runner-connected pages.

### `getHighEntropyValues.fullVersionList` shows binary brands
`fullVersionList` returns `[{brand:"Chromium",version:"145.0.7632.6"},{brand:"Not:A-Brand",...}]`
— ungoogled-chromium's binary default. Our JS override replaces `brands` and intercepts
`getHighEntropyValues`, but `fullVersionList` is not yet included in the override response
(or the override is not taking effect for this key).

### Selftest headless/$DISPLAY
Selftest spawns `node src/index.js` without `--headless`; TOML has `headless = false` →
Chrome fails without $DISPLAY. Pre-existing issue, not a regression.

## TODO

- [x] Selftest fails without $DISPLAY — fixed: `openSession()` helper in
      `selftest/playwright/fixtures.js` always injects `headless: true`; specs use it
      instead of calling `session.open` directly. Tests are now self-contained and
      independent of the server's TOML. `npm test` passes 3/3 (rebrowser-check is
      automation/, not selftest).
- [ ] Investigate why rebrowser `useragent` still fails despite patch #8 — check whether
      `_updateUserAgent()` is actually called during test runner CDP connect with the
      active session's user agent, and whether `Emulation.setUserAgentOverride` brands
      reach Chrome before the rebrowser check runs
- [ ] Fix `navigator.platform` not spoofed — `Win32` expected, `Linux x86_64` shown;
      check if `applyStealthToExistingPage` platform derivation is correct and whether
      `Emulation.setUserAgentOverride` platform field is being set
- [ ] Fix `hardwareConcurrency` — `16` shown instead of TOML-configured `4`; confirm
      `applyStealthToExistingPage` init script is running on test-runner pages
- [ ] Fix `getHighEntropyValues.fullVersionList` — extend the JS override in
      `applyStealthToExistingPage` to return a correct `fullVersionList` matching the
      greasy brands
- [ ] Auto-detect system Chromium on startup — if `executablePath` is not set in TOML,
      scan known paths (`/usr/bin/google-chrome`, `/usr/bin/chromium`,
      `flatpak run io.github.ungoogled_software.ungoogled_chromium`, etc.) and log a
      suggestion. Playwright bundled binary is "Chrome for Testing" which brands itself
      as automation tooling — a bot signal. Ungoogled-chromium (current default) avoids
      that but still needs greasy brands patch. Regular Google Chrome stable would be
      best for native brands but requires manual install.
- [ ] Commit all changes once the above are resolved (or at a stable checkpoint)
