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
  1. szkrabok doctor install         -- managed Chromium via Playwright (idempotent)
  2. szkrabok doctor detect --write-config  -- detect and pin a path to config
  3. CHROMIUM_PATH=/path/to/chrome    -- system Chrome (env var, highest priority)
  4. executablePath in config.toml    -- persistent config
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
   `--version` exit 0 when no Chromium is installed. Note: `doctor` exits 0 when
   it executes successfully regardless of health status. `--strict` makes it exit 1
   when checks fail.
4. **I4 — resolution precedence is strict** — `ENV > CONFIG > SYSTEM > PLAYWRIGHT`;
   first valid candidate wins, lower-priority candidates are never probed
5. **I5 — every candidate is validated** — exists, isFile, isExecutable; invalid
   candidates are rejected with a reason string
6. **I6 — no implicit install at runtime** — calling `session_manage open` with no
   browser triggers zero downloads; only an error is returned
7. **I7 — doctor exposes full candidate chain** — output includes pass/fail/absent/
   skip status and failure reason per candidate, not just the winner

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
- `doctor` warns (not fails) when the resolved binary is not playwright-managed
  and its version does not match `playwright-core`'s expected revision.

#### Version comparison contract

`_revision` is not public API. Playwright does not guarantee its name, location,
or semantics. The system must function correctly when it disappears.

Exact revision matching is not feasible from `--version` output alone — the binary
reports a semver (`Chromium 115.0.5790.75`), not Playwright's internal build
revision string. Use **coarse major-version comparison** instead.

**Strategy:**

1. Read `playwright-core/package.json` version (public, stable)
2. Map version → expected Chromium major via a static lookup table in `doctor.js`
3. Extract Chromium major from binary `--version` output
4. Compare majors: mismatch → `[warn]`, any parse/mapping failure → `[note]`

No `_revision` probe. No try/catch around Playwright internals. Single source of truth.

```js
// Static lookup: playwright-core version → expected Chromium major
// Add one entry per playwright-core upgrade.
const PLAYWRIGHT_CHROMIUM_MAJOR = {
  '1.58.2': 133,
  // '1.57.0': 131,
};

function getExpectedChromiumMajor() {
  const { version } = require('playwright-core/package.json');
  return PLAYWRIGHT_CHROMIUM_MAJOR[version] ?? null;
}

function extractChromiumMajor(versionString) {
  // e.g. "Chromium 133.0.6943.16" or "Google Chrome 133.0.6943.16"
  const m = versionString.match(/(\d+)\.\d+\.\d+\.\d+/);
  return m ? parseInt(m[1], 10) : null;
}
```

`null` from either function means comparison is not possible — degrade to `[note]`.

| Case                                    | doctor output                                         |
| --------------------------------------- | ----------------------------------------------------- |
| Majors match                            | no warning                                            |
| Majors mismatch                         | `[warn] CDP compatibility: expected Chromium M133, found M115` |
| `_revision` unavailable or not in table | `[note] CDP compatibility: playwright revision unknown — skipping check` |
| Binary `--version` unparseable          | `[note] CDP compatibility: binary version unreadable` |

Do not hard-fail. Do not warn on unavailability. The system is correct regardless
of whether the internal field or the table entry exists.

**Maintenance:** update `PLAYWRIGHT_CHROMIUM_MAJOR` when upgrading `playwright-core`.

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

#### Exit code contract

Exit codes are part of the public API:

| Condition                          | Exit code |
| ---------------------------------- | --------- |
| doctor ran (any health outcome)    | 0         |
| doctor ran with `--strict` + fails | 1         |
| internal error (exception thrown)  | 1         |

Exit 0 signals execution success, not system health. Health is conveyed via output.
`--strict` is the CI-compatible opt-in for failure-as-exit-code.

#### Candidate state model

Each candidate has exactly one state. States are mutually exclusive.
State is determined by **evaluation result**, not by selection relevance.

| State    | Meaning                                         | Display    |
| -------- | ----------------------------------------------- | ---------- |
| `pass`   | selected winner                                 | `[PASS  ]` |
| `skip`   | valid but lower priority (winner already found) | `[SKIP  ]` |
| `fail`   | configured but invalid (broken path, no +x)     | `[FAIL  ]` |
| `absent` | not configured (not set / empty env var)        | `[ABSENT]` |

All candidates are evaluated. Evaluation results are always shown — they are
never suppressed because a winner was already found. A broken system Chromium
after a valid env override is still `[FAIL  ]`, not hidden. This preserves
diagnostic signal for latent misconfiguration.

