# Feature: Firefox engine support

## Status: implemented

PR: [#5](https://github.com/PabloVitasso/szkrabok/pull/5). All items in the checklists
below are done unless marked otherwise.

**Stealth verification — what's actually confirmed:** the live test suite
(`tests/node/runtime/firefox-live.test.js`) confirms `navigator.webdriver` is not `true`
on `invisible_playwright`'s patched Firefox (151.0.1, cache dir `firefox-18_*`), versus
stock Playwright Firefox where the same test confirms `navigator.webdriver === true`.
That is the one signal szkrabok's own suite checks. The "Detectability testing note"
below (live anti-bot-service test against bot.sannysoft.com/CreepJS) was scoped out of
this feature deliberately and was never built — `invisible_playwright`'s own upstream
claims (0.90 reCAPTCHA v3, full fingerprint suite) are not independently re-verified
here. Treat "stealth works" as "the automation flag is suppressed and the binary
launches/navigates correctly," not as a verified detection-evasion score.

**Binary version coupling — a real operational gotcha, not covered when this was
written:** both stock Playwright Firefox and invisible_playwright's patched Firefox are
version-pinned to a specific Juggler protocol revision. Bumping `playwright-core` (e.g.
1.61+) can break launches against a stale cached Firefox binary with a protocol schema
mismatch (`Browser.setDefaultViewport` gained an `isMobile` field in Playwright 1.61 —
see [invisible_playwright#48](https://github.com/feder-cr/invisible_playwright/issues/48)).
See [docs/development.md — Refreshing Firefox binaries](../development.md#refreshing-firefox-binaries-after-a-playwright-core-upgrade).

**Fixed during this PR — fresh-profile navigation was broken.** On a cold-start
profile, invisible_playwright/Firefox 150 fires an internal `about:newtab` navigation
shortly after launch that tears down the initial page's browsingContext at the Juggler
protocol level, invisible to Playwright's page/frame tracking. Any `goto()` on that
initial page failed permanently (`browsingContext is undefined` or `interrupted by
another navigation to "about:newtab"`) — meaning `session_manage open({ url })` on a
brand-new Firefox session failed on first use, every time. Retrying `goto()` on the
same page does not recover it; a page created after the internal navigation completes
is unaffected. Fixed in `packages/runtime/launch.js` by swapping the initial page for
a freshly created one immediately after `launchPersistentContext()`, before any caller
gets a reference to it. Verified 5/5 on fresh profiles after the fix (was 0/5 before).

## Goal

Add Firefox as a first-class browser engine alongside Chromium. A session opened with
`engine = "firefox"` launches a caller-supplied Firefox binary (e.g. the C++-patched
binary from `invisible_playwright` or Camoufox) instead of the system Chromium. The
JS stealth layer is bypassed entirely — evasion is handled at the C++ level by the
binary.

## Background

### Why the current stealth approach has a ceiling

`stealth.js` injects JavaScript overrides via `playwright-extra` and CDP
`addInitScript` calls. JS-level patching is detectable: anti-bot tools enumerate
native function `.toString()`, check property descriptor configurability, and compare
prototype mutation order. Modern detectors (CreepJS, FingerprintJS Pro) have dedicated
"lie detector" batteries targeting exactly this class of patches.

Additionally, Chromium-shaped traffic is weighted as risky by residential-proxy
detectors regardless of stealth: Chrome ships closed-source components (Widevine,
Safe Browsing endpoints) that flip detectable feature flags, and Chromium forks lag
Chrome's release cadence by days to weeks, leaving version-specific signals that
detectors lock on to.

### Source-patched Firefox

Browsers that apply stealth at the C++ level avoid both problems. The spoofed values
come back through normal browser paths — from the page's point of view the browser is
telling the truth, so lie-detectors have nothing to latch onto.

Two actively maintained source-patched browsers exist today:

| | [invisible_playwright](https://github.com/feder-cr/invisible_playwright) | [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) |
|---|---|---|
| Engine | Firefox 150 | Chromium |
| Language | Python | Node.js |
| Patch source | Published (MPL-2.0) | Closed |
| reCAPTCHA v3 | **0.90** | ~0.3–0.5 |
| CreepJS lies | 0 | 0 |

invisible_playwright is the stronger option for stealth quality and open-source
alignment. The patches are published at `feder-cr/invisible_firefox` and the binary is
reproducible. CloakBrowser publishes no patches.

### Integration approach

invisible_playwright ships a Firefox binary. szkrabok needs to be able to launch an
arbitrary Firefox binary via `playwright.firefox.launchPersistentContext()` and manage
it through the existing session lifecycle. The JS stealth layer disappears for Firefox
sessions — it is both unnecessary and incompatible (CDP is Chromium-only).

## Engine capability matrix

This table drives which code paths are conditional:

| Capability | Chromium | Firefox |
|---|---|---|
| `launchPersistentContext()` | Yes | Yes (`firefoxUserPrefs` option) |
| `launchServer()` + `wsEndpoint()` | Yes | Yes |
| `connectOverCDP(endpoint)` | Yes | **No** — CDP does not exist in Firefox |
| `browser.connect(wsEndpoint)` | Yes | Yes (Playwright protocol, not CDP) |
| CDP attach for `browser_run_test` | Yes | **No** |
| JS stealth layer | Yes | **Skip** — binary handles it |
| `--remote-debugging-port` flag | Yes | **No** — no CDP socket |

`connectOverCDP()` is documented as Chromium-only in Playwright. Firefox exposes no CDP
endpoint. There is no Playwright CDP equivalent for Firefox in scope.

## Proposed changes

### 1. Config: `[browser]` section

New top-level TOML section:

```toml
[browser]
engine = "firefox"           # "chromium" (default) | "firefox"
executable_path = ""         # absolute path; empty = auto-resolve (§2)
```

`buildConfig()` in `packages/runtime/config.js`:

```js
const browserToml = toml.browser ?? {};
// ...
browserEngine:   browserToml.engine         ?? 'chromium',
executablePath:  browserToml.executable_path
               ?? toml.default?.executablePath
               ?? null,
```

The existing `default.executablePath` fallback is preserved; no existing configs break.
`stealthEnabled` and the entire `[puppeteer-extra-plugin-stealth]` section are silently
ignored when `engine = "firefox"` — document in `architecture.md`.

### 2. Firefox binary auto-resolution (`resolve.js`)

When `engine = "firefox"` and `executable_path` is empty, search in order:

1. `INVISIBLE_PLAYWRIGHT_BINARY` env var (absolute path, checked first)
2. invisible_playwright cache dir — glob `firefox-*/firefox` (Linux) or
   `firefox-*\firefox.exe` (Windows), pick lexicographically latest version tag:
   - Linux: `~/.cache/invisible-playwright/`
   - Windows: `%LOCALAPPDATA%\invisible-playwright\`
   - macOS: `~/Library/Caches/invisible-playwright/` (not currently supported by
     invisible_playwright itself, included for completeness)
3. System Firefox: `which firefox` / `where firefox.exe`

On not found: throw `BrowserNotFoundError` with a diagnostic listing all checked
paths, matching the existing Chromium error style. Chromium resolution is unchanged.

### 3. Launch: conditional engine branch (`launch.js`)

`launch.js` currently imports `chromium` at module top. Change to resolve the
Playwright `BrowserType` object from config:

```js
import { chromium, firefox } from 'playwright';

const browserTypeFor = engine => engine === 'firefox' ? firefox : chromium;
```

For Firefox sessions, `_launchPersistentContext` changes:

- Use `firefox.launchPersistentContext(userDataDir, launchOptions)` instead of
  `chromium.launchPersistentContext`
- Pass `firefoxUserPrefs: {}` explicitly (empty — the stealth binary has its prefs
  baked in; injecting our own would override them)
- **Skip** `enhanceWithStealth()` and `applyStealthToExistingPage()` entirely
- **Remove** `--remote-debugging-port` injection from `launchOptions.args`
  (no CDP socket on Firefox)
- Store `cdpPort: null` in the pool entry

The `headless` option behaves differently on Firefox: Playwright's `headless: true`
puts Firefox on a separate rendering code path that is detectable by anti-bot systems.
When using a stealth binary, `headless: false` is strongly recommended, with an `Xvfb`
instance on headless Linux environments (`DISPLAY=:99 Xvfb :99 &`). Document this in
`docs/architecture.md`; szkrabok does not manage Xvfb (see §Constraints).

### 4. Pool and sessions: `cdpPort` nullable, `browserEngine` added

`pool.add()` and `sessions.js` already hold `cdpPort` without a null guard. Make the
contract explicit and add `browserEngine`:

```js
// pool.add signature change (cdpPort now null for Firefox)
export const add = (id, context, page, cdpPort, browserEngine, ...) =>
  sessions.set(id, { context, page, cdpPort, browserEngine, ... });
```

`getSession()` / `listRuntimeSessions()` — `cdpPort` can be `null`; no loop
changes required. `browserEngine` is surfaced in `session_manage list` and `info`
responses so callers can detect the engine without probing for `cdpEndpoint`.

### 5. Session info: `cdpEndpoint` omitted for Firefox

`szkrabok_session.js` currently always returns `cdpEndpoint`. Change to conditional:

```js
const info = {
  sessionName,
  browserEngine: session.browserEngine,
  ...(session.browserEngine === 'chromium'
    ? { cdpEndpoint: `http://localhost:${session.cdpPort}` }
    : {}),
  // ... rest unchanged
};
```

Absence of `cdpEndpoint` is the signal. No sentinel `null` value — omission is
unambiguous and avoids callers constructing broken URLs.

### 6. `EngineNotSupportedError`: named error for Chromium-only operations

Add `EngineNotSupportedError` to `packages/runtime/errors.js`:

```js
export class EngineNotSupportedError extends Error {
  constructor(operation, engine, reason) {
    super(`${operation} requires Chromium (current engine: ${engine}). ${reason}`);
    this.name = 'EngineNotSupportedError';
    this.code = 'ENGINE_NOT_SUPPORTED';
    this.operation = operation;
    this.engine = engine;
  }
}
```

This follows the existing error class pattern in `errors.js` and gives callers a
stable `code` to branch on. Re-exported from `packages/runtime/index.js`.

### 7. `browser_run_test`: `EngineNotSupportedError` for Firefox sessions

`szkrabok_browser.js` checks `session.cdpPort` and errors if absent. Replace with a
typed throw:

```js
if (session.browserEngine === 'firefox') {
  throw new EngineNotSupportedError(
    'browser_run_test',
    'firefox',
    'CDP attach is not available on Firefox. Use browser_run for direct page automation.',
  );
}
```

`browser_run` and `browser_scrape` operate directly on `page` and are
engine-agnostic — no change required.

### 8. `connect()`: Chromium-only, documented

`packages/runtime/launch.js` exports `connect(cdpEndpoint)` which calls
`chromium.connectOverCDP()`. Add a JSDoc note and leave the implementation unchanged:
this function is for the Chromium CDP path only. No `firefox.connect()` path is added
in this phase — reconnecting to a persistent-context session via WebSocket requires
switching the session lifecycle to `launchServer()`, which is deferred (§Phase 2).

### 9. `headless: true` warning for Firefox

Playwright's `headless: true` sends Firefox down a different rendering code path
(no widget tree, software-only compositing) that anti-bot systems detect. Stealth
binaries only deliver their benefit in headed mode with a real rendering pipeline.

When `engine = "firefox"` and the resolved `headless` value is `true`, emit a
structured warning at launch time:

```js
if (engine === 'firefox' && effectiveHeadless) {
  log('WARNING: headless:true with Firefox uses a detectable rendering path. ' +
      'For stealth use, set headless:false and provide a DISPLAY (Xvfb on Linux).');
}
```

The warning does not block launch — callers may have a legitimate reason (e.g.
functional testing without stealth concern). The goal is surfacing the footgun, not
enforcing policy.

## User setup

```bash
pip install git+https://github.com/feder-cr/invisible_playwright.git
python -m invisible_playwright fetch          # one-time ~100 MB download
python -m invisible_playwright path           # prints resolved binary path
```

`szkrabok.config.toml`:

```toml
[browser]
engine = "firefox"
# executable_path = ""   # leave empty; auto-resolved from invisible_playwright cache
```

Or use the env var: `INVISIBLE_PLAYWRIGHT_BINARY=/path/to/firefox`.

For headless Linux environments:

```bash
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99
```

## Constraints and non-goals

- **No fingerprint configuration from szkrabok.** invisible_playwright's seed/pin/prefs
  API is Python-only. Fingerprint tuning happens outside szkrabok; the binary is
  launched as-is. Users needing a deterministic seed must run a Python pre-launch step.
- **No Xvfb management.** szkrabok does not spawn or manage virtual displays. Users on
  headless Linux are responsible for providing a `DISPLAY`.
- **`browser_run_test` unsupported for Firefox** in this phase. CDP attach is the
  current mechanism and has no Firefox equivalent. See Phase 2 below.
- **No per-session engine override.** `engine` is a process-level config setting.
  Mixing Chromium and Firefox sessions in the same MCP server is Phase 2.
- **No Camoufox-specific handling.** Camoufox is a different patched Firefox binary
  but is architecturally identical from szkrabok's perspective — just point
  `executable_path` at it. No special code required.
- **WebKit not in scope.**

## Phase 2 (not in scope here, recorded for continuity)

- **Per-session engine**: Allow `engine` as a per-`session_manage open` parameter so
  Chromium and Firefox sessions can coexist in one server. Requires both binary
  resolution paths to run at startup.
- **`browser_run_test` for Firefox via `launchServer()`**: Switch Firefox sessions from
  `launchPersistentContext()` to `launchServer()` + `connect()`. The server's
  `wsEndpoint` can then be passed to the test subprocess, and the test script connects
  via `playwright.firefox.connect(wsEndpoint)`. Session persistence would need a
  separate mechanism (snapshot/restore of profile dir). Non-trivial; deferred.
- **Xvfb lifecycle management**: Auto-start/stop Xvfb when `engine = "firefox"` and
  `headless = true` on Linux, mirroring invisible_playwright's own behaviour.

## Definition of done

### Code

- [ ] `[browser] engine` and `[browser] executable_path` parsed in `config.js`;
      `browserEngine` and `executablePath` present on the config object;
      `default.executablePath` fallback preserved
- [ ] `EngineNotSupportedError` added to `errors.js`, exported from `packages/runtime/index.js`
- [ ] `resolve.js`: Firefox auto-discovery (env var → invisible_playwright cache glob →
      system `which`) on Linux and Windows; `BrowserNotFoundError` with all-paths
      diagnostic when nothing found; Chromium path and all existing tests unchanged
- [ ] `launch.js`: `browserTypeFor(engine)` helper; Firefox branch skips
      `enhanceWithStealth` and `applyStealthToExistingPage`, skips `--remote-debugging-port`
      injection, passes `firefoxUserPrefs: {}`, stores `cdpPort: null` in pool;
      `headless: true` + `engine: "firefox"` emits structured warning via `log()`
- [ ] `pool.js` / `sessions.js`: `browserEngine` field stored alongside `cdpPort`;
      `cdpPort` documented (JSDoc) as `number | null`
- [ ] `szkrabok_session.js`: `cdpEndpoint` omitted (not set to `null`) for Firefox
      sessions; `browserEngine` included in all info and list responses
- [ ] `szkrabok_browser.js`: `browser_run_test` throws `EngineNotSupportedError` for
      Firefox sessions; `browser_run` and `browser_scrape` unchanged
- [ ] `connect()` JSDoc marks it Chromium-only

### Tests: updated existing

- [ ] `tests/node/contracts.test.js` — Invariant 6 text/label updated from
      "browser resolution" to "Chromium/Firefox resolution"; contract logic unchanged
      (still enforces `resolve.js` as single entry point, still rejects direct resolve
      imports in MCP tools)
- [ ] `tests/node/session_run_test.test.js` — `SESSION_OPEN` stub gains
      `browserEngine: 'chromium'`; add a parallel stub with `browserEngine: 'firefox'`
      and assert the `EngineNotSupportedError` path
- [ ] `tests/node/config-values.test.js` — existing defaults test gains assertion that
      `cfg.browserEngine === 'chromium'`

### Tests: new node tests

- [ ] `config-values.test.js`: `[browser] engine = "firefox"` parses to
      `browserEngine: 'firefox'`; `[browser] executable_path` overrides
      `default.executablePath`; unknown engine value rejected at parse time or falls
      back to `'chromium'` (document the chosen behaviour)
- [ ] `errors.test.js` (or inline in `basic.test.js`): `EngineNotSupportedError`
      construction — `name`, `code`, `operation`, `engine` fields; exported from
      `packages/runtime/index.js`
- [ ] `resolve.test.js` — new Category 17: Firefox resolution
    - `INVISIBLE_PLAYWRIGHT_BINARY` env var → used directly (does not stat the path in
      unit test; integration confirms it)
    - invisible_playwright cache dir contains `firefox-5/firefox` and `firefox-7/firefox`
      (mocked fs) → `firefox-7/firefox` returned (lexicographic latest)
    - cache dir absent, system `which` returns a path → that path returned
    - all paths miss → `BrowserNotFoundError`; error message contains all checked paths
    - Chromium resolution categories 1–16 unaffected (run unchanged)
- [ ] `launch.test.js` (or `runtime/pc-layer*.test.js`): `_launchPersistentContext`
      with `engine: 'firefox'`
    - `enhanceWithStealth` not called
    - `applyStealthToExistingPage` not called
    - `firefoxUserPrefs: {}` present in captured launch options
    - `--remote-debugging-port` absent from `args`
    - `cdpPort` is `null` in pool entry after launch
    - `headless: true` + `engine: 'firefox'` triggers warning log (spy on `log()`)
    - `headless: false` + `engine: 'firefox'` does not trigger warning
- [ ] `session-info.test.js` (or inline): `session_manage info` / list response shape
    - Chromium session: `cdpEndpoint` present, `browserEngine: 'chromium'`
    - Firefox session: `cdpEndpoint` absent (key not present), `browserEngine: 'firefox'`
- [ ] `browser-run-test.test.js`: Firefox session → `browser_run_test` throws
      `EngineNotSupportedError` with `code: 'ENGINE_NOT_SUPPORTED'`; error message
      references `browser_run` as the alternative

### Tests: new integration / e2e

- [ ] `tests/playwright/integration/firefox-session.spec.js` — skipped when Firefox
      binary not present (check `INVISIBLE_PLAYWRIGHT_BINARY` or invisible_playwright
      cache; `test.skip` with clear message if absent):
    - `session_manage open` with `engine: "firefox"` succeeds
    - `browser_run` navigates `https://example.com`; page title returned
    - `session_manage info` response has `browserEngine: "firefox"` and no `cdpEndpoint`
    - `browser_run_test` returns error with `ENGINE_NOT_SUPPORTED`
    - `session_manage close` succeeds

- [ ] `tests/playwright/e2e/firefox-headless-warning.spec.js` — skipped when Firefox
      binary not present; **headed mode only** (not suitable for CI without Xvfb):
    - Launch Firefox session with `headless: true`; assert log output contains the
      headless warning string
    - Launch Firefox session with `headless: false`; assert warning absent
    - *(This test verifies the warning code path fires, not browser detectability itself —
      see note below)*

### Detectability testing note

Whether `headless: true` is actually detectable by anti-bot systems cannot be covered
by a unit or integration test without hitting a live detection service (CreepJS,
FingerprintJS Pro, bot.sannysoft.com). The parallel to the existing
`tests/playwright/e2e/rebrowser.spec.js` and `intoli.spec.js` pattern would be:

```
tests/playwright/e2e/firefox-stealth.spec.js   # Firefox + headless:false + Xvfb
  - navigate to https://bot.sannysoft.com/
  - assert no "headless" flags in results
  - assert no automation signals detected
```

This test is environment-dependent (requires Xvfb + patched Firefox binary), slow, and
hits a live site. It belongs in the `e2e` project alongside `rebrowser.spec.js`, gated
by `test.skip` when the Firefox binary is absent. It is listed here as the correct
future placement but is not required to close this feature — the stealth guarantee
comes from the binary, not from szkrabok's code.

### Documentation

- [ ] `docs/architecture.md`: `[browser]` config section, `browserEngine` field,
      CDP-only features table, headless/Xvfb warning, `[puppeteer-extra-plugin-stealth]`
      ignored for Firefox
- [ ] `npm run test:node` green with all new and updated node tests
