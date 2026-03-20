# Feature: session_run_test — composite session+test primitive

**Implements:** single-command session lifecycle + test run with deterministic invariants
**Depends on:** profile-cloning (launchClone, destroyClone), existing browser_run_test
**New runtime deps:** `cloneFromLive` (new — see below), `signalAttach` support in browser_run_test
**Related:** [feature-profile-leasing.md](./feature-profile-leasing.md)

---

## Problem

`browser_run_test` requires a pre-open session. Two separate MCP calls (open + run_test) introduce
temporal coupling: nothing enforces readiness between them, nothing enforces post-test policy.

Patching `browser_run_test` collapses three distinct layers:

- **session layer** — `session_manage`: open/close/clone
- **execution layer** — `browser_run_test`: run specs against an open session
- **coordination layer** — `session_run_test` (this feature): ensure session → enforce readiness → navigate → run → post-policy

`session_run_test` is the coordination layer only. It does not duplicate session or runner logic.

---

## Tool naming — full surface

This feature introduces `session_run_test` and also corrects naming inconsistencies across the
existing tool surface. All tools follow `noun_verb` with underscores, matching `@playwright/mcp`
conventions.

### Rename map

| Current name | New name | Change |
|---|---|---|
| `browser.run_test` | `browser_run_test` | separator only (`.` → `_`) |
| `workflow.scrape` | `browser_scrape` | separator + namespace (`workflow` → `browser`; operates on session page) |
| `scaffold.init` | `scaffold_init` | separator only (`.` → `_`) |
| `browser_run` | `browser_run` | no change |
| `session_manage` | `session_manage` | no change |

### Final surface

```
session_manage        — session lifecycle dispatcher (open/close/list/delete/endpoint)
session_run_test      — composite: managed session + test run (this feature)

browser_run           — ad-hoc code/script execution on open session
browser_run_test      — run .spec.js files against open session (was: browser.run_test)
browser_scrape        — scrape page to LLM-ready text (was: workflow.scrape)

scaffold_init         — init szkrabok project scaffold (was: scaffold.init)
```

---

## Core invariants

### 1. Lock scope — true critical section

The per-name lock covers:

1. session resolution
2. navigation readiness barrier
3. **test bootstrap attach barrier** — lock released only after `browser_run_test` confirms browser attachment

This prevents: parallel navigation mutation, early selector waits, SPA hydration races, clone launch
storms.

### 2. Dual session identity

Response always includes:

```js
session: {
  logicalName: "allegro",       // template identity — stable across calls
  runtimeName: "allegro#c91",   // clone id, or same as logicalName for templates
  mode: "clone",
}
```

Callers never lose the logical reference even when using ephemeral clones.

### 3. Strong readiness invariant

Navigation barrier: `waitUntil: "networkidle"` (not `domcontentloaded`).
Fallback timeout configurable via `navigation.timeout` (default 30 000 ms).

URL is required whenever `navigation.policy !== "never"` — enforced at entry, before any I/O.

### 4. LaunchOptions mismatch — migration-safe

```js
session.enforceLaunchOptionsMatch: false  // default: warn only
```

When `true`: hard fail on mismatch. Default is `false` so existing callers are unaffected when the
flag is later flipped to `true` globally.

Prerequisite: runtime must store full resolved `launchOptions` on pool entries (not just `preset`).
Until that is done, both the check and the warning are stubs.

### 5. Template ownership safety

Three policies when template session is open in clone mode:

```
templateConflict: "fail"            — default; hard error
templateConflict: "close-first"     — close template (triggers state save), then clone
templateConflict: "clone-from-live" — snapshot profile while template is live; leave template open
```

`"clone-from-live"` is the safest: no foreign lifecycle destruction. Requires `cloneFromLive(name)`
in the runtime — new function, see implementation notes.

### 6. Clone-keep guard

```js
postPolicy.recreateCloneOnKeep: false  // default
```

If `action: "keep"` and the clone was already destroyed: hard fail unless
`recreateCloneOnKeep: true`. Prevents the caller from silently losing the clone and continuing
against a stale or re-created session.

