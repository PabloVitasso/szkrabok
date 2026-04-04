# Feature: Browser CLI consolidation

**Status: Implemented** (all 5 stages complete, 89 tests passing)

## Goal

One entry point for browser detection and installation. No duplicated resolution
logic across CLI commands. Persistent config write that is safe and section-scoped.
Install is idempotent — runs to desired state, not blind mutation.

---

## What was (before implementation)

Three commands with overlapping concerns:

| Command | What it actually did |
|---------|----------------------|
| `detect-browser` | `findChromiumPath()` (old compat wrapper), prints toml snippet |
| `install-browser` | always downloaded Playwright Chromium regardless of existing browser |
| `doctor` step 4 | `buildCandidates` + `populateCandidates` + `validateCandidate` inline |

Problems fixed:

- `install-browser` never checked if a browser already existed before downloading
- `install-browser` tip recommended `CHROMIUM_PATH` env var — ephemeral, not visible to
  MCP server spawned by Claude; the persistent path is `executablePath` in config.toml
- No command offered to write the discovered path to config
- `doctor` hinted nothing when the winner was not pinned via config
- `populateCandidates` used chrome-launcher with no executable validation — snap wrapper
  stubs (e.g. `/usr/bin/chromium-browser` on Ubuntu) passed `accessSync(X_OK)` but
  failed at launch with a useless error

---

## What is already centralized (do not duplicate)

`buildCandidates`, `populateCandidates`, `resolveChromium`, `validateCandidate` are
pure/injectable functions in `packages/runtime/resolve.js`. They are the single source
of truth for candidate construction and resolution logic.

Priority order is declared in `resolve.js` as the `SOURCES` constant — stable and
intentional. `env` beats `config` so runtime overrides work without editing files:

```
1. env        — CHROMIUM_PATH env var (highest — runtime override)
2. config     — executablePath in szkrabok.config.toml
3. system     — chrome-launcher discovery
4. playwright — playwright-managed Chromium (lowest)
```

`browser-actions.js` wraps this chain; it does not reimplement it.

---

## Files changed

| File | Change |
|------|--------|
| `packages/runtime/resolve.js` | `isFunctionalBrowser` probe in `populateCandidates`; `spawnSync` import |
| `packages/runtime/errors.js` | `BrowserNotFoundError` message updated: `install-browser` → `doctor install` |
| `src/cli/lib/browser-actions.js` | **new** — `runDetect`, `runInstall`, `writeExecPath`, `getGlobalConfigPath` |
| `src/cli/commands/doctor.js` | `detect`/`install` subcommands; step 4 uses `runDetect()`; persistence hint |
| `src/cli/commands/detect-browser.js` | **deleted** |
| `src/cli/commands/install-browser.js` | **deleted** |
| `src/cli/index.js` | removed `detect-browser` and `install-browser` registrations |
| `tests/node/runtime/resolve.test.js` | new categories 12–16; updated categories 8, 9 |

---

## Implementation stages

### Stage 1 — Snap wrapper bug fix

**Problem:** `populateCandidates` assigns the first chrome-launcher result as the system
candidate without verifying it is a functional browser. On Ubuntu,
`/usr/bin/chromium-browser` is a 2 KB shell stub that exits 1 with:

```
Command '/usr/bin/chromium-browser' requires the chromium snap to be installed.
```

It passes `accessSync(X_OK)`, so `validateCandidate` accepts it. The browser then fails
at launch with no useful error message.

**Fix:** add a `--version` probe in `populateCandidates` before assigning the system path:

```js
for (const path of installs) {
  const r = spawnSync(path, ['--version'], { timeout: 5000, encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) { c.path = path; break; }
}
```

**Scope of the probe:** this filters obvious stubs (shell scripts that exit 1, snap
wrappers that print nothing). It does not guarantee the binary is usable by
Playwright/CDP — a binary that responds to `--version` may still fail to launch
headless, have sandbox permission issues, or use an incompatible CDP fork. The probe's
contract is "not an obvious stub", not "Playwright-compatible". This is explicitly
sufficient for detection purposes; full launch validation would require a CDP handshake
and is out of scope for `populateCandidates`.

