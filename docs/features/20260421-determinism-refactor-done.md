# Szkrabok Runtime – Determinism & Resolution Refactor
## Feature (Done — 2026-04-21)

Implemented in: `packages/runtime/config.js`, `packages/runtime/resolve.js`,
`packages/runtime/errors.js`, `packages/runtime/launch.js`, `src/server.js`, `src/index.js`,
`src/cli/lib/browser-actions.js`.

Tests: `tests/node/config-lifecycle.test.js` (new), `tests/node/runtime/resolve.test.js` (Category 17 added).

---

## Implementation Status

| # | Section | Status |
|---|---------|--------|
| 10 | CLI→ENV leakage | Done |
| 8 | resolvePreset phantom + error classes | Done |
| 2 | Bound cwd (no walk-up) | Done |
| 1+9 | Provisional→final lifecycle | Done |
| 5 | Deep-freeze candidate entries | Done |
| 6 | Validation tier contract (naming + doc) | Done |
| 7 | Config source provenance (`getConfigMeta`) | Done |
| 3 | Structured configSource | Deferred |
| 4 | deepMerge null semantics | Deferred |

---

## §1 + §9 — Lifecycle Model

**Real. Medium effort. Must fix.**

### Problem

`server.js` calls `initConfig([])` on startup (provisional), then again with MCP roots in
`oninitialized` (final). Any tool call between these two events uses provisional config with
no way to detect or prevent it.

### Change

Introduce explicit lifecycle states. Replace `initConfig` with two functions:

```js
// phases: 'provisional' | 'final'
let _phase = null;
let _config = null;
let _configMeta = null;   // { phase, source, previousSource }
```

```js
export const initConfigProvisional = ({ explicitConfigPath } = {}) => {
  const { toml, source } = _discover({ explicitConfigPath, roots: [] });
  _config = Object.freeze(buildConfig(toml ?? {}));
  _phase = 'provisional';
  _configMeta = { phase: 'provisional', source, previousSource: null };
};

export const finalizeConfig = (roots, { explicitConfigPath } = {}) => {
  const { toml, source } = _discover({ explicitConfigPath, roots });
  const previous = _configMeta?.source ?? null;
  _config = Object.freeze(buildConfig(toml ?? {}));
  _phase = 'final';
  _configMeta = { phase: 'final', source, previousSource: previous };
};
```

### `getConfig` — safe by default

```js
export const getConfig = ({ allowProvisional = false } = {}) => {
  if (!_config) throw new ConfigNotInitializedError();
  if (!allowProvisional && _phase !== 'final') throw new ConfigNotFinalError();
  return _config;
};
```

Default blocks provisional reads. Callers that need provisional access must be explicit:
`getConfig({ allowProvisional: true })`. Misuse is now opt-in, not opt-out.

### Freeze config objects

`buildConfig` output is frozen immediately on assignment. A stale reference held across an
async span cannot be mutated — the object is immutable. Stale reads are still possible but
their blast radius is bounded: the stale config reflects a consistent snapshot, not a
partially-written one.

### server.js changes

```js
initConfigProvisional();  // was: initConfig([])

server.oninitialized = async () => {
  const { roots } = await server.listRoots();
  finalizeConfig(roots.map(r => r.uri.replace(/^file:\/\//, '')));
};
```

### `checkBrowser()` gate

`checkBrowser()` calls `getConfig()` with no flag → throws `CONFIG_NOT_FINAL` if called before
finalization. §9 is now enforced by the default, not by a separate flag in `checkBrowser`.

---

## §2 — Bound cwd Discovery

**Real. Small. Must fix.**

`config.js:169`: `walkUp(process.cwd(), null)` — unbounded walk-up to filesystem root.

### Change

Check only `process.cwd()` itself, no traversal:

```js
// was: walkUp(process.cwd(), null)
const data = loadTomlFromDir(process.cwd());
if (data) { toml = data; source = `cwd (${process.cwd()})`; }
```

### Note: cwd file guard is already implemented

`loadTomlFromDir` looks for `szkrabok.config.toml` or `szkrabok.config.local.toml` specifically
(config.js:22-23). If cwd is `/tmp` or a build dir and neither file exists, `loadTomlFromDir`
returns `null`. The marker-file guard the spec describes is already in place — no additional
change needed beyond removing the walk-up.

---

## §5 — Deep-Freeze Candidate Entries

**Real. Small. Should fix.**

`populateCandidates` currently mutates in-place. Fix: return a new frozen array with frozen entries.