### 7. Failure phase propagation

Every exit path returns `{ error, phase }`. Test result is included in `postPolicy` failures.
Phases: `"session"` | `"test"` | `"postPolicy"`.

### 8. Runner worker safety

`session_run_test` forces `workers: 1` when delegating to `browser_run_test`. Prevents
multi-worker page mutation against a single session.

---

## Schema

```js
session_run_test({
  session: {
    name: "allegro",                         // required
    mode: "clone",                           // "clone" (default) | "template"
    enforceLaunchOptionsMatch: false,        // default false; flip to true for strict enforcement
    templateConflict: "fail",                // "fail" (default) | "close-first" | "clone-from-live"
    launchOptions: {                         // optional
      preset: "...",
      stealth: true,
      headless: false,
      disableWebGL: false,
      userAgent: "...",
      viewport: { width: 1280, height: 800 },
      locale: "pl-PL",
      timezone: "Europe/Warsaw",
    },
    navigation: {                            // optional; omit = policy "never"
      policy: "always",                     // "always" | "ifBlank" | "never"
      url: "https://allegro.pl",            // required if policy !== "never"
      timeout: 30000,                       // ms; default 30000
    },
  },
  test: {
    spec: "automation/buy.spec.ts",          // string or string[]; required
    grep: "...",                             // optional regex filter
    params: { KEY: "value" },               // optional env vars for spec
    config: "playwright.config.js",         // optional
    project: "automation",                  // optional
    reportFile: "sessions/last-run.json",   // optional
  },
  postPolicy: {
    action: "destroy",   // "destroy" (default for clone) | "save" (default for template) | "keep"
    recreateCloneOnKeep: false,  // if true: re-open clone if destroyed; default false = hard fail
  },
})
```

---

## Deterministic flow

```
1. validate: url required if navigation.policy !== "never"
2. acquire per-name lock
3. resolve session:
     clone mode:
       if template open:
         "fail"            → throw
         "close-first"     → sessionClose(template) then launchClone
         "clone-from-live" → cloneFromLive(template) → runtimeName
       else: sessionOpen(name, { isClone: true }) → runtimeName
     template mode:
       if already open + launchOptions supplied:
         enforceLaunchOptionsMatch → fail or warn (stub until pool stores full options)
       sessionOpen(name, launchOptions) → runtimeName = logicalName
4. navigation barrier (if policy !== "never"):
     "always"  → page.goto(url, { waitUntil: "networkidle" })
     "ifBlank" → goto only if page.url() === "about:blank"
5. browser_run_test(runtimeName, { workers:1, signalAttach:true, ...test })
     lock held until bootstrap attach signal received
     lock released
6. await test completion
7. post-policy:
     "destroy" → sessionClose (clone: destroyClone; template: close without save — use "save" to persist)
     "save"    → sessionClose (saves state; template only)
     "keep"    → verify session still open; reconnect if recreateCloneOnKeep; else hard fail
8. return { session: { logicalName, runtimeName, mode }, test: { ... } }
```

---

## Implementation steps

### Step 1 — renames (do first; no logic change)

| Task | File | What changes |
|---|---|---|
| Rename `browser.run_test` → `browser_run_test` | `src/tools/registry.js` | key only |
| Rename `workflow.scrape` → `browser_scrape` | `src/tools/registry.js` | key only |
| Rename `scaffold.init` → `scaffold_init` | `src/tools/registry.js` | key only |
| Update all docs/tests referencing old names | `docs/`, `tests/` | string replace |

Renames are mechanical. No handler, schema, or logic changes. Ship separately to keep diff minimal.

### Step 2 — `workers` param in `browser_run_test`

Add `workers` param to `run_test` handler and pass through to Playwright CLI (`--workers`).
Required before `session_run_test` can enforce `workers: 1`.

File: `src/tools/szkrabok_browser.js`, `src/tools/registry.js`.

### Step 3 — `signalAttach` in `browser_run_test`