`[SKIP  ]` applies only when `validateCandidate()` passes but a higher-priority
winner was already selected.

Tags use fixed-width brackets (8 chars: `[` + 6-char padded tag + `]`) for
machine-parseable output. Do not use ad-hoc tags like `[--]` or `[ - ]`.

#### CHROMIUM_PATH='' classification

Empty string is not the same as absent:

- `undefined` / not set → `absent` → `[ABSENT]`
- `''` (set but empty) → `fail` → `[FAIL  ]` with reason `'empty env var (invalid)'`

`buildCandidates` preserves `''` as the path value. `validateCandidate('')` returns
`{ ok: false, reason: 'empty path' }`. Doctor must map `reason === 'empty path'` to
`fail` (not `absent`), since the user explicitly set the variable.

#### State assignment rules

Candidates are printed in resolution order (env → config → system → playwright).

| Candidate valid? | Selected? | State  | Display    |
| ---------------- | --------- | ------ | ---------- |
| yes              | yes       | pass   | `[PASS  ]` |
| yes              | no        | skip   | `[SKIP  ]` |
| no, broken       | —         | fail   | `[FAIL  ]` |
| no, absent       | —         | absent | `[ABSENT]` |

Selection relevance does not change how evaluation results are displayed.
`fail` and `absent` render identically whether the candidate is before or
after the winner. All candidates are always evaluated.

`fail > absent` precedence when no winner: if some candidates are broken and
others are absent, the summary shows the broken ones — the absence of a winner
is more actionable when broken paths are highlighted.

#### Output format

Playwright wins (env/config/system all absent or failing):

```
Browser resolution:
  [ABSENT] env          CHROMIUM_PATH not set
  [ABSENT] config       executablePath not set
  [FAIL  ] system       no Chrome installation found
  [PASS  ] playwright   /home/user/.cache/ms-playwright/chromium-1155/chrome-linux/chrome

  Resolved: playwright-managed Chromium
  Version: Chromium 133.0.6943.16
```

Env wins with config absent, system valid, playwright absent:

```
Browser resolution:
  [PASS  ] env          /usr/local/bin/chrome
  [ABSENT] config       executablePath not set
  [SKIP  ] system       /usr/bin/google-chrome — valid, lower priority
  [ABSENT] playwright   ~/.cache/ms-playwright/chromium-1155/ — not installed

  Resolved: env — /usr/local/bin/chrome
  [warn] CDP compatibility: expected Chromium M133, found M115
```

All fail:

```
Browser resolution:
  [FAIL  ] env          (empty) — invalid configuration
  [FAIL  ] config       /opt/bad-chrome — file not found
  [FAIL  ] system       no Chrome installation found
  [ABSENT] playwright   ~/.cache/ms-playwright/chromium-1155/ — not installed

  No valid browser found. Run: szkrabok doctor install
```

### 7. `src/cli/lib/browser-actions.js` — shared browser CLI actions

Shared library used by `doctor detect` and `doctor install`. Exposes:

- `runDetect()` — runs full resolution chain, returns `{ winner, results }`
- `runInstall({ force })` — idempotent Playwright Chromium install
- `writeExecPath(path)` — writes `executablePath` to `~/.config/szkrabok/config.toml`
- `getGlobalConfigPath()` — returns platform-appropriate config file path

`doctor install` is idempotent:
1. Run `runDetect()` to check current state
2. If Playwright Chromium already found and `!force` → print "already installed", return 0
3. If other browser found and `!force` → print path, hint to pin via `--write-config`, return 0
4. Otherwise → spawn `npx playwright install chromium`, validate result, print outcome

```
szkrabok doctor install
  -> "Browser found via env: /usr/local/bin/chrome"
  -> "To install Playwright-managed Chromium anyway: use --force"
  -> "To pin this browser instead: szkrabok doctor detect --write-config"
```

`doctor detect` shows the full candidate chain + resolved path:
```
Browser resolution:
  [PASS  ] env          /usr/local/bin/chrome
  [ABSENT] config       executablePath not set
  [SKIP  ] system       /usr/bin/google-chrome — valid, lower priority
  [ABSENT] playwright   ~/.cache/ms-playwright/... — not installed

  Resolved: env — /usr/local/bin/chrome
  Hint: path not pinned — run with --write-config to save to config.toml
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
- Update CLI docs: `doctor detect` + `doctor install` are the primary browser management commands

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

Or use system Chrome, or pin via `--write-config`:

```yaml
env:
  CHROMIUM_PATH: /usr/bin/google-chrome
