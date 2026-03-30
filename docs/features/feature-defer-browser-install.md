# Feature: Defer browser install from postinstall to runtime

## Goal

Cold `npx @pablovitasso/szkrabok` should start instantly. Chromium download must not
block MCP server startup. Browser resolution is a runtime concern, not an install-
time concern.

---

## Design model: fail-fast explicit

This is **not** a replica of Playwright's behavior. Playwright wraps sometimes
auto-resolve browsers. Szkrabok chooses a stricter contract:

- **Fail deterministically** at runtime with actionable instructions
- **Never auto-download** — user controls the 200MB decision
- **Resolution is inspectable** — structured output, not guesswork
- **Install-time and runtime are decoupled** — patches vs binary

---

## Problem analysis

### Current postinstall chain

```
npx @pablovitasso/szkrabok
  -> npm install
     -> postinstall:
         1. apply-patches.js          (~1-2s)
         2. verify-playwright-patches  (~1s)
         3. postinstall.js             (~30-120s, downloads ~200MB)
  -> MCP server starts
```

Cold `npx` (no cache) forces a ~200MB Chromium download before the user sees
anything. This violates the principle that package installation and runtime
capability resolution are separate concerns.

### Why this is wrong for npx-based tooling

| Concern         | Current                                      | Problem                                     |
| --------------- | -------------------------------------------- | ------------------------------------------- |
| Install time    | 60-120s on cold start                        | Blocks all usage, even non-browser CLI      |
| User control    | None                                         | Silent download, no opt-out without env var |
| npx cache       | Download runs every cold npx                 | Wastes time if user has system Chrome       |
| CI/airgapped    | Needs `SZKRABOK_SKIP_BROWSER_INSTALL`        | Wrong default; should skip by default       |
| Browser needed? | Not for `doctor`, `session list`, `endpoint` | Download is wasted                          |

### Patching vs Chromium (independent concerns)

Patches modify **JavaScript source files** inside `node_modules/playwright-core/`:
`crConnection.js`, `crDevTools.js`, `crPage.js`, `utilityScriptSource.js`, etc.
These are CDP protocol layer changes. They do not touch the Chromium binary.

Chromium is a separate binary downloaded by Playwright's installer to
`~/.cache/ms-playwright/`. Zero overlap with patching.

```
postinstall 1-2 (patches)  -> modifies JS in node_modules  -> NO browser needed
postinstall 3 (chromium)   -> downloads binary             -> browser needed
```

---

## Target behavior

```
npx @pablovitasso/szkrabok
  -> npm install
     -> postinstall:
         1. apply-patches.js          (~1-2s, required)
         2. verify-playwright-patches  (~1s, required)
  -> MCP server starts instantly (< 5s)

First browser-dependent tool call (session_manage open, browser_run_test, etc.)
  -> resolveChromium()
     -> valid candidate found?  -> proceed
     -> no valid candidate?     -> hard fail + structured error

User decides:
  1. szkrabok install-browser         -- managed Chromium via Playwright
  2. CHROMIUM_PATH=/path/to/chrome    -- system Chrome (env var, highest priority)
  3. executablePath in config.toml    -- persistent config
```

### Anti-patterns (rejected)

- **Silent auto-download on first run** — violates user expectation, unpredictable
- **Download in postinstall** — breaks npx, CI, airgapped setups
- **Bundling Chromium** — bloats npm tarball, breaks portability
- **False-positive resolution** — path exists but binary is broken or incompatible

### Invariants (testable)

Each invariant has a corresponding test in `tests/node/runtime/resolve.test.js`.

1. **I1 — npx has no browser side-effects** — postinstall does not create
   `~/.cache/ms-playwright` or trigger network calls
2. **I2 — browser absence fails deterministically** — `checkBrowser()` throws
   `BrowserNotFoundError` with structured candidates, never a raw crash or hang
3. **I3 — core CLI works without browser** — `doctor`, `session list`, `endpoint`,
   `--version` exit 0 when no Chromium is installed
4. **I4 — resolution precedence is strict** — `ENV > CONFIG > SYSTEM > PLAYWRIGHT`;
   first valid candidate wins, lower-priority candidates are never probed
5. **I5 — every candidate is validated** — exists, isFile, isExecutable; invalid
   candidates are rejected with a reason string
6. **I6 — no implicit install at runtime** — calling `session_manage open` with no
   browser triggers zero downloads; only an error is returned
7. **I7 — doctor exposes full candidate chain** — output includes pass/fail status
   and failure reason per candidate, not just the winner

---

## Resolution chain

### Strict precedence

```
1. CHROMIUM_PATH env var          -- explicit override, highest priority
2. config.executablePath          -- szkrabok.config.toml setting
3. chrome-launcher                -- system Chrome installation
4. playwright.chromium            -- Playwright-managed cache
```

### Validation contract

Each candidate must pass all three checks:

1. **Exists** — `fs.existsSync(path)`
2. **Is file** — `fs.statSync(path).isFile()`
3. **Is executable** — `fs.accessSync(path, fs.constants.X_OK)`

A candidate that fails any check is skipped. The reason is recorded in the
candidate result (used by `doctor` and error messages).

### CDP version risk

Playwright pins `playwright-core` to an exact version. The Playwright-managed
Chromium is guaranteed compatible. System Chrome is not.

- If `CHROMIUM_PATH` or `config.executablePath` point to a non-Playwright
  Chromium, the browser may launch but CDP protocol mismatch can cause silent
  failures (e.g., missing commands, changed event payloads).