Add `signalAttach: true` support. `run_test` resolves a signal promise once the Playwright worker
has attached to the CDP endpoint (`chromium.connectOverCDP()` succeeds in the spec fixture).
Requires a small protocol addition to the test fixture bootstrap.

Files: `src/tools/szkrabok_browser.js`, fixture bootstrap.

### Step 4 — `cloneFromLive` runtime function

New function in `packages/runtime/sessions.js`. Takes a snapshot of the running template's profile
without closing it. Must flush in-memory state to disk, then call `cloneProfileAtomic`.

**Risk:** Chrome holds open file handles while running. A live copy may capture partial writes.
Callers needing full consistency should use `"close-first"` instead.

Implementation complexity: medium-high. Requires OS-level profiling of Chrome file handle behavior.

### Step 5 — `session_run_test` tool

New file `src/tools/session_run_test.js`. Register in `registry.js`.

Dependencies: steps 1–4 must be complete (steps 2–4 can be stubbed with documented limitations).

---

## Implementation

### `src/tools/session_run_test.js`

```js
import { open as sessionOpen, close as sessionClose } from './szkrabok_session.js';
import { run_test } from './szkrabok_browser.js';
import { getSession, destroyClone, cloneFromLive } from '#runtime';

const locks = new Map();

const withLock = (name, fn) => {
  const prev = locks.get(name) ?? Promise.resolve();
  let release;
  const gate = new Promise(r => (release = r));
  locks.set(name, prev.then(() => gate));
  return prev.then(fn).finally(() => {
    release();
    if (locks.get(name) === gate) locks.delete(name);
  });
};

export const session_run_test = args => withLock(args.session.name, () => _run(args));

async function _run({ session, test, postPolicy = {} }) {
  const logicalName = session.name;
  const mode        = session.mode ?? 'clone';
  const nav         = session.navigation ?? { policy: 'never' };

  if (nav.policy !== 'never' && !nav.url)
    return { error: 'navigation.url required when policy !== "never"', phase: 'session' };

  let runtimeName;

  try {
    if (mode === 'clone') {
      let templateOpen = false;
      try { getSession(logicalName); templateOpen = true; } catch {}

      if (templateOpen) {
        const conflict = session.templateConflict ?? 'fail';
        if (conflict === 'close-first') {
          await sessionClose({ sessionName: logicalName });
        } else if (conflict === 'clone-from-live') {
          runtimeName = await cloneFromLive(logicalName);
        } else {
          throw new Error(`Template "${logicalName}" is open — close it or set templateConflict`);
        }
      }

      if (!runtimeName) {
        const r = await sessionOpen({
          sessionName:   logicalName,
          launchOptions: { ...session.launchOptions, isClone: true },
        });
        runtimeName = r.sessionName;
      }

    } else {
      let alreadyOpen = false;
      try { getSession(logicalName); alreadyOpen = true; } catch {}

      if (alreadyOpen && session.launchOptions) {
        // TODO: compare hash once pool stores full resolved options (stub)
        if (session.enforceLaunchOptionsMatch)
          throw new Error('launchOptions mismatch (enforceLaunchOptionsMatch enabled)');
        else
          console.warn('[session_run_test] launchOptions supplied for existing session — mismatch check pending pool support');
      }

      await sessionOpen({ sessionName: logicalName, launchOptions: session.launchOptions });
      runtimeName = logicalName;
    }
  } catch (e) {
    return { error: e.message, phase: 'session' };
  }

  try {
    if (nav.policy !== 'never') {
      const s = getSession(runtimeName);
      const shouldNav =
        nav.policy === 'always' ||
        (nav.policy === 'ifBlank' && s.page.url() === 'about:blank');

      if (shouldNav) {
        await s.page.goto(nav.url, {
          waitUntil: 'networkidle',
          timeout:   nav.timeout ?? 30000,
        });
      }
    }
  } catch (e) {
    return { error: e.message, phase: 'session' };
  }

  let testResult;
  try {
    testResult = await run_test({
      sessionName:  runtimeName,
      files:        Array.isArray(test.spec) ? test.spec : test.spec ? [test.spec] : [],
      grep:         test.grep,
      params:       test.params,
      config:       test.config,
      project:      test.project,
      workers:      1,
      reportFile:   test.reportFile,
      keepOpen:     false,
      signalAttach: true,
    });
  } catch (e) {
    return { error: e.message, phase: 'test' };
  }

  const action = postPolicy.action ?? (mode === 'clone' ? 'destroy' : 'save');

  try {
    if (action === 'destroy' || action === 'save') {
      await sessionClose({ sessionName: runtimeName });
    } else if (action === 'keep') {
      try {
        getSession(runtimeName);
      } catch {
        if (!postPolicy.recreateCloneOnKeep)
          throw new Error(`Session "${runtimeName}" no longer open and recreateCloneOnKeep is false`);
        await sessionOpen({ sessionName: runtimeName });
      }
    }
  } catch (e) {
    return {
      session: { logicalName, runtimeName, mode },
      test:    testResult,
      error:   e.message,
      phase:   'postPolicy',
    };
  }

  return {
    session: { logicalName, runtimeName, mode },
    test:    testResult,
  };
}
```