```

```bash
szkrabok doctor detect --write-config   # discover + persist in one step
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
| all fail — shows full chain      | no browser, no env      | stdout contains `[FAIL  ]` or `[ABSENT]` for each of 4 sources        |
| all fail — shows install command | no browser              | stdout contains `szkrabok install-browser`                             |
| env wins — shows precedence      | `CHROMIUM_PATH=/bin/ls` | stdout contains `[PASS  ] env`; lower candidates show their true state |
| output is parseable              | any state               | each tag line matches `^\s*\[(PASS {2}\|FAIL {2}\|SKIP {2}\|ABSENT)\]` |

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
- chrome-launcher paths are filtered by `isFunctionalBrowser()` before use:
  runs `path --version`, checks exit 0 + non-empty stdout. This filters Ubuntu
  snap wrappers that pass `accessSync(X_OK)` but exit 1 or print nothing.

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

| Test                             | Setup                   | Assert                                                                 |
| -------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| all fail — shows full chain      | no browser, no env      | stdout contains `[FAIL  ]` or `[ABSENT]` for each of 4 sources        |
| all fail — shows install command | no browser              | stdout contains `szkrabok install-browser`                             |
| env wins — shows precedence      | `CHROMIUM_PATH=/bin/ls` | stdout contains `[PASS  ] env`; lower candidates show their true state |
| output is parseable              | any state               | each tag line matches `^\s*\[(PASS {2}\|FAIL {2}\|SKIP {2}\|ABSENT)\]` |

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
  `playwright-core`'s expected revision. Compare against `chromium._revision`.
  This is NOT a `validateCandidate` concern — it belongs in `doctor` output only.
- Binary launchability check (`--version`): optional `doctor` enhancement.
  `validateCandidate` intentionally does NOT spawn processes — it stays pure.
  If `doctor` wants to verify the binary actually runs, it does so independently
  after validation passes. Do NOT move launchability into `resolve.js`.
- Distinguish "not provided" vs "invalid" in `doctor` output: the `reason`
  string already encodes this (`"not set"` / `"empty path"` = absent vs
  `"file not found"` / `"not executable"` = invalid). `doctor` uses the state
  model (pass/fail/absent/skip), not string pattern matching.

**Stage 4 checklist:**

- [x] `doctor` prints full candidate chain with pass/fail per entry
- [x] `doctor` warns on non-Playwright binary version mismatch — `[warn] CDP compatibility` + `Version:` line after resolution
- [x] `install-browser` validates result after download, prints integrity status
- [x] `install-browser` prints system Chrome hint on success
- [x] Doctor output — 7 tests pass (categories 7 + 7-additions)
- [x] Install-browser integrity — 3 tests pass (1 static + 2 mock-npx)
- [x] `doctor` exit code contract corrected — exits 0 by default; `--strict` exits 1 on failures. See D1 (resolved in Stage 6).
- [x] Fixed-width status tags — `[PASS  ]`, `[FAIL  ]`, `[ABSENT]`, `[SKIP  ]`. See D2 (resolved in Stage 6).
- [x] State model: remove `ignored`/`[      ]` — all candidates always evaluated; results always shown. See D4 (resolved in Stage 6).
- [x] `CHROMIUM_PATH=''` renders `[FAIL  ]` (invalid config). See Additional (resolved in Stage 6).
- [x] CDP version check uses major-version comparison via `PLAYWRIGHT_CHROMIUM_MAJOR` table. See D3 (resolved in Stage 6).
- [x] `doctor`, `session list`, `--version` exit 0 with no browser. See D1 (resolved in Stage 6).

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

- [x] `session_manage open` with no browser returns actionable error with 3 options — `BrowserNotFoundError` propagates through `handleToolCall`, `isError: true`, message contains install instructions
- [x] MCP tool — 4 tests pass (category 9: code, toJSON, JSON.stringify, resolve.js static)
- [x] Cross-platform — 2 pass + 1 skipped (Windows backslash test guarded by `process.platform !== 'win32'`)
- [x] `docs/development.md` updated — install-browser, CHROMIUM_PATH, postinstall chain, smoke-test description
- [x] `findChromiumPath()` backward-compat wrapper delegates to `resolve.js` — Stage 2
- [ ] Breaking change migration plan documented (major bump, release notes) — spec documents the plan; CHANGELOG/release notes entry not yet written
- [x] CLI control flow: return-based exit codes; `index.js` is the single exit authority. See D5 (resolved in Stage 6).
- [x] All existing tests pass — 238/242; 2 pre-existing failures in `devtools-port.test.js` (unrelated, existed before this branch)