```js
export const populateCandidates = async (candidates) => {
  const out = await Promise.all(candidates.map(async c => {
    const path = await _probeCandidate(c);
    return Object.freeze({ ...c, path });
  }));
  return Object.freeze(out);
};
```

Shallow freeze of the array alone (`Object.freeze(out)`) leaves entries mutable
(`candidates[0].path = "bad"` would succeed). Each entry must be frozen individually.

Callers update to: `const populated = await populateCandidates(candidates);`

---

## §6 — Validation Tier Contract

**Real. Small. Should fix.**

Two tiers, enforced by naming convention and documented as a rule:

| Function | Used in | Cost | Rule |
|----------|---------|------|------|
| `isFunctionalBrowser(path)` | runtime (every launch) | stat + X_OK + `--version` | MUST stay cheap |
| `probeBrowserLaunch(path)` | `doctor` only | headless spawn probe | MUST NOT be called in runtime |

`isFunctionalBrowser` stays in `resolve.js`. `probeBrowserLaunch` lives in a separate
`doctor.js` module — module boundary enforces the constraint structurally. Runtime cannot
import `doctor.js` without it being visible in review.

---

## §7 — Config Source Provenance

**Real. Small. Should fix.**

When `finalizeConfig` runs, the provisional source is currently lost. Track both:

```js
_configMeta = {
  phase,           // 'provisional' | 'final'
  source,          // current source string/object
  previousSource   // source from provisional phase, null if never provisional
}
```

Expose via `getConfigMeta()`. Useful for `doctor` output and debugging divergence between
what the server started with vs. what it ended up using.

---

## §8 — Preset Resolution + Error Class Consistency

**Real. Small. Must fix.**

### resolvePreset phantom

`config.js:205-208`: fallback to `buildConfig({})` when `_config` is null silently ignores all
config sources. Fix: throw `ConfigNotInitializedError`.

### Additional site

`launch.js:211-215`: `checkBrowser()` has the same phantom fallback:
```js
try { config = getConfig(); } catch { config = {}; ... }
```
Remove the catch. `getConfig()` now throws `CONFIG_NOT_FINAL` cleanly.

### Error class consistency

Ad-hoc `Object.assign(new Error(...), { code })` is inconsistent with the class-based
`BrowserNotFoundError`. Introduce proper classes:

```js
export class ConfigNotInitializedError extends Error {
  constructor() {
    super('CONFIG_NOT_INITIALIZED');
    this.name = 'ConfigNotInitializedError';
    this.code = 'CONFIG_NOT_INITIALIZED';
  }
}

export class ConfigNotFinalError extends Error {
  constructor() {
    super('CONFIG_NOT_FINAL');
    this.name = 'ConfigNotFinalError';
    this.code = 'CONFIG_NOT_FINAL';
  }
}
```

Catch-by-code is now reliable and consistent with `BrowserNotFoundError`.

### Breaking: tests

Tests that call `resolvePreset()` or `checkBrowser()` without `initConfigProvisional()` will
throw. They must call `initConfigProvisional()` (or a test helper) first.

---

## §10 — CLI→ENV Leakage

**Real. Small. Must fix.**

`src/index.js:28`:
```js
process.env.SZKRABOK_CONFIG = args[configFlagIdx + 1];
```

Leaks to child processes (browser subprocesses, playwright workers) and to libraries that
read env vars lazily after startup, making test environments nondeterministic.

### Change

```js
let explicitConfigPath = null;
if (configFlagIdx !== -1 && args[configFlagIdx + 1]) {
  explicitConfigPath = args[configFlagIdx + 1];
}
initConfigProvisional({ explicitConfigPath });
```

`initConfigProvisional` uses `explicitConfigPath` directly instead of reading
`process.env.SZKRABOK_CONFIG`. The env var read in `initConfig` stays as a fallback for
external callers (e.g. tests that set the env var directly) — only the CLI write is removed.

---

## §7 — Error Model

**Already done. No change.**

`BrowserNotFoundError` has `toJSON()`, `this.code`, `this.candidates`, `this.configSource`.
`formatMessage` is presentation-only. The error model is already correctly decoupled.

---

## §3 — Structured Config Source

**Real. Low priority.**

`_configSource` is a string. Structured replacement deferred until `doctor` command needs to
consume it programmatically. When §7 (config source provenance) lands, this becomes part of
`_configMeta.source`.

---

## §4 — deepMerge Null Semantics

**Low priority. Requires explicit decision.**

Current `deepMerge`: `null` sets null (does not delete). Null-as-delete would be new behavior
with non-obvious implications for `.local.toml` overrides. Defer until a concrete use case
requires it. Add a comment to `deepMerge` documenting current behavior.