### `registry.js` additions

```js
// Rename existing keys (step 1):
'browser_run_test': { /* was: 'browser.run_test' — handler/schema unchanged */ },
'browser_scrape':   { /* was: 'workflow.scrape'  — handler/schema unchanged */ },
'scaffold_init':    { /* was: 'scaffold.init'    — handler/schema unchanged */ },

// New tool (step 5):
'session_run_test': {
  handler: sessionRunTest.session_run_test,
  description: `${SZKRABOK} Composite: open/clone session → navigate → run test → apply post-policy. ` +
    'Single deterministic command. mode:"clone" (default) is ephemeral; mode:"template" persists. ' +
    'Failure phases: session | test | postPolicy.',
  inputSchema: {
    type: 'object',
    required: ['session', 'test'],
    properties: {
      session: {
        type: 'object',
        required: ['name'],
        properties: {
          name:                      { type: 'string' },
          mode:                      { type: 'string', enum: ['clone', 'template'], default: 'clone' },
          enforceLaunchOptionsMatch: { type: 'boolean', default: false },
          templateConflict:          { type: 'string', enum: ['fail', 'close-first', 'clone-from-live'], default: 'fail' },
          launchOptions: {
            type: 'object',
            properties: {
              preset:       { type: 'string' },
              stealth:      { type: 'boolean' },
              headless:     { type: 'boolean' },
              disableWebGL: { type: 'boolean' },
              userAgent:    { type: 'string' },
              viewport: {
                type: 'object',
                properties: { width: { type: 'number' }, height: { type: 'number' } },
              },
              locale:   { type: 'string' },
              timezone: { type: 'string' },
            },
          },
          navigation: {
            type: 'object',
            required: ['policy'],
            properties: {
              policy:  { type: 'string', enum: ['always', 'ifBlank', 'never'] },
              url:     { type: 'string', description: 'Required when policy !== "never"' },
              timeout: { type: 'number', default: 30000 },
            },
          },
        },
      },
      test: {
        type: 'object',
        properties: {
          spec:       { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          grep:       { type: 'string' },
          params:     { type: 'object' },
          config:     { type: 'string' },
          project:    { type: 'string' },
          reportFile: { type: 'string' },
        },
      },
      postPolicy: {
        type: 'object',
        properties: {
          action:              { type: 'string', enum: ['destroy', 'keep', 'save'], description: 'Default: "destroy" for clone, "save" for template' },
          recreateCloneOnKeep: { type: 'boolean', default: false },
        },
      },
    },
  },
},
```

---

## Implementation status

### Step 1 — renames

| Task | File | Status |
|---|---|---|
| `browser.run_test` → `browser_run_test` | `src/tools/registry.js` | done |
| `workflow.scrape` → `browser_scrape` | `src/tools/registry.js` | done |
| `scaffold.init` → `scaffold_init` | `src/tools/registry.js` | done |
| Update docs/tests referencing old names | `docs/`, `tests/` | done |

### Step 2–5 — session_run_test