- `doctor` should warn (not fail) when the resolved binary is not from the
  Playwright cache and its version does not match `playwright-core`'s expected
  range.
- Version guard: read `playwright-core/package.json` version at resolution time
  and compare against Playwright's known-good browser revision if available.

---

## Structured resolution output

### `resolveChromium()` return shape

```js
// On success:
{
  found: true,
  path: '/usr/bin/google-chrome',
  source: 'env',           // 'env' | 'config' | 'system' | 'playwright'
  validated: true
}

// On failure:
{
  found: false,
  candidates: [
    { source: 'env',    path: null,         ok: false, reason: 'CHROMIUM_PATH not set' },
    { source: 'config', path: '/opt/chrome', ok: false, reason: 'file not found' },
    { source: 'system', path: null,         ok: false, reason: 'no Chrome installation found' },
    { source: 'playwright', path: '~/.cache/ms-playwright/chromium-xxx/chrome',
                                       ok: false, reason: 'not installed' },
  ]
}
```

This structure is used by:

- `checkBrowser()` — throws formatted error from `candidates` on failure
- `doctor` CLI — prints full candidate chain with pass/fail per entry
- `session_manage open` — wraps error in MCP response

---

## Changes required

### 1. NEW: `packages/runtime/resolve.js` — dedicated resolution module

Extracts browser resolution from `config.js` into a focused module. Reduces
coupling between config loading and binary resolution.

```js
// packages/runtime/resolve.js
// resolveChromium() -> { found, path, source } | { found: false, candidates }
// checkBrowser()    -> path (throws structured BrowserNotFoundError on failure)
// validateCandidate(path) -> { ok, reason }
```

Responsibilities:

- Candidate chain evaluation with strict precedence
- Per-candidate validation (exists, isFile, isExecutable)
- Structured result (used by CLI, MCP, doctor)
- Version warning for non-Playwright binaries

### 2. `package.json` — remove chromium download from postinstall

```diff
- "postinstall": "node scripts/apply-patches.js && node scripts/verify-playwright-patches.js && node scripts/postinstall.js"
+ "postinstall": "node scripts/apply-patches.js && node scripts/verify-playwright-patches.js"
```

### 3. `packages/runtime/config.js` — delegate to resolve.js

`findChromiumPath()` stays as a thin wrapper for backward compat but delegates
to `resolveChromium()` in `resolve.js`. New code imports from `resolve.js`
directly.

### 4. `packages/runtime/launch.js` — use structured error

`checkBrowser()` calls `resolveChromium()`. On failure, throws
`BrowserNotFoundError` carrying the full `candidates` array. The MCP tool and
CLI format this into user-facing instructions.

```js
throw new BrowserNotFoundError(
  'Chromium not found.\n\n' +
    'Options (choose one):\n' +
    '  1. szkrabok install-browser\n' +
    '  2. export CHROMIUM_PATH=/usr/bin/google-chrome\n' +
    '  3. Set executablePath in szkrabok.config.toml\n\n' +
    'Candidates checked:\n' +
    '  env:       CHROMIUM_PATH not set\n' +
    '  config:    executablePath not set\n' +
    '  system:    no Chrome installation found\n' +
    '  playwright: ~/.cache/ms-playwright/... — not installed',
  { candidates }
);
```

### 5. `packages/runtime/errors.js` — add `BrowserNotFoundError`

Exported error class carrying structured `candidates` data. Allows consumers
to programmatically inspect the failure (e.g., `doctor` vs MCP tool vs CLI).

### 6. `src/cli/commands/doctor.js` — full candidate chain output

```
Browser resolution:
  [PASS] playwright: /home/user/.cache/ms-playwright/chromium-1155/chrome-linux/chrome
  [SKIP] system:     chrome-launcher found /usr/bin/google-chrome (lower priority)
  [SKIP] config:     executablePath not set
  [SKIP] env:        CHROMIUM_PATH not set

  Resolved: playwright-managed Chromium
  Version: chromium 115.5 (playwright-core 1.58.2)
```

Or on failure:

```
Browser resolution:
  [FAIL] env:        CHROMIUM_PATH=/opt/bad-chrome — file not found
  [FAIL] config:     executablePath not set
  [FAIL] system:     no Chrome installation found
  [FAIL] playwright: ~/.cache/ms-playwright/chromium-1155/ — directory not found

  No valid browser found. Run: szkrabok install-browser
```

### 7. `src/cli/commands/install-browser.js` — install integrity check

After `npx playwright install chromium` succeeds:

1. Run `resolveChromium()` again to confirm the candidate now passes
2. If valid, print success + system Chrome hint
3. If still invalid (partial install, wrong path), warn user to run `doctor`

```
Chromium installed successfully (playwright-managed).
  Path: ~/.cache/ms-playwright/chromium-1155/chrome-linux/chrome

  Tip: To use system Chrome instead of downloading:
    export CHROMIUM_PATH=/usr/bin/google-chrome
```

### 8. `src/tools/szkrabok_session.js` — update user-facing error

Replace `--setup` reference with the 3-option instructions. Extract message
from `BrowserNotFoundError.candidates`.

### 9. `scripts/smoke-test.js` — remove browser download from smoke test

Current: exercises full postinstall chain including `postinstall.js`.
Target: test patches only. Browser install is validated by `doctor` in CI
as a separate step.

### 10. `docs/development.md` — update references

- Remove `postinstall.js` from postinstall chain description
- Update `prepublishOnly` smoke-test description
- Add `CHROMIUM_PATH` to env var docs
- Update CLI docs: `install-browser` becomes the primary install path