`spawnSync` is only called inside `populateCandidates` (impure async discovery). The
pure core — `validateCandidate` and `resolveChromium` — never spawns processes. The
category 9 static test currently asserts "resolve.js must not contain 'child_process'";
this must be updated to assert the correct invariant: the import may exist, but
`spawnSync` must not appear inside `validateCandidate` or `resolveChromium`.

**Files:** `packages/runtime/resolve.js`

**Tests (category 12 — snap wrapper fix, 3 tests):**

| Test | Setup | Assert |
|------|-------|--------|
| stub exits 1 — system candidate stays null | stub binary exits 1 | `c.path` remains null after `populateCandidates` |
| stub exits 0, empty stdout — stays null | stub prints nothing | `c.path` remains null |
| real binary — candidate populated | `/bin/ls` (exits 0, non-empty stdout) | `c.path` set to `/bin/ls` |

Tests use a helper `isFunctionalBrowser(path)` extracted from `populateCandidates` so
the probe logic is unit-testable without faking chrome-launcher.

**Update category 9 static test:**

Change assertion from "resolve.js must not contain 'child_process'" to
"spawnSync must not appear inside validateCandidate or resolveChromium" — checked by
verifying the string `spawnSync` only appears after `populateCandidates` in the file.

**Stage 1 checklist:**

- [x] `spawnSync` probe added to `populateCandidates` system candidate block
- [x] `isFunctionalBrowser(path)` helper extracted and exported
- [x] Stub binary (exits 1) rejected — system candidate stays null
- [x] Stub binary (empty stdout) rejected — system candidate stays null
- [x] Real binary accepted — candidate populated
- [x] Category 9 static test updated — invariant is "pure functions don't spawn"
- [x] All existing tests pass

---

### Stage 2 — `browser-actions.js` shared module

New file `src/cli/lib/browser-actions.js`. Wraps the `#runtime` resolution chain.
Contains no resolution logic — delegates entirely to `resolve.js`.

**Public API:**

```js
runDetect()             → Promise<{ winner, results }>
runInstall({ force })   → Promise<0 | 1>   // returns exit code, never calls process.exit
writeExecPath(path)     → Promise<configPath>
getGlobalConfigPath()   → string
```

**`runDetect()`**

```js
import { initConfig, getConfig, ConfigError } from '../../config.js';
import { buildCandidates, populateCandidates, resolveChromium, validateCandidate } from '#runtime';

export async function runDetect() {
  initConfig([]);
  let cfg;
  try {
    cfg = getConfig();
  } catch (err) {
    // Distinguish: uninitialized config (expected in CLI context, treat as empty)
    // vs malformed config (TOML parse error, permission denied — surface to caller).
    if (err instanceof ConfigError || err.code === 'CONFIG_UNINITIALIZED') {
      cfg = {};
    } else {
      throw new Error(`config error: ${err.message}`);
    }
  }
  const candidates = buildCandidates({ executablePath: cfg.executablePath });
  await populateCandidates(candidates);
  const results = candidates.map(c => ({
    source: c.source, path: c.path, ...validateCandidate(c.path),
  }));
  const resolved = resolveChromium(candidates);
  const winner = resolved.found
    ? { found: true, path: resolved.path, source: resolved.source }
    : { found: false };
  return { winner, results };
}
```

Config error handling: `getConfig()` throws when the config file exists but is
unreadable or malformed. `runDetect()` must not silently convert a broken TOML file
into a "no config" signal — that hides misconfiguration from the user. The narrow
catch passes through only the expected "not yet initialized" case (which is normal
in CLI context where `initConfig([])` is called immediately before). All other errors
propagate and surface in CLI output as a config error, not a missing browser.

`ConfigError` and `CONFIG_UNINITIALIZED` are the existing error discriminators in
`packages/runtime/config.js` — check and use whichever is present; do not introduce
new error types.