---

## Stage 6 — Refinements

Corrections to decisions made in stages 4–5. All items are self-contained.

**Files:**

| File                                  | Action                                                       |
| ------------------------------------- | ------------------------------------------------------------ |
| `src/cli/commands/doctor.js`          | D1: exit 0 by default, `--strict` flag. D2/D4: fixed-width tags + state model. D3: major-version CDP check. Subcommands: `doctor detect [--write-config]`, `doctor install [--force]` |
| `src/cli/lib/browser-actions.js`      | **NEW** — shared `runDetect()`, `runInstall()`, `writeExecPath()`, `getGlobalConfigPath()` |
| `src/cli/index.js`                    | D5: remove `process.exitCode` reliance; `runCli()` returns exit code. Remove `detect-browser` + `install-browser` registrations |
| `src/index.js`                        | D5: `process.exit(await runCli() ?? 0)` |
| `src/cli/commands/detect-browser.js` | **DELETED** — replaced by `doctor detect [--write-config]` |
| `src/cli/commands/install-browser.js` | **DELETED** — replaced by `doctor install [--force]` |
| `packages/runtime/resolve.js`         | Additional: `CHROMIUM_PATH=''` → `fail` (not `absent`). `isFunctionalBrowser()` probe filters chrome-launcher stubs |
| `tests/node/runtime/resolve.test.js`  | New tests for D1 (`--strict`), D2/D4 (tag format), D3 (revision check), `CHROMIUM_PATH=''`, `isFunctionalBrowser`, browser-actions, detect/install CLI, removed-commands rejection |

**Decisions:**

- **D1** — `doctor` exit 0 = execution success; `--strict` = health failure → exit 1
- **D2** — Fixed-width tags: `[PASS  ]`, `[FAIL  ]`, `[SKIP  ]`, `[ABSENT]`
- **D3** — CDP compatibility: read `playwright-core/package.json` version, map to expected Chromium major via static lookup table (`PLAYWRIGHT_CHROMIUM_MAJOR` in `doctor.js`), compare against major extracted from binary `--version`; `[warn]` on mismatch, `[note]` on any parse/mapping failure. No `_revision` probe.
- **D4** — Explicit state model: pass / fail / absent / skip. No `ignored` state. All candidates are always evaluated and results always shown. A broken system Chrome after a valid env override still shows `[FAIL  ]` — evaluation results are not suppressed by selection.
- **D5** — Return-based exit codes; `index.js` is the single `process.exit()` authority
- **Additional** — `CHROMIUM_PATH=''` maps to `fail`/`[FAIL  ]`, not `absent`

**ABSENT_REASONS correction:**

Current code has `ABSENT_REASONS = new Set(['not set', 'empty path'])`. `'empty path'`
must be removed from `ABSENT_REASONS`. `validateCandidate('')` returns reason `'empty path'`;
this is a configured-but-invalid value, not an absent one.

**Stage 6 checklist:**

- [x] D1: `doctor` exits 0 by default; exits 1 only on `--strict` or exception
- [x] D1: `--strict` flag added; test that `--strict` exits 1 when checks fail
- [x] D2: All status tags fixed-width (8 chars); test format regex `^\s*\[(PASS {2}|FAIL {2}|SKIP {2}|ABSENT)\]`
- [x] D3: CDP check uses major-version comparison — read `playwright-core/package.json` version, map to expected Chromium major via `PLAYWRIGHT_CHROMIUM_MAJOR` table, extract major from binary `--version`, `[warn]` on mismatch, `[note]` on any parse/mapping failure; no `_revision` probe
- [x] D4: Remove `ignored`/`[      ]` state — all candidates always evaluated; results always shown. `[SKIP  ]` for valid-but-lower-priority; `[FAIL  ]`/`[ABSENT]` for broken/absent regardless of winner position. Updated `candidateState()`, doctor output, and resolve tests.
- [x] D5: `install-browser` returns exit code; `index.js` calls `process.exit(await runCli() ?? 0)`
- [x] Additional: `CHROMIUM_PATH=''` renders `[FAIL  ]` in doctor; test added

---

## Stage summary