---

## Breaking change migration

This is a breaking change for users who rely on auto-install in postinstall.

### Release strategy

1. **Major version bump** (2.0.0) — semver signals breaking change
2. **Runtime warning in 1.x final release** — if browser not found, print
   deprecation notice: "Starting with v2.0, Chromium is no longer auto-installed.
   Run `szkrabok install-browser` to install."
3. **Release notes** — explicit migration steps for each deployment type:
   - `npx` users: run `szkrabok install-browser` once (cached globally)
   - CI: add `szkrabok install-browser` before MCP server start
   - Docker: add `RUN npx playwright install chromium` to Dockerfile

### CI impact

CI pipelines that previously relied on postinstall auto-install must add:

```yaml
- run: npx @pablovitasso/szkrabok install-browser
```

Or use system Chrome:

```yaml
env:
  CHROMIUM_PATH: /usr/bin/google-chrome
```

---

## Install integrity and retry

### Partial install detection

After `install-browser` runs, `resolveChromium()` validates the result. A
partial download (network failure mid-transfer) will fail the exists/file/
executable checks and produce a clear failure reason.

### No automatic retry

Retry logic is the user's responsibility. `doctor` diagnoses the failure.
`install-browser` is idempotent (re-running is safe).

### Corruption scenario

If Playwright's cache is partially corrupted, `resolveChromium()` reports the
validation failure. Fix: `rm -rf ~/.cache/ms-playwright/chromium-*` then
`szkrabok install-browser`.

---

## Playwright dependency stability

`playwright-core` is pinned to an exact version (`1.58.2`). The resolution chain
depends on `chromium.executablePath()` for Playwright-managed browsers.

Risk: Playwright upstream changes internal structure of `chromium.executablePath()`.
Mitigation: `resolve.js` wraps the Playwright call in a try/catch. If it throws
unexpectedly, the candidate is marked `ok: false` with reason `"playwright API error"`.
`doctor` surfaces this.

The `verify-playwright-patches.js` postinstall step already validates patch
compatibility against the installed `playwright-core` version. A version mismatch
is caught before the MCP server starts.

---

## Files changed

| File                                  | Change                                                       |
| ------------------------------------- | ------------------------------------------------------------ |
| `packages/runtime/resolve.js`         | **NEW** — dedicated browser resolution module                |
| `packages/runtime/errors.js`          | Add `BrowserNotFoundError` with structured candidates        |
| `packages/runtime/config.js`          | Delegate `findChromiumPath()` to `resolve.js` (thin wrapper) |
| `packages/runtime/index.js`           | Export `resolveChromium`, `checkBrowser` from `resolve.js`   |
| `packages/runtime/launch.js`          | Import from `resolve.js`, use structured error               |
| `package.json`                        | Remove `postinstall.js` from postinstall chain               |
| `src/tools/szkrabok_session.js`       | Update user-facing browser-missing error                     |
| `src/cli/commands/doctor.js`          | Full candidate chain output with pass/fail                   |
| `src/cli/commands/install-browser.js` | Install integrity check + system Chrome hint                 |
| `scripts/smoke-test.js`               | Remove browser download from smoke test                      |
| `docs/development.md`                 | Update postinstall, env vars, CLI docs                       |

---

## Verification layer

Tests prove invariants, not code paths. The test module
`tests/node/runtime/resolve.test.js` is the authoritative specification for the
resolution contract. Code that passes these tests is correct by definition.

### Architectural prerequisite: pure functions

Tests require isolation. The resolution chain must be structured as injectable
pure functions:

```js
// resolve.js — the testable surface
export const validateCandidate = (path) => { ok, reason };  // pure, no side effects
export const resolveChromium = (candidates) => { ... };      // pure, candidates injected
export const buildCandidates = (config) => [ ... ];          // pure, reads config + env
```

`resolveChromium()` accepts an array of pre-built candidates (not probes). This
allows tests to inject any combination without filesystem shims or env mutation.
Production callers use `buildCandidates()` to construct the real array.

Separation:

- **Discovery** — `buildCandidates()` returns candidate array from env/config/system/cache
- **Validation** — `validateCandidate()` checks a single path (exists, isFile, isExecutable)
- **Resolution** — `resolveChromium()` runs validation across candidates, returns structured result
- **Error formatting** — `BrowserNotFoundError` formats candidates for human consumption

No mixing. Each layer has its own tests.

### Test file: `tests/node/runtime/resolve.test.js`

Run: `node --test tests/node/runtime/resolve.test.js`

---

#### Category 1: Validation (false-positive prevention)

Tests `validateCandidate()` in isolation. No mocks needed — inject paths.

| Test                        | Input                 | Assert                                        |
| --------------------------- | --------------------- | --------------------------------------------- |
| accepts real executable     | path to `/bin/ls`     | `{ ok: true, reason: null }`                  |
| rejects non-existent path   | `/nonexistent/chrome` | `ok: false`, reason includes "not found"      |
| rejects directory           | `/tmp`                | `ok: false`, reason includes "not a file"     |
| rejects non-executable file | temp file without +x  | `ok: false`, reason includes "not executable" |
| rejects empty string        | `''`                  | `ok: false`, reason includes "empty"          |
| rejects null                | `null`                | `ok: false`, reason includes "not set"        |

---

#### Category 2: Resolution priority matrix

Tests `resolveChromium()` with injected candidate arrays. Exhaustive coverage
of the 4-source precedence chain:

| #   | ENV  | CONFIG | SYSTEM | CACHE | Expected source            |
| --- | ---- | ------ | ------ | ----- | -------------------------- |
| 1   | ok   | —      | —      | —     | `env`                      |
| 2   | fail | ok     | —      | —     | `config`                   |
| 3   | fail | fail   | ok     | —     | `system`                   |
| 4   | fail | fail   | fail   | ok    | `playwright`               |
| 5   | fail | fail   | fail   | fail  | `null` (not found)         |
| 6   | ok   | ok     | —      | —     | `env` (config ignored)     |
| 7   | ok   | ok     | ok     | ok    | `env` (all others ignored) |

"ok" means candidate passes `validateCandidate()`. "fail" means it doesn't.
"—" means candidate is absent from the array (not tested).

Each row is one test. Total: 7 tests.

Implementation: inject `{ source, path }` objects, control which paths point to
real executables (`/bin/ls`) vs failures (`/nonexistent`).

---

#### Category 3: Structured error contract

Tests `BrowserNotFoundError` and `checkBrowser()` behavior.

| Test                             | Setup                  | Assert                                            |
| -------------------------------- | ---------------------- | ------------------------------------------------- |
| error type is correct            | all candidates fail    | `err instanceof BrowserNotFoundError`             |
| error carries candidates         | all candidates fail    | `err.candidates` is array with 4 entries          |
| each candidate has reason        | all candidates fail    | every entry has `{ source, ok: false, reason }`   |
| message contains install command | all candidates fail    | `err.message` includes `szkrabok install-browser` |
| message contains env var option  | all candidates fail    | `err.message` includes `CHROMIUM_PATH`            |
| message contains config option   | all candidates fail    | `err.message` includes `executablePath`           |
| message is deterministic         | run twice              | `err.message === err2.message` (snapshot-stable)  |
| success returns path             | one valid candidate    | returns string path                               |
| no implicit download             | all fail, spy on spawn | zero `playwright install` subprocess calls        |

---

#### Category 4: Install-time invariant (I1)

Tests that postinstall does not trigger browser download. These are static
analysis tests (like existing `contracts.test.js`), not runtime tests.

| Test                                                       | Assert                                      |
| ---------------------------------------------------------- | ------------------------------------------- |
| postinstall script does not reference `playwright install` | `package.json` postinstall string scanned   |
| postinstall script does not import `postinstall.js`        | same scan                                   |
| `scripts/postinstall.js` still exists                      | file exists but is not in postinstall chain |

---

#### Category 5: CLI `doctor` output

Tests that `doctor` prints the full candidate chain. Requires spawning the CLI
subprocess with controlled env (no browser available).

| Test                             | Setup                   | Assert                                         |
| -------------------------------- | ----------------------- | ---------------------------------------------- | ---- | -------- |
| all fail — shows full chain      | no browser, no env      | stdout contains `[FAIL]` for each of 4 sources |
| all fail — shows install command | no browser              | stdout contains `szkrabok install-browser`     |
| env wins — shows precedence      | `CHROMIUM_PATH=/bin/ls` | stdout contains `[PASS] env`, others `[SKIP]`  |
| output is parseable              | any state               | each line matches `^\s\*\[(PASS                | FAIL | SKIP)\]` |

---

#### Category 6: CLI `install-browser` integrity

| Test                      | Setup                     | Assert                                                     |
| ------------------------- | ------------------------- | ---------------------------------------------------------- |
| post-install validation   | run install, then resolve | `validateCandidate` returns `ok: true` for playwright path |
| prints system Chrome hint | successful install        | stdout contains `CHROMIUM_PATH`                            |
| failed install reported   | mock network failure      | stderr contains actionable error, exit code non-zero       |

---

#### Category 7: MCP tool behavior

Tests that `session_manage open` fails cleanly without browser. Integration test
via the MCP tool handler (not full server).

| Test                          | Setup                       | Assert                                                        |
| ----------------------------- | --------------------------- | ------------------------------------------------------------- |
| no browser — structured error | no CHROMIUM_PATH, no config | tool result `isError: true`, content contains install options |
| no browser — no crash         | same                        | no uncaught exception, no process exit                        |
| no browser — no download      | spy on child_process        | zero subprocess spawns                                        |

---

#### Category 8: Backward compatibility

Tests that the `findChromiumPath()` wrapper still works for existing callers.

| Test                    | Assert                                              |
| ----------------------- | --------------------------------------------------- |
| returns string or null  | never throws, never returns undefined               |
| delegates to resolve.js | result matches `resolveChromium(buildCandidates())` |

---

#### Category 9: Cross-platform path handling

| Test               | Input                            | Assert                                              |
| ------------------ | -------------------------------- | --------------------------------------------------- |
| spaces in path     | `/path/to/Google Chrome.app/...` | validation runs without error                       |
| backslash on win32 | `C:\\Program Files\\chrome.exe`  | normalized correctly (CI only if runner is Windows) |
| trailing slash     | `/usr/bin/chrome/`               | rejected as "not a file" (directories fail isFile)  |

Note: cross-platform tests run conditionally via `process.platform` guards.
Windows-specific tests only execute on Windows runners.

---

### Test priority (if scope is cut)

High-value tests that prove the core invariant. Implement first:

1. **Resolution priority matrix** (category 2) — proves I4
2. **Structured error contract** (category 3) — proves I2
3. **Validation false-positive prevention** (category 1) — proves I5
4. **Install-time no-download** (category 4) — proves I1
5. **No implicit download** (category 3, row 8) — proves I6

Everything else can follow in subsequent PRs.

### Contract test addition

Add to `tests/node/contracts.test.js`:

**Invariant 6: resolve.js is the single resolution entry point**

- `launch.js` imports `checkBrowser` from `resolve.js` (not from `config.js`)
- `config.js` `findChromiumPath()` delegates to `resolve.js`
- No MCP tool imports `resolve.js` directly — all access via `checkBrowser()` from launch

---

## Implementation stages

Each stage is self-contained: implement, test, verify before moving on. Stages
are ordered by dependency — later stages depend on earlier ones.

---

### Stage 1 — Core resolution module

The foundation. Pure functions with injected candidates. No consumers change
yet.

**Files:**

| File                                 | Action                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `packages/runtime/resolve.js`        | **NEW** — `validateCandidate()`, `resolveChromium()`, `buildCandidates()` |
| `packages/runtime/errors.js`         | Add `BrowserNotFoundError` class                                          |
| `tests/node/runtime/resolve.test.js` | **NEW** — categories 1-2 + buildCandidates                                |

**Tests (category 1 — validation, 9 tests):**

| Test                        | Input                 | Assert                                     |
| --------------------------- | --------------------- | ------------------------------------------ |
| accepts real executable     | path to `/bin/ls`     | `{ ok: true, reason: null }`               |
| rejects non-existent path   | `/nonexistent/chrome` | `ok: false`, reason `=== 'file not found'` |
| rejects directory           | `/tmp`                | `ok: false`, reason `=== 'not a file'`     |
| rejects non-executable file | temp file without +x  | `ok: false`, reason `=== 'not executable'` |
| rejects empty string        | `''`                  | `ok: false`, reason `=== 'empty path'`     |
| rejects null                | `null`                | `ok: false`, reason `=== 'not set'`        |
| rejects undefined           | `undefined`           | `ok: false`, reason `=== 'not set'`        |
| rejects broken symlink      | broken symlink        | `ok: false`, reason `=== 'file not found'` |
| accepts valid symlink       | symlink to `/bin/ls`  | `{ ok: true, reason: null }`               |

**Tests (category 2 — priority matrix, 8 tests):**

| #   | ENV  | CONFIG | SYSTEM | CACHE | Expected source                              |
| --- | ---- | ------ | ------ | ----- | -------------------------------------------- |
| 1   | ok   | —      | —      | —     | `env`                                        |
| 2   | fail | ok     | —      | —     | `config`                                     |
| 3   | fail | fail   | ok     | —     | `system`                                     |
| 4   | fail | fail   | fail   | ok    | `playwright`                                 |
| 5   | fail | fail   | fail   | fail  | `null` (not found)                           |
| 6   | ok   | ok     | —      | —     | `env` (config ignored)                       |
| 7   | ok   | ok     | ok     | ok    | `env` (all ignored)                          |
| 8   | fail | ok     | ok     | —     | `config` (short-circuit stops before system) |

**Tests (buildCandidates, 4 tests):**

| Test                         | Assert                                                |
| ---------------------------- | ----------------------------------------------------- |
| returns 4 sources in order   | `['env', 'config', 'system', 'playwright']`           |
| passes config.executablePath | candidate[1].path === config value                    |
| system/playwright are null   | candidate[2,3].path === null                          |
| preserves empty env string   | `CHROMIUM_PATH=""` → path `=== ''` (not coerced null) |

**Implementation notes (completed):**