**`runInstall({ force = false })`**

**Convergence target:** Playwright-managed Chromium is installed and resolvable.
This is the explicit goal — not "any working browser exists". The idempotency guard
(steps 2–3) exits early when the target is already met or when a non-Playwright
browser is found and `--force` is not set. It does not change the target.

```
1. { winner } = await runDetect()
2. winner.found && winner.source === 'playwright' && !force:
     print "Playwright Chromium already installed: <path>"
     return 0                                       ← target already met
3. winner.found && winner.source !== 'playwright' && !force:
     print "Browser found via <source>: <path>"
     print "To install Playwright-managed Chromium anyway: use --force"
     print "To pin this browser instead: szkrabok doctor detect --write-config"
     return 0                                       ← user has a browser; don't download without consent
4. spawn: npx playwright install chromium           ← converge toward target
5. on success: runDetect() again, print result + config hint; return 0
6. on failure: print exit code, suggest doctor; return 1
```

Returns an integer exit code. Caller is responsible for `process.exit`.

**`writeExecPath(path)`**

Section-scoped, line-based TOML splice. No TOML parser — only edits `[default]`.
Throws loudly on ambiguous state.

```
1. Read lines[] from getGlobalConfigPath() (empty array if file absent)
2. Count lines matching /^\[default\]\s*$/:
     2+ matches → throw Error('malformed config: multiple [default] sections')
3. Find defIdx: index of the single /^\[default\]\s*$/ line (-1 if absent)
4. Find nextIdx: next /^\[/ after defIdx (or end-of-file)
5. Search lines[defIdx+1 .. nextIdx-1] for /^executablePath\s*=/:
     0 matches → insert new line at defIdx+1
     1 match   → replace in-place
     2+ matches → throw Error('malformed config: multiple executablePath in [default]')
6. If defIdx === -1: prepend ["[default]", `executablePath = "${path}"`, ""]
7. Create configDir if absent; write result
8. Return configPath
```

Preserves all formatting outside the modified line. Never touches other sections.
Throws before any write on both ambiguity cases: duplicate sections and duplicate keys.

**`getGlobalConfigPath()`**

```js
export function getGlobalConfigPath() {
  return process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'szkrabok', 'config.toml')
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'szkrabok', 'config.toml');
}
```

**Files:** `src/cli/lib/browser-actions.js` (new)

**Tests (category 13 — browser-actions unit, 9 tests):**

| Test | Assert |
|------|--------|
| `runDetect()` shape | winner has `found`; results has 4 entries with source/path/ok/reason |
| `runDetect()` winner matches `resolveChromium` | same path/source as direct call |
| `writeExecPath` — no [default] section | creates `[default]` + key at top |
| `writeExecPath` — [default] exists, key absent | inserts key after header |
| `writeExecPath` — [default] exists, key present | replaces in-place, rest unchanged |
| `writeExecPath` — multiple keys in [default] | throws without writing |
| `writeExecPath` — multiple [default] sections | throws without writing |
| `writeExecPath` — other sections untouched | content outside [default] unchanged |
| `getGlobalConfigPath()` | returns absolute path containing `szkrabok` and `config.toml` |

`writeExecPath` tests use a temp file, never the real global config.

**Stage 2 checklist:**

- [x] `src/cli/lib/browser-actions.js` created
- [x] `runDetect()` — shape correct, delegates entirely to resolve.js
- [x] `runInstall()` — idempotent: 3 cases (playwright found, any browser found, no browser)
- [x] `writeExecPath()` — 4 cases + throws on multiple keys + throws on multiple [default] sections
- [x] `getGlobalConfigPath()` — XDG-aware, platform-correct
- [x] Category 13 tests pass (9 tests)

---

### Stage 3 — `doctor detect` / `doctor install` subcommands

Add subcommands to `doctor`. Default `.action()` (full health check) is unchanged.

**Commander.js structure:**