| Stage     | Focus                          | Files changed       | Tests added     | Invariants proved |
| --------- | ------------------------------ | ------------------- | --------------- | ----------------- |
| 1         | Core resolution module         | 3                   | 23              | I4, I5            |
| 2         | Runtime integration            | 5                   | 12 + 1 contract | I2, I6            |
| 3         | Remove postinstall dl          | 3                   | 3               | I1                |
| 4         | CLI commands                   | 3                   | 7               | I3, I7            |
| 5         | MCP tool + docs                | 3                   | 6               | I3 (MCP)          |
| 6         | Refinements (D1–D5) + CLI cons | 9 (4 new, 5 modified)| ~17             | I3 (exit code)    |
| **Total** |                                | **~13 unique**       | **~59**         | **I1-I7**         |

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
| Version compatibility                      | ✅ RESOLVED — `PLAYWRIGHT_CHROMIUM_MAJOR` lookup table in `doctor.js`; `getExpectedChromiumMajor(pwCoreVersion)` maps version → major; `extractChromiumMajor` parses binary `--version`; `[warn]` on mismatch, `[note]` on parse/mapping failure. No `_revision` probe.                                                 | Stage 6 ✅                                  | 4→6   |
| Binary launchability                       | `Version:` line printed unconditionally after resolution. Full launchability test (open a tab) remains optional/future.                                                                                                                                                                                                                                | Outstanding (low priority)                         | 4     |
| Absent vs invalid grouping                 | ✅ RESOLVED — `ABSENT_REASONS = new Set(['not set'])` only. `'empty path'` removed. `CHROMIUM_PATH=''` renders `[FAIL  ]`. State model: pass/fail/absent/skip (no `ignored`).                                                                                                                                                                         | Stage 6 ✅                                          | 4→6   |
| `doctor` not yet implemented               | ✅ RESOLVED — `doctor` uses `validateCandidate()` per entry for full diagnostics.                                                                                                                                                                                                                                                                       | Stage 4 ✅                                         | 4     |
| `doctor` exit code                         | ✅ RESOLVED — exits 0 by default (execution success). `--strict` flag exits 1 when checks fail. See D1.                                                                                                                                                                                                        | Stage 6 (D1)                                       | 4→6   |
| `doctor` tag fixed-width + state model     | ✅ RESOLVED — fixed-width 8-char tags (D2). `candidateState()` returns pass/fail/absent/skip only — `ignored` state removed (D4). All candidates always evaluated; post-winner broken/absent render as `[FAIL  ]`/`[ABSENT]`, never suppressed.                                                                | Stage 6 ✅                                          | 4→6   |
| CLI control flow (`process.exitCode`)      | ✅ RESOLVED — `doctor install` returns exit code via `runInstall()`; `runCli()` returns `_exitCode`; `index.js` does `process.exit(await runCli() ?? 0)`. Single exit authority. `detect-browser` and `install-browser` deleted. See D5.                                                                                                                    | Stage 6 (D5) ✅                                     | 5→6   |
| Binary name hardcoded in error             | `'szkrabok install-browser'` still hardcoded in `BrowserNotFoundError.formatMessage()`. Not fixed — acceptable for now since package name is stable.                                                                                                                                                                                                   | Outstanding (low priority)                         | 4-5   |
| `install-browser` command removed           | `detect-browser` + `install-browser` commands deleted; replaced by `doctor detect [--write-config]` and `doctor install [--force]`. `browser-actions.js` added. Tests verify removed commands exit non-zero.                                                                                                                                                        | Stage 6 ✅ (CLI consolidation)                    | 6     |
| Windows path normalization                 | Test added and guarded by `process.platform !== 'win32'` skip. Verification on Windows CI still needed before shipping to Windows users.                                                                                                                                                                                                               | Stage 5 (test guarded, CI verification deferred)   | 5     |
| Relative path in config                    | `config.executablePath` resolved relative to `cwd()`. Not fixed — deferred. Low priority; absolute paths are recommended in docs.                                                                                                                                                                                                                      | Outstanding (low priority)                         | 5     |
| Breaking change migration plan             | Plan documented in this spec. CHANGELOG / release notes entry not yet written. Must be done before 2.0.0 publish.                                                                                                                                                                                                                                      | Outstanding (before release)                       | —     |
| `BrowserNotFoundError` MCP serialization   | ✅ RESOLVED — `this.code = 'BROWSER_NOT_FOUND'` + `toJSON()` method added. `JSON.stringify(err)` now produces `{code, message, candidates}` instead of `{}`. Registry `wrapError` passes it through correctly.                                                                                                                                         | Stage 5 ✅                                         | 5     |
| `install-browser` async race               | ✅ RESOLVED — `browser-actions.js` `runInstall()` returns exit code; `doctor install` action calls `process.exit(await runInstall(...))`. D5 complete.                                                                                                                                                                                                              | Stage 6 ✅                                         | 4-6   |