| Function | File | Status |
|---|---|---|
| `workers` param in `browser_run_test` | `src/tools/szkrabok_browser.js` | not started |
| `signalAttach` support | `src/tools/szkrabok_browser.js` + fixture | not started |
| `cloneFromLive` | `packages/runtime/sessions.js` | not started |
| `session_run_test` + `withLock` | `src/tools/session_run_test.js` | not started |
| `session_run_test` registered | `src/tools/registry.js` | not started |
| `launchOptions` hash stored in pool | `packages/runtime/pool.js` | not started (mismatch check stub until done) |

---

## Test plan

Identifier scheme: `EX-{layer}.{n}`

### EX-1 — unit (mocked sessionOpen, run_test, getSession, sessionClose)

| ID | Test |
|----|------|
| EX-1.1 | clone mode: sessionOpen called with `isClone:true` |
| EX-1.2 | clone mode: runtimeName is generated clone id, logicalName unchanged |
| EX-1.3 | clone mode: sessionClose called after test (postPolicy destroy) |
| EX-1.4 | template mode: sessionOpen called without `isClone` |
| EX-1.5 | template mode: runtimeName equals logicalName |
| EX-1.6 | template mode: sessionClose called after test (postPolicy save) |
| EX-1.7 | postPolicy keep + session alive: no reconnect attempt |
| EX-1.8 | postPolicy keep + session dead + recreateCloneOnKeep false: returns postPolicy error |
| EX-1.9 | postPolicy keep + session dead + recreateCloneOnKeep true: sessionOpen called |
| EX-1.10 | navigation policy always: page.goto called with networkidle |
| EX-1.11 | navigation policy ifBlank + page is blank: page.goto called |
| EX-1.12 | navigation policy ifBlank + page is not blank: page.goto NOT called |
| EX-1.13 | navigation policy never: page.goto NOT called |
| EX-1.14 | navigation policy always + url missing: returns session error before any I/O |
| EX-1.15 | session open failure → `{ error, phase:"session" }`; test not run |
| EX-1.16 | navigation failure → `{ error, phase:"session" }`; test not run |
| EX-1.17 | test failure → `{ error, phase:"test" }`; postPolicy still runs |
| EX-1.18 | postPolicy failure → `{ error, phase:"postPolicy", test: {...} }` |
| EX-1.19 | concurrent call same name: second waits for first |
| EX-1.20 | concurrent call different names: both run in parallel |
| EX-1.21 | templateConflict fail + template open → session error |
| EX-1.22 | templateConflict close-first + template open → sessionClose called before clone |
| EX-1.23 | templateConflict clone-from-live + template open → cloneFromLive called, template not closed |
| EX-1.24 | enforceLaunchOptionsMatch true + session open + launchOptions supplied → session error |
| EX-1.25 | enforceLaunchOptionsMatch false + session open + launchOptions supplied → warn, continue |
| EX-1.26 | run_test called with workers:1 always |

### EX-2 — integration (real MCP, real browser)

| ID | Test |
|----|------|
| EX-2.1 | clone mode end-to-end: session created, test runs, clone destroyed |
| EX-2.2 | template mode end-to-end: session saved, test runs, state persists |
| EX-2.3 | navigation always: page on correct url when test runs |
| EX-2.4 | dual identity in response: logicalName and runtimeName both present and correct |

---

## What is not addressed

**`cloneFromLive` correctness guarantee** — live profile copy while Chrome is running may capture
partial writes. Safe only when the profile is idle. Callers needing consistency should use
`"close-first"`.

**LaunchOptions mismatch detection** — requires runtime pool to store full resolved `launchOptions`.
Until then, both check and warning are stubs regardless of `enforceLaunchOptionsMatch`.

**`signalAttach` lock-release semantics** — requires fixture-level protocol addition. Until
implemented, lock is released immediately after `browser_run_test` is called, not after browser
attach.

**`postPolicy: "export"`** — save clone state as new template. Deferred.

**Distributed concurrency** — `withLock` is in-process only. Multi-host requires outer coordination.