```js
const doctor = program.command('doctor')
  .description('Check szkrabok environment and dependencies')
  .action(safe(runFullDoctor));

doctor.command('detect')
  .description('Detect Chrome/Chromium and show config hint')
  .option('--write-config', 'Write discovered path to ~/.config/szkrabok/config.toml')
  .action(safe(runDoctorDetect));

doctor.command('install')
  .description('Install Chromium via Playwright (idempotent)')
  .option('--force', 'Download even if a browser is already available')
  .action(safe(runDoctorInstall));
```

**`runDoctorDetect({ writeConfig })`**

```
1. { winner, results } = await runDetect()
2. Print candidate table (same tag format as doctor step 4)
3. if winner.found:
     print "Resolved: <source> — <path>"
     if winner.source !== 'config':
       print "  Hint: path not pinned — run with --write-config to save to config.toml"
     if writeConfig:
       configPath = await writeExecPath(winner.path)
       print "  Written to: <configPath>"
   else:
     print "No valid browser found. Run: szkrabok doctor install"
```

Hint condition `source !== 'config'` covers all unstable sources:
- `env`: env var not propagated to headlessly-spawned MCP server
- `system`: path changes across OS updates
- `playwright`: path changes across Playwright version upgrades

**`runDoctorInstall({ force })`**

Delegates to `runInstall({ force })`. Exits via `process.exit(code)`.

**`runFullDoctor` step 4 — refactored**

Replace inline resolution with `runDetect()`. Output format identical. Add hint:

```js
if (winner.source !== 'config') {
  console.log('  Hint: pin this path — run: szkrabok doctor detect --write-config');
}
```

**Files:** `src/cli/commands/doctor.js`

**Tests (category 14 — doctor detect CLI, 5 tests):**

| Test | Setup | Assert |
|------|-------|--------|
| valid browser found | `CHROMIUM_PATH=/bin/ls` | stdout contains `Resolved:`, exits 0 |
| no browser found | no CHROMIUM_PATH, no system/playwright | stdout contains install hint, exits 0 |
| hint shown — source != config | `CHROMIUM_PATH=/bin/ls` | stdout contains `--write-config` hint |
| --write-config writes file | temp config dir via `XDG_CONFIG_HOME` | file contains `executablePath = "..."` |
| --write-config prints written path | same | stdout contains `Written to:` |

**Tests (category 15 — doctor install CLI, 4 tests):**

| Test | Setup | Assert |
|------|-------|--------|
| playwright already installed — no download | playwright path valid | exits 0, "already installed", npx sentinel not written |
| browser found non-playwright — no download | `CHROMIUM_PATH=/bin/ls` | exits 0, no-op message, npx sentinel not written |
| no browser — downloads (mock npx exits 0) | fake npx, no CHROMIUM_PATH | exits 0, prints resolution result |
| install failure (mock npx exits 2) | fake npx exits 2 | exits non-zero, stderr contains "szkrabok doctor" |

"npx not called" assertion: prepend a fake npx that writes a sentinel file; assert
sentinel absent after command.

**Update category 7 doctor tests:**

Add one test: `doctor` (no subcommand) shows `--write-config` hint when winner source
is not `config`.

**Stage 3 checklist:**

- [x] `doctor detect` subcommand registered
- [x] `doctor install` subcommand registered
- [x] `doctor` default action — step 4 uses `runDetect()`
- [x] Persistence hint shown when `source !== 'config'`
- [x] `--write-config` writes executablePath to global config path
- [x] Category 14 tests pass (5 tests)
- [x] Category 15 tests pass (4 tests)
- [x] All existing category 7 tests pass

---

### Stage 4 — Remove `detect-browser` and `install-browser`

Delete the old commands and remove them from registration. No aliases, no deprecation
notices — clean removal.

**Files:**

- `src/cli/commands/detect-browser.js` — deleted
- `src/cli/commands/install-browser.js` — deleted
- `src/cli/index.js` — remove both from `CLI_COMMANDS`