- `statSync` only (no separate `realpathSync`) — one syscall on hot path. `ELOOP`
  (too many symlink levels) is caught specifically; broken symlinks return
  `file not found` on Linux (stat follows symlink → target doesn't exist → ENOENT).
  ELOOP cannot be reliably triggered in tests on this kernel — it is a
  theoretical case for deeply nested symlinks, not a practical concern.
- `?? null` not `|| null` — empty string preserved for validation
- Short-circuit in `resolveChromium` — winner found via `results.find(r => r.ok)`;
  lower-priority candidates are validated but not returned
- `doctor` diagnostics use `validateCandidate()` directly per entry (not
  `resolveChromium`) to get full chain regardless of winner
- `ENOENT` caught specifically; other error codes surfaced with `${err.code}`

**Invariants proved:** I4 (strict precedence), I5 (every candidate validated)

**Stage 1 checklist:**

- [x] `packages/runtime/resolve.js` created with pure injectable functions
- [x] `packages/runtime/errors.js` created with `BrowserNotFoundError`
- [x] `validateCandidate()` — 9 tests pass
- [x] `resolveChromium()` — 8 priority matrix tests pass
- [x] `buildCandidates()` — 4 tests pass
- [x] `package.json` test:node glob fixed (`**/*.test.js`)
- [x] eslint pass (clean on all runtime files)

---

### Stage 2 — Runtime integration

Wire `resolve.js` into the runtime. `checkBrowser()` uses structured errors.
`findChromiumPath()` becomes a thin compat wrapper.

**Files:**

| File                                           | Action                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/runtime/launch.js`                   | Import from `resolve.js`, `checkBrowser()` throws `BrowserNotFoundError` |
| `packages/runtime/config.js`                   | `findChromiumPath()` delegates to `resolve.js`                           |
| `packages/runtime/index.js`                    | Export `resolveChromium`, `checkBrowser`, `populateCandidates` from `resolve.js` |
| `tests/node/runtime/resolve.test.js`           | Add categories 3, 8                                                      |
| `tests/node/contracts.test.js`                 | Add Invariant 6                                                          |
| `tests/node/runtime/browser-detection.test.js` | Update for new API                                                       |

**Tests (category 4 — error contract, 7 tests):**

Note: this machine's TOML always has a valid `executablePath`, so "no browser"
is not reachable through `checkBrowser` here. Tests use `resolveChromium` directly
for the failure path, and `checkBrowser` for the success path.

| Test                                            | Setup                       | Assert                                                |
| ----------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| error type is correct                           | `BrowserNotFoundError` ctor | `instanceof Error && instanceof BrowserNotFoundError` |
| error carries candidates                        | `BrowserNotFoundError` ctor | `candidates` is array with 4 entries                  |
| each candidate has { source, ok, reason, path } | resolveChromium all-null    | all 4 fields present per candidate                    |
| message contains install command                | `BrowserNotFoundError` ctor | `err.message.includes('szkrabok install-browser')`    |
| message contains CHROMIUM_PATH                  | `BrowserNotFoundError` ctor | `err.message.includes('CHROMIUM_PATH')`               |
| message contains executablePath                 | `BrowserNotFoundError` ctor | `err.message.includes('executablePath')`              |
| message is deterministic                        | construct twice             | `err1.message === err2.message`                       |
| success returns path                            | `CHROMIUM_PATH=/bin/ls`     | returns string path                                   |
| CHROMIUM_PATH wins over config                  | both env and config set     | env path returned                                     |
| resolveChromium is pure — no side effects       | injected candidates         | completes in <100ms without any async operations      |

**Tests (category 8 — backward compat, 2 tests):**

| Test                    | Assert                                              |
| ----------------------- | --------------------------------------------------- |
| returns string or null  | never throws, never returns undefined               |
| delegates to resolve.js | result matches `resolveChromium(buildCandidates())` |

**Contract test addition — Invariant 6:**

- `launch.js` imports `checkBrowser` from `resolve.js` (not from `config.js`)
- `config.js` `findChromiumPath()` delegates to `resolve.js`
- No MCP tool imports `resolve.js` directly — all access via `checkBrowser()` from launch

**Invariants proved:** I2 (deterministic failure), I6 (no implicit download)

**Deferred items (must not be forgotten):**

- Do NOT introduce caching at this stage. Resolution is called once per
  `session_manage open`. If profiling shows repeated calls are a problem,
  add a `Map<path, validationResult>` cache in a later pass — not now.
- `BrowserNotFoundError` should construct its own formatted message from
  `candidates`. Currently `checkBrowser` builds the string manually — if MCP tool
  or `doctor` want to render the error, they must re-implement the same logic.
  The error class should expose a `formatMessage()` method or a getter that
  produces the human-readable output.
- `findChromiumPath` accesses `_config` directly (not via `getConfig()` with
  try/catch). This silently hides initialization state. Use the same pattern
  as `checkBrowser` for consistency.

**Stage 2 checklist:**

- [x] `checkBrowser()` throws `BrowserNotFoundError` with full candidate list
- [x] `checkBrowser()` probes system/playwright via `populateCandidates` before resolving
- [x] `populateCandidates(candidates)` exported from `resolve.js`; no caller duplicates probe logic
- [x] Error contract + deterministic + pure — 7 tests pass (category 4)
- [x] Backward compat — 2 tests pass (category 5)
- [x] Invariant 6 added to `contracts.test.js` and passes
- [x] `browser-detection.test.js` updated and passes
- [x] All existing non-browser node tests pass (119/119)

**Deferred items — all resolved:**

- `BrowserNotFoundError` now owns its `formatMessage()` static method. The
  constructor signature is `(message, { candidates = [] } = {})` — message is
  optional (auto-generated from candidates if omitted), data defaults to `{}`,
  candidates default to `[]`. Callers pass `(undefined, { candidates })`.
- `findChromiumPath` uses `getConfig()` with try/catch fallback to `{}` —
  consistent with `checkBrowser`.
- Centralize async discovery: `populateCandidates(candidates)` exported from
  `resolve.js` — probes chrome-launcher and `playwright.chromium.executablePath()`
  for null `system`/`playwright` candidates. `checkBrowser()` calls it before
  `resolveChromium()`; `findChromiumPath()` delegates to it instead of duplicating
  the probe logic. No caller holds probe logic independently.

**Implementation notes (completed):**

- `checkBrowser` calls `getConfig()` with try/catch fallback to `{}` — uninitialized
  config (e.g., in tests) falls back gracefully without throwing
- `checkBrowser` calls `await populateCandidates(candidates)` after `buildCandidates`,
  before `resolveChromium` — users who ran `szkrabok install-browser` are resolved
  correctly even without `CHROMIUM_PATH` or `executablePath` in TOML
- `launch()`, `launchClone()`, `cloneFromLive()` all capture `executablePath` from
  `checkBrowser()` and pass it explicitly to `_launchPersistentContext` — no
  duplicate resolution inside `_launchPersistentContext`
- `findChromiumPath()` delegates to `populateCandidates` — no duplicated probe logic
- TOML config on test machines may provide `executablePath` — "no browser" tests
  use `resolveChromium` directly with null candidates rather than `checkBrowser`
- `BrowserNotFoundError` constructor signature: `(message, { candidates = [] } = {})`.
  The `data` param defaults to `{}` so `new BrowserNotFoundError({ candidates })`
  (single-arg object) does not throw on destructuring. The `candidates` default
  `[]` ensures `formatMessage()` never receives `undefined`.

---

### Stage 3 — Remove browser from postinstall

Decouple install-time from browser binary. Patches stay, Chromium download
leaves.

**Files:**

| File                                 | Action                                         |
| ------------------------------------ | ---------------------------------------------- |
| `package.json`                       | Remove `postinstall.js` from postinstall chain |
| `scripts/postinstall.js`             | Retain file (not deleted, just unchained)      |
| `scripts/smoke-test.js`              | Remove browser download from smoke test        |
| `tests/node/runtime/resolve.test.js` | Add category 4                                 |

**Tests (category 4 — install-time invariant, 3 tests):**

| Test                                                | Assert                                      |
| --------------------------------------------------- | ------------------------------------------- |
| postinstall does not reference `playwright install` | `package.json` postinstall string scanned   |
| postinstall does not import `postinstall.js`        | same scan                                   |
| `scripts/postinstall.js` still exists               | file exists but is not in postinstall chain |

**Invariants proved:** I1 (npx has no browser side-effects)

**Stage 3 checklist:**

- [x] `postinstall.js` removed from postinstall chain in `package.json`
- [x] `postinstall.js` file retained for manual use
- [x] Install-time invariant — 3 tests pass
- [x] `npx` cold start < 5 seconds (patches only) — postinstall is 2 scripts (~2-3s), not 3 (~30-120s)
- [x] `CHROMIUM_PATH` env var — highest precedence in resolution chain (from Stage 1)
- [x] Smoke test validates patches only (`doctor` call deferred to Stage 4)

---

### Stage 4 — CLI commands

`doctor` exposes the full candidate chain. `install-browser` validates and hints.

**Files:**

| File                                  | Action                                       |
| ------------------------------------- | -------------------------------------------- |
| `src/cli/commands/doctor.js`          | Full candidate chain output with pass/fail   |
| `src/cli/commands/install-browser.js` | Install integrity check + system Chrome hint |
| `tests/node/runtime/resolve.test.js`  | Add categories 5-6                           |

**Tests (category 5 — doctor output, 4 tests):**

| Test                             | Setup                   | Assert                                         |
| -------------------------------- | ----------------------- | ---------------------------------------------- | ---- | -------- |
| all fail — shows full chain      | no browser, no env      | stdout contains `[FAIL]` for each of 4 sources |
| all fail — shows install command | no browser              | stdout contains `szkrabok install-browser`     |
| env wins — shows precedence      | `CHROMIUM_PATH=/bin/ls` | stdout contains `[PASS] env`, others `[SKIP]`  |
| output is parseable              | any state               | each line matches `^\s\*\[(PASS                | FAIL | SKIP)\]` |

**Tests (category 6 — install-browser integrity, 3 tests):**

| Test                      | Setup                     | Assert                                               |
| ------------------------- | ------------------------- | ---------------------------------------------------- |
| post-install validation   | run install, then resolve | `validateCandidate` returns `ok: true` for pw path   |
| prints system Chrome hint | successful install        | stdout contains `CHROMIUM_PATH`                      |
| failed install reported   | mock network failure      | stderr contains actionable error, exit code non-zero |

**Invariants proved:** I3 (core CLI works without browser), I7 (doctor exposes full candidate chain)

**Deferred items (must not be forgotten):**

- Version compatibility check: `doctor` must warn (not fail) when the resolved
  binary is not from the Playwright cache and its version does not match
  `playwright-core`'s expected range. Read `playwright-core/package.json` version
  at resolution time and compare against Playwright's known-good browser revision.
  This is NOT a `validateCandidate` concern — it belongs in `doctor` output only.
- Binary launchability check (`--version`): optional `doctor` enhancement.
  `validateCandidate` intentionally does NOT spawn processes — it stays pure.
  If `doctor` wants to verify the binary actually runs, it does so independently
  after validation passes. Do NOT move launchability into `resolve.js`.
- Distinguish "not provided" vs "invalid" in `doctor` output: the `reason`
  string already encodes this (`"not set"` / `"empty path"` = absent vs
  `"file not found"` / `"not executable"` = invalid). `doctor` should group
  candidates into `[ABSENT]` vs `[FAIL]` when printing, not add a type field
  to the data model.

**Stage 4 checklist:**

- [ ] `doctor` prints full candidate chain with pass/fail per entry
- [ ] `doctor` warns on non-Playwright binary version mismatch
- [ ] `install-browser` validates result after download, prints integrity status
- [ ] `install-browser` prints system Chrome hint on success
- [ ] Doctor output — 4 tests pass
- [ ] Install-browser integrity — 3 tests pass
- [ ] `doctor`, `session list`, `--version` exit 0 with no browser

---

### Stage 5 — MCP tool + cross-platform + docs

Final wiring. MCP tool uses structured errors. Cross-platform edge cases. Docs
updated.

**Files:**

| File                                 | Action                                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| `src/tools/szkrabok_session.js`      | Extract error message from `BrowserNotFoundError.candidates` |
| `tests/node/runtime/resolve.test.js` | Add categories 7, 9                                          |
| `docs/development.md`                | Update postinstall, env vars, CLI docs                       |

**Tests (category 7 — MCP tool, 3 tests):**

| Test                          | Setup                       | Assert                                                        |
| ----------------------------- | --------------------------- | ------------------------------------------------------------- |
| no browser — structured error | no CHROMIUM_PATH, no config | tool result `isError: true`, content contains install options |
| no browser — no crash         | same                        | no uncaught exception, no process exit                        |
| no browser — no download      | spy on child_process        | zero subprocess spawns                                        |

**Tests (category 9 — cross-platform, 3 tests):**

| Test               | Input                            | Assert                            |
| ------------------ | -------------------------------- | --------------------------------- |
| spaces in path     | `/path/to/Google Chrome.app/...` | validation runs without error     |
| backslash on win32 | `C:\\Program Files\\chrome.exe`  | normalized correctly (Windows CI) |
| trailing slash     | `/usr/bin/chrome/`               | rejected as "not a file"          |

**Invariants proved:** I3 (core CLI works without browser — MCP path), cross-platform safety

**Deferred items (must not be forgotten):**

- Windows path normalization: `resolve.js` currently uses `realpathSync` which
  handles symlinks but not Windows-specific quirks (backslashes, spaces in
  `Program Files`, UNC paths). Before Windows CI runs, verify that `realpathSync`
  normalizes correctly on win32. If not, add a `normalizePath(path)` step before
  validation in `validateCandidate`.
- Relative path resolution: if `config.executablePath` or `CHROMIUM_PATH` is a
  relative path (e.g., `./chrome`), `realpathSync` resolves it against `cwd()`.
  This is correct for env vars but may surprise config users. Consider resolving
  config paths relative to the config file's directory, not cwd.

**Stage 5 checklist:**

- [ ] `session_manage open` with no browser returns actionable error with 3 options
- [ ] MCP tool — 3 tests pass
- [ ] Cross-platform — 3 tests pass (guarded by `process.platform`)
- [ ] `docs/development.md` updated
- [ ] `findChromiumPath()` backward-compat wrapper delegates to `resolve.js`
- [ ] Breaking change migration plan documented (major bump, release notes)
- [ ] All existing tests pass

---

## Stage summary

| Stage     | Focus                  | Files changed  | Tests added     | Invariants proved |
| --------- | ---------------------- | -------------- | --------------- | ----------------- |
| 1         | Core resolution module | 3              | 23              | I4, I5            |
| 2         | Runtime integration    | 5              | 12 + 1 contract | I2, I6            |
| 3         | Remove postinstall dl  | 3              | 3               | I1                |
| 4         | CLI commands           | 3              | 7               | I3, I7            |
| 5         | MCP tool + docs        | 3              | 6               | I3 (MCP)          |
| **Total** |                        | **~10 unique** | **~51**         | **I1-I7**         |

---

## Deferred items index

Cross-reference of all items deferred from earlier stages. Each links to the
stage that must implement it.

| Item                                       | What                                                                                                                                                                                                                                                                                                                                                   | Where                                              | Stage |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ----- |
| Centralize async discovery                 | ✅ RESOLVED — `populateCandidates(candidates)` exported from `resolve.js`; `checkBrowser()` calls it; `findChromiumPath()` delegates to it                                                                                                                                                                                                            | Stage 2 ✅                                         | 2     |
| Resolution caching                         | `Map<path, validationResult>` if profiling shows repeated calls                                                                                                                                                                                                                                                                                        | Stage 2 (only if needed)                           | 2     |
| `BrowserNotFoundError` owns its message    | ✅ RESOLVED — `BrowserNotFoundError.formatMessage()` static method; constructor `(message, { candidates = [] } = {})`; `launch.js` calls `new BrowserNotFoundError(undefined, { candidates })`                                                                                                                                                         | Stage 2 ✅                                         | 2     |
| `findChromiumPath` uses `_config` directly | ✅ RESOLVED — `findChromiumPath` uses `getConfig()` with try/catch fallback to `{}`, consistent with `checkBrowser`                                                                                                                                                                                                                                    | Stage 2 ✅                                         | 2     |
| ELOOP cannot be tested                     | `ELOOP` (too many symlink levels) is caught in `validateCandidate` for correctness, but cannot be reliably triggered on this Linux kernel to write a passing test. If a test for ELOOP is needed, requires a fixture that reliably produces the error.                                                                                                 | Stage 1 (no action needed — documented limitation) | 1     |
| resolveChromium eager validation           | ✅ RESOLVED — async discovery is centralized in `populateCandidates`; all callers use the same probe path                                                                                                                                                                                                                                              | Stage 2 ✅                                         | 2     |
| Version compatibility                      | `doctor` warns on non-Playwright binary version mismatch                                                                                                                                                                                                                                                                                               | Stage 4 — doctor output                            | 4     |
| Binary launchability                       | Optional `doctor --deep` runs `--version` on resolved binary                                                                                                                                                                                                                                                                                           | Stage 4 — doctor output                            | 4     |
| Absent vs invalid grouping                 | `doctor` prints `[ABSENT]` vs `[FAIL]` based on reason string                                                                                                                                                                                                                                                                                          | Stage 4 — doctor output                            | 4     |
| `doctor` not yet implemented               | Stage 1 docs promise `doctor` uses `validateCandidate()` per entry for full diagnostics. That claim cannot be verified until Stage 4 implements `doctor`.                                                                                                                                                                                              | Stage 4                                            | 4     |
| Binary name hardcoded in error             | `'szkrabok install-browser'` in error message is the package name. If published under a different name (`@pablovitasso/szkrabok`), the message is wrong. Should come from `package.json` or a constant.                                                                                                                                                | Stage 4 or 5                                       | 4-5   |
| Windows path normalization                 | `statSync` on win32 handles backslashes and spaces, but UNC paths (`\\server\share`) and eight-dot notation may need explicit normalization. Verify behavior on Windows CI before shipping.                                                                                                                                                            | Stage 5 — cross-platform                           | 5     |
| Relative path in config                    | `config.executablePath` resolved relative to `cwd()`, not the config file's directory. This surprises users who set a relative path in TOML. Consider resolving relative to the config file's directory.                                                                                                                                               | Stage 5 — cross-platform                           | 5     |