**Update category 8 static test:**

Current test reads `install-browser.js` and asserts it imports `resolveChromium` from
`#runtime`. After deletion, update to read `browser-actions.js` instead:

```js
test('browser-actions.js imports from #runtime — no hardcoded path logic', async () => {
  const src = await readFile(
    join(REPO_ROOT, 'src', 'cli', 'lib', 'browser-actions.js'), 'utf8'
  );
  assert.ok(src.includes("from '#runtime'"), ...);
  assert.ok(src.includes('resolveChromium'), ...);
});
```

**Update category 8 mock-npx tests:**

Change invocation from `install-browser` to `doctor install`:

```js
[CLI, 'doctor', 'install']  // was: [CLI, 'install-browser']
```

Assertions unchanged — same behavior, new command name.

**Tests (category 16 — removed commands rejected, 2 tests):**

| Test | Assert |
|------|--------|
| `detect-browser` → unknown command error | exit non-zero, stderr contains unknown command |
| `install-browser` → unknown command error | exit non-zero, stderr contains unknown command |

**Stage 4 checklist:**

- [x] `detect-browser.js` deleted
- [x] `install-browser.js` deleted
- [x] Both removed from `CLI_COMMANDS` in `src/cli/index.js`
- [x] Category 8 static test updated to read `browser-actions.js`
- [x] Category 8 mock-npx tests updated to use `doctor install`
- [x] Category 16 tests pass (2 tests)
- [x] All existing tests pass

---

### Stage 5 — `install-browser` tip update

Replace the `export CHROMIUM_PATH=...` tip in `doctor install` output with the
persistent-config workflow. `CHROMIUM_PATH` is ephemeral and not visible to a
headlessly-spawned MCP server.

**New tip (on successful install):**

```
Chromium installed (playwright-managed).
  Path: /home/user/.cache/ms-playwright/chromium-1155/chrome-linux/chrome

  To use an existing browser instead of downloading next time:
    szkrabok doctor detect --write-config   (detect and save to config.toml)
    szkrabok doctor detect                  (see what was found without writing)

  To use an env var (current session only, not visible to MCP server):
    export CHROMIUM_PATH=/usr/bin/google-chrome
```

**Update category 8 mock-npx test:**

Existing assertion `stdout.includes('CHROMIUM_PATH')` remains valid (tip still present).
Add: `stdout.includes('doctor detect --write-config')`.

**Stage 5 checklist:**

- [x] `doctor install` success message shows `doctor detect --write-config` tip
- [x] `CHROMIUM_PATH` tip still present as secondary note
- [x] Mock-npx test asserts `doctor detect --write-config` in output

---

## Invariants to preserve

All existing invariants (I1–I7) from `feature-defer-browser-install.md` are unaffected.
Additional invariants introduced by this feature:

- **I8 — install is idempotent** — `doctor install` with a browser already present
  exits 0 without spawning `npx playwright install` (unless `--force`)
- **I9 — config write is section-scoped** — `writeExecPath` never modifies lines outside
  `[default]`; throws rather than silently corrupting ambiguous config
- **I10 — no resolution logic outside browser-actions + resolve.js** — `doctor.js`
  contains no `buildCandidates`/`resolveChromium` calls; all resolution goes through
  `runDetect()`

---

## Stage summary

| Stage | Focus | Files changed | Tests added/updated | Invariants |
|-------|-------|---------------|---------------------|------------|
| 1 | Snap wrapper bug fix | 1 | cat 12 (3) + cat 9 update | I5 tightened |
| 2 | `browser-actions.js` | 1 new | cat 13 (9) | I8, I9 |
| 3 | doctor subcommands | 1 | cat 14 (5) + cat 15 (4) + cat 7 update | I7, I8, I10 |
| 4 | Delete old commands | 3 | cat 8 update + cat 16 (2) | I10 |
| 5 | install tip update | 0 | cat 8 addition (1) | — |
| **Total** | | **~5 unique** | **~24 new** | I8–I10 |
