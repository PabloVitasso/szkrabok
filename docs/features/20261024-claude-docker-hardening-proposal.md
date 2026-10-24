# Feature: hardening szkrabok for claude-docker (host-side MCP server)

## Status

Proposal. No implementation yet.

- Pass 1: eight claims verified against the working tree (file:line refs below).
- Pass 2 (2026-10-23, re-audit): line refs re-checked; nine extra findings
  (E1-E9), one of them critical (E1 upgraded: `params` → `NODE_OPTIONS` code
  execution, reproduced on Node 24); gating model fixed to agree with the
  companion; `browser_run` page-mode contract reworked (the pass-1 contract did
  not work for ESM files); session-name regex fixed (accepted `..`, rejected
  generated clone ids).

Companion: [20261024-claude-docker-deployment-companion-proposal.md](./20261024-claude-docker-deployment-companion-proposal.md)
— the host-side wiring (mcp-hosts.json flags, spec root, wrapper docs). Not
needed for safety. It is the opt-in that brings test tooling back under the new
model.

## Goal

szkrabok runs on the host as the browser MCP server for
`/home/jones2/scripts/claude-docker/`. The wrapper starts it
(`config/mcp-hosts.json` → `uvx mcp-proxy --cwd /home/jones2/szkrabok-npx --
node .../bin/szkrabok.js`). It listens on 127.0.0.1 only, and the container
reaches it over a unix socket relay. Tool calls come from the container, while
every side effect lands on the host as `jones2`.

Required property: **a hostile tool call from the container must not give host
code execution, host file reads, host filesystem writes outside two fixed
directories, or reach into host-local network services.** The container is
treated as prompt-compromised, so tool arguments are hostile input. The trusted
control point is the host side, which is reviewed at deploy
(`config/mcp-hosts.json`, the server binary, the spec root).

## Threat model

| Input | Trust |
|---|---|
| CLI flags in `config/mcp-hosts.json` | trusted. Written by hand, reviewed at deploy, mount-guarded |
| tool arguments from the container | hostile |
| MCP client-declared roots | hostile. The project dir is mounted read-write in the container |
| `szkrabok.config.toml` found via roots/cwd | hostile unless the path is host-controlled |
| `.env` in `process.cwd()` (loaded by `dotenv/config`, `src/index.js:2`) | trusted only while no tool can write cwd (E5) |
| files under the spec root (specs, config, its `node_modules`) | trusted. Host-authored, never written by szkrabok or by Playwright runs (E4) |
| web content the browser loads | hostile. It runs on the host network stack (E7) |
| CDP endpoint | not relayed to the container. Reachable from the host browser itself (E7) |

Existing synergy to keep: the claude-docker mount guard refuses to run when the
mounted project overlaps any path named in `mcp-hosts.json` (command paths and
`--cwd` values). Every path we add as a server flag falls under that guard.
The companion must confirm the guard checks **both** directions (project
contains the path, and the path contains the project). The wrapper repo is not
visible from this tree.

## Verified findings

### Pass 1 (all eight hold)

| # | Claim | Evidence |
|---|---|---|
| 1 | dangerous tools ungated by any flag | `src/tools/registry.js:12-252`. Every handler is registered unconditionally, with no CLI or config gate |
| 2 | `browser_run` executes in Node | `src/tools/szkrabok_browser.js:280` `eval(\`(${code})\`)`, `:297-299` `resolve(path)` + dynamic `import()`. Full host RCE as `jones2` |
| 3 | no path confinement; REPO_ROOT vs `--cwd` mismatch | `szkrabok_browser.js:9` `REPO_ROOT` is the package dir. `:84`, `:98` resolve `config`/`reportFile` against it. `:93` writes `dirname(configPath)/sessions/<name>`, while `packages/runtime/storage.js:9-10` uses `SZKRABOK_SESSIONS_DIR ?? cwd/sessions`. The package `files` list (`package.json`) ships no `playwright.config.js`, so the default `browser_run_test` is broken, and `config`/`files` can escape via `..` or an absolute path |
| 4 | `scaffold_init install:true` runs install scripts | `src/tools/scaffold.js:84` `spawn(npm, ['install'])` with no `--ignore-scripts`. `mergePackageJson` (`:39-61`) keeps an existing `scripts` map, so a planted `package.json` `preinstall` runs |
| 5 | `session_manage delete` globs + traversal | `src/tools/szkrabok_session.js:231-247` glob branch, `:257` raw name. `storage.js:12` `join(sessionsDir, id)` is unchecked, and `:60-65` does a recursive `rm`. `"../../x"` deletes outside the sessions dir. The same join serves `open` (`getUserDataDir`, `:16`, so any dir can be created), `close` (`saveState`, `:37-40`, writes `state.json` with cookies anywhere) and `updateSessionMeta` (`saveMeta`, `:48-51`). `newCloneId` (`:103-106`) sanitizes clone ids only |
| 6 | test tools run container-supplied config | `szkrabok_browser.js:84` + `:141-171`: `npx playwright test --config <resolved>`, plus the caller's `files`. Configs and specs are Node code. Also reachable via `session_run_test` `test.spec`/`test.config` (`src/tools/session_run_test.js:179-190`) |
| 7 | file:// navigation → host file exfiltration | `szkrabok_session.js:37-41` `navigate()` passes any URL to `page.goto`. `session_run_test.js:166` does the same. There is no scheme check. `open {url:"file:///home/jones2/.ssh/<key>"}` followed by `browser_scrape` returns the key. No `setInputFiles`-from-host-path tool exists, and it must stay that way |
| 8 | config discovery hijack via MCP roots | `src/server.js:135-147` → `finalizeConfig(rootPaths)`. `packages/runtime/config.js:170-182` loads `szkrabok.config.toml` from client roots. `:102` `executable_path` → `resolve.js:125` `spawnSync(path, ['--version'])`, and the same path is launched later (`launch.js:165-172`). Discovery order: `--config`, `SZKRABOK_CONFIG` (`:147`), `SZKRABOK_ROOT` (`:158`), MCP roots (`:170`), cwd (`:184`), XDG (`:196`) |

### Pass 2 additions

| # | Sev | Claim | Evidence / fix pointer |
|---|---|---|---|
| E1 | **critical** | `params` → arbitrary env in the Playwright child, including `NODE_OPTIONS` → code execution **without any file on disk** | `szkrabok_browser.js:122-129`. Params are spread **after** the fixed keys. `{node_options: "--import=data:text/javascript,<js>"}` runs `<js>` in the spawned Node (reproduced: Node 24 executes the data: module). Keys like `NPM_CONFIG_*` (read by `npx`) and `LD_PRELOAD` are dangerous in the same way. It also overrides `PLAYWRIGHT_JSON_OUTPUT_NAME` (arbitrary write, bypassing `reportFile` confinement), `SZKRABOK_CDP_ENDPOINT`, and `SZKRABOK_ATTACH_SIGNAL`. This holds **even with a host-owned spec root**. Fix: D9 |
| E2 | high | `reportFile` = arbitrary JSON write | `szkrabok_browser.js:97-98`. Fix: D3/D6. Reports go to a fixed reports dir |
| E3 | high | `files` entries become Playwright CLI options | `szkrabok_browser.js:160-162` pushes raw strings into argv. `files: ["-c", "/any/config.js"]` swaps the config (commander parses options in any position), and `--output=`/`--update-snapshots` enable writes. Fix: D6. Pass only confined absolute paths, after a `--` separator |
| E4 | medium | Playwright runs write **into the spec root** | spawn `cwd` = config dir (`:168`). Playwright's default `outputDir` is `<configDir>/test-results`, and `updateSnapshots: 'missing'` (the default) writes new snapshots next to the specs. The template config also writes `test-results/report.json` (`src/tools/templates/playwright.config.js:8`). That breaks the "nothing writes the spec root" invariant. Fix: D6 forces `--output` and `--update-snapshots=none` |
| E5 | medium | `.env` in cwd is an unlisted config source | `src/index.js:2` `import 'dotenv/config'` loads `<cwd>/.env` at startup. It can set `SZKRABOK_CONFIG`, `SZKRABOK_ROOT`, and `SZKRABOK_SESSIONS_DIR`, which bypasses D8. Today cwd = work root, and tools write into it (`reportFile`, `scaffold_init` with its default `dir` = cwd, `scaffold.js:105-110`). Fix: D8 + D3 (tool writes go only to `sessions/` and `reports/` subdirs) |
| E6 | medium | the browser is a proxy into host loopback/LAN | D7 (pass 1) allowlists `http:`, and the browser runs on the host. `open {url:"http://127.0.0.1:<port>/"}` + `browser_scrape` reads any host-local HTTP service: other MCP proxies, dev servers, router UIs, and the session's own CDP HTTP endpoint (`/json/list`, `/json/version`). CDP **WebSocket** from page context is refused by Chrome ≥111 because `--remote-allow-origins` is not set (`launch.js:194-204`). That must stay true. Fix: D7 private-address block |
| E7 | low | `launchOptions._launchImpl` test seam reachable from tool args | `szkrabok_session.js:67` → `launch.js:364` `_launchImpl ?? ...`. JSON cannot carry a function, so this is only a crash (`launchFn is not a function`). Strip `_`-prefixed keys at the tool boundary |
| E8 | low | `npx` may fetch `playwright` from the registry | `szkrabok_browser.js:167`. With no local `playwright` under the spawn cwd, `npx` installs one. Fix: `npx --no-install`, or resolve `node_modules/.bin/playwright` under the spec root |
| E9 | info | config metadata leaks host paths | `session_manage list` → `getConfigMeta()` includes `searched` paths (home dir layout). Accept and document. Useful for audit, low value to an attacker |

Non-findings checked: `grep` and `project` are passed as separate argv
elements (`:150`, `:158`), so there is no injection (a ReDoS in `grep` only
affects the child). `browser_scrape` (`src/tools/workflow.js:29-32`) is a pure
`page.evaluate` with no host access. MCP roots discovery is bounded by
`walkUp(root, root)` (`config.js:174`). That is still hostile, see #8.

## Design

### D1. Trust boundary: host-side flags, never tool arguments

New server-mode flags, parsed in `src/index.js` next to `--config` and kept in
one module (`src/flags.js`) that handlers read:

| Flag | Effect |
|---|---|
| `--work-root <dir>` | the only directory szkrabok tools write to, and only under `<work-root>/sessions/` and `<work-root>/reports/`. Default: `process.cwd()` |
| `--spec-root <dir>` | enables `browser_run_test` + `session_run_test` in **confined mode**: config/specs only from here, hardened argv/env (D6, D9). Also the only source for `browser_run path` (D2) |
| `--allow-node-code` | legacy/dev capability: `browser_run` Node forms (inline `eval`, `import()`), `scaffold_init`, and unconfined test tools (any config path) |
| `--allow-private-net` | lifts the D7 loopback/private-address block (local dev against `localhost`) |

Capability matrix (tool × flags):

| Tool | default | `--spec-root` | `--allow-node-code` |
|---|---|---|---|
| `session_manage`, `browser_scrape` | on | on | on |
| `browser_run code` | page sandbox | page sandbox | Node form |
| `browser_run path` | off | page sandbox, file from spec root | Node form |
| `browser_run_test`, `session_run_test` | off | confined | unconfined |
| `scaffold_init` | off | off | on |

Rules:

- Flags are read from `argv` only. Never from tool arguments, toml files, or
  env vars (`.env` included, see E5).
- At startup, `realpath` both roots and refuse to start when either is missing,
  not absolute, or contains the other. Disjointness is what keeps tool writes
  out of the spec root, so it is checked rather than assumed.
- A gated tool called without its flag returns a structured error that names
  the flag ("disabled; the host operator enables this with `--spec-root` in
  config/mcp-hosts.json"). The tool description says so up front, and
  `registerTools()` builds descriptions from the active flags.
- `session_manage list` returns the active flags and resolved roots in
  `server`, so the container can adapt and the operator can audit.

### D2. `browser_run` runs in the browser by default

Default form: `page.evaluate` inside the page sandbox.

- `code`: a function expression `(args) => result`, evaluated as
  `page.evaluate(\`(${code})(${JSON.stringify(args)})\`)`. The result must be
  JSON-serializable.
- `path` (needs `--spec-root`): the file is confined to the **spec root**, not
  the work root. The work root holds `sessions/*/state.json`, and evaluating
  JSON text as an expression would hand any session's cookies back. File
  format in page mode: one function expression, no `import`/`export`.
- `fn` is unsupported in page mode and returns an error when given. The pass-1
  idea of "evaluate the ESM file text and pick a named export" does not work,
  because `export` is a syntax error in `page.evaluate`.
- The Node form (current `(page, args)` contract, `eval`, `import()`) is
  available only with `--allow-node-code`.

`page.evaluate` cannot call Playwright APIs, so nothing in the default surface
can feed host paths to `setInputFiles`.

### D3. Two roots, one validator

`confinePath(root, input, { mustExist })` in `src/utils/paths.js`:

1. reject non-strings, empty input, NUL, and inputs starting with `-` (E3);
2. `resolve(root, input)`, with no trust in "relative" claims;
3. `realpath` the result. For a not-yet-existing write target, `realpath` the
   parent and re-append the basename. Require `real === root ||
   real.startsWith(root + sep)`, with `root` already realpath'd at startup;
4. return the **resolved absolute path**. Callers never use the raw input
   again.

TOCTOU between check and use is accepted: the container cannot write either
root, so it cannot race a symlink in.

Applied to:

| Input | Root | Notes |
|---|---|---|
| `browser_run path` | spec | `mustExist` |
| `browser_run_test` / `session_run_test` `config`, `files`/`test.spec` | spec | `mustExist` |
| `reportFile` | work, under `reports/` | write target, basename only (`[A-Za-z0-9._-]+\.json`) |
| `scaffold_init dir` | work | only with `--allow-node-code` |

Root replacement: delete `REPO_ROOT` (`szkrabok_browser.js:9`). `run_test`
stops deriving `dirname(configPath)/sessions/<name>` (`:93`). Its per-run
artifacts (`last-run.log`, `.attach-signal`, default report) move to
`<work-root>/reports/<session>/`. Session profiles stay in the runtime storage
dir. In server mode `storage.getSessionsDir()` becomes
`<work-root>/sessions`, and the `SZKRABOK_SESSIONS_DIR` env override is
ignored there, so one place decides.

### D4. `scaffold_init`

Gate the whole tool behind `--allow-node-code`. Under D6 its output can never
be used as test config from the container, and its default target is the work
root top level (E5), so in the sandbox posture it has no use. With the flag:
`install` uses `npm install --ignore-scripts`.

### D5. Session names

At the tool boundary, for every action and for `session_run_test session.name`:

```
^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$
```

- The first character must be alphanumeric. That rejects `.`, `..` and
  `-flag`. The pass-1 regex `^[A-Za-z0-9._-]{1,64}$` accepted `..`.
- Length 96: generated clone ids are `<template>-<13-digit ms>-<8 hex>`
  (`storage.js:103-106`), 23 chars longer than the template. Cap user-supplied
  template names at 64, so clone ids (≤ 87) still pass when they come back.
- Delete the glob branch of `deleteSession` (`szkrabok_session.js:230-247`) and
  `matchGlob` (`:43-48`), and update the tool description and schema text
  ("globs support", `registry.js:15`, `:26`).
- Defense in depth: `storage.getSessionDir(id)` asserts the joined path stays
  inside the sessions dir. That covers `rm`, `saveState`, `saveMeta`, and
  `getUserDataDir` in one place.

### D6. Spec root and the test runner

Tests are code. They stay safe only if neither the container nor the run
itself can write them, and the runner's argv/env cannot be steered.

- `config` and every `files` entry go through `confinePath(specRoot, …)`.
  The default `config` is `<spec-root>/playwright.config.js`.
- argv is built only from validated values: `--config <abs>`, `--output
  <work-root>/reports/<session>/test-results`, `--update-snapshots=none`, the
  reporters, `--project`/`--workers`/`--grep` as now, then `--`, then the
  confined absolute `files`. Playwright treats positional `files` as filters
  on the config's `testDir`, so the config decides which specs exist and
  `files` only narrows them.
- spawn: `cwd` = spec root, binary = `<spec-root>/node_modules/.bin/playwright`
  (or `npx --no-install`, E8).
- env: D9.
- `reportFile` → `<work-root>/reports/<session>/<basename>`.
- Without `--spec-root` (and without `--allow-node-code`) the test tools are
  off, with the same error shape as D1.
- claude-docker consequence: the spec root must not be a mountable project.
  The mount guard covers it because the flag value lands in `mcp-hosts.json`.

### D7. Navigation guard

Scheme allowlist: `http:`, `https:`, `about:blank`. Everything else (`file:`,
`chrome:`, `chrome-extension:`, `devtools:`, `view-source:`, `javascript:`,
`data:`, `blob:`, `filesystem:`, …) is refused.

Destination block (E6), unless `--allow-private-net`: hostnames `localhost`
and `*.localhost`, and IP literals in loopback (`127/8`, `::1`), link-local
(`169.254/16`, `fe80::/10`), private (`10/8`, `172.16/12`, `192.168/16`,
`fc00::/7`), and unspecified (`0.0.0.0`, `::`), including IPv4-mapped IPv6 and
the decimal/hex/octal IPv4 forms that `new URL()` normalizes.

Enforcement layers:

1. Call site: every tool-supplied URL (`session_manage open url`, clone open,
   `session_run_test navigation.url`) is checked before `goto`.
2. Context: `context.route('**/*')` aborts blocked requests (all resource
   types, so it catches redirects, `fetch`, subresources, and page-initiated
   navigation to `http(s)` private hosts). Playwright routing does not see
   `file:`/`chrome:` navigations, so add a `framenavigated` watcher on every
   page (`context.on('page')`, which includes pages opened by the site) that
   closes the page on a blocked scheme.
3. Read side: `browser_scrape` and page-mode `browser_run` refuse when the
   current document URL fails the check. Exfiltration fails even if a
   navigation slipped through.

Residual risk, documented: DNS names that resolve to private addresses (DNS
rebinding, or a public name pointing at 127.0.0.1) pass layer 2. Closing that
needs an egress proxy that checks the resolved address (decided, open
question 3; `--host-resolver-rules` was dropped because it matches
hostnames, not resolved IPs), and egress control is a non-goal here. Invariant: never add `--remote-allow-origins` to launch args (that
keeps page→CDP WebSocket closed), and never relay the CDP port.

Downloads: leave Playwright's default. Invariant: no tool exposes download
content. Revisit if a download tool is added.

### D8. Config discovery: only host-controlled locations

In server mode, discovery keeps explicit `--config`, `SZKRABOK_CONFIG`,
`SZKRABOK_ROOT`, and XDG user config. It drops the **MCP-roots** step
(`config.js:170-182`) and the **cwd** step (`config.js:184-194`). Standalone
CLI keeps cwd discovery.

`.env` (E5): in server mode, skip `dotenv/config`. If anyone needs a dotenv
file, load it only from an explicit `--env-file <path>` flag. The env vars that
trimmed discovery still honours must come from the real process environment,
which `mcp-hosts.json` controls.

`executable_path` stays valid, but only from a trusted config.
`getConfigMeta()` already reports `source`. Log it at startup and in
`session_manage list`, so a hijack attempt shows.

### D9. Test-run environment (E1)

Build the child env in this order, so fixed keys always win:

1. `process.env` minus inherited `NODE_OPTIONS`/`NPM_CONFIG_*` (the host's own
   settings must not leak into specs, and nothing below can re-add them);
2. validated `params`;
3. fixed keys: `FORCE_COLOR`, `SZKRABOK_SESSION`, `SZKRABOK_CDP_ENDPOINT`,
   `PLAYWRIGHT_JSON_OUTPUT_NAME`, `SZKRABOK_ATTACH_SIGNAL`, `PLAYWRIGHT_PROJECT`.

`params` key rule: after uppercasing it must match `^[A-Z][A-Z0-9_]{0,63}$`
and must not match the reserved set:

```
^(NODE_|NPM_|NPX_|LD_|DYLD_|PLAYWRIGHT_|PW_|SZKRABOK_|DEBUG|ELECTRON_|UV_|GIT_)
^(PATH|HOME|SHELL|TMPDIR|TMP|TEMP|USER|LOGNAME|DISPLAY|XAUTHORITY|SSH_AUTH_SOCK|BROWSER)$
```

Values: strings ≤ 4 KiB, no NUL. A denylist is not enough on its own, so
reserved prefixes cover whole families, and the fixed keys are applied last.
Decided (open question 4): params are delivered under a fixed prefix,
`SZKRABOK_PARAM_<KEY>`, and the checks above stay as a second layer.

## Work order

Each phase leaves the server fail-closed. A capability is only re-enabled once
its hardening is in.

Phase 1, containment (smallest diff):

1. `src/flags.js` + parsing in `src/index.js`. Gate everything per the D1
   matrix: with no flags, test tools, `scaffold_init`, and the `browser_run`
   Node forms are off.
2. Session-name regex, drop delete globs, `getSessionDir` assertion (D5).
   Strip `_`-prefixed launch options (E7).
3. Server mode: skip `dotenv`, drop MCP-roots + cwd discovery (D8, E5, #8).

Phase 2, roots and confined tests (this is where test tools come back):

4. `confinePath`, `--work-root`, startup root checks, delete `REPO_ROOT`,
   sessions/reports layout (D3).
5. Test-run env builder (D9, E1) and argv builder (`--`, `--output`,
   `--update-snapshots=none`, `--no-install`) (D6, E3, E4, E8).
6. `--spec-root` enables confined test tools (D6). This lands **after** 4 and 5.

Phase 3, browser surface:

7. Navigation guard: call site, route block, `framenavigated` backstop, read
   refusal (D7, #7, E6).
8. `browser_run` page-sandbox default, `path` from spec root (D2).

Phase 4, integration:

9. Szkrabok docs: `docs/testing.md`, `docs/development.md`,
   `docs/scaffold-init.md`, `docs/architecture.md` (invariants), and registry
   tool descriptions. Cover the flags, the root model, the spec-root contract,
   and page-mode `browser_run`. Changelog entry: **breaking** in server mode
   (Node `browser_run`, `scaffold_init`, and unconfined tests now need a flag;
   delete globs are removed), so a major version bump.
10. Host/claude-docker wiring: the companion doc.

## Tests

Node tests (`tests/node/`, run with `npm test`). New files are marked *new*:

- *new* `paths.test.js`, `confinePath`: `..` escape, absolute outside root,
  symlink final path, symlinked parent dir, NUL, leading `-`, prefix sibling
  (`/root-evil` vs `/root`), non-existent write target, root itself a symlink.
- *new* `session-name.test.js`: accept `a.b-c_1` and a real `newCloneId("x"*64)`
  output; reject `.`, `..`, `-x`, `a/b`, `*`, empty, 97 chars.
  `storage.getSessionDir("../x")` throws.
- *new* `flags.test.js`: every cell of the D1 matrix. A gated tool returns the
  structured error naming the flag. Startup refuses overlapping roots.
  `session_manage list` reports flags and roots.
- *new* `run-test-env.test.js`: `NODE_OPTIONS`, `node_options`,
  `NPM_CONFIG_SCRIPT_SHELL`, `LD_PRELOAD`, `PATH`, `PLAYWRIGHT_JSON_OUTPUT_NAME`,
  and `SZKRABOK_CDP_ENDPOINT` are rejected. Fixed keys win over params.
  `SESSIONMODE` passes (it is used by `src/fixtures.js:58`).
- *new* `run-test-argv.test.js`: `files: ["-c", "/tmp/x.js"]` is rejected. Built
  argv contains `--output`, `--update-snapshots=none`, `--`, and absolute
  confined paths only.
- `browser-run-test.test.js`, `session_run_test.test.js`: spec/config outside
  the spec root is refused; `reportFile` with a path separator is refused;
  after a run the spec root has no `test-results/` and no new snapshots.
- `config-discovery.test.js`: a planted `szkrabok.config.toml` in a fake MCP
  root and in cwd does **not** load in server mode (the source reports a
  trusted path or "none"). A `.env` in cwd is not loaded.
- `scaffold.test.js`: off without `--allow-node-code`. With it, `install` runs
  `--ignore-scripts` (a planted `preinstall` does not fire).
- *new* navigation guard tests (Playwright integration, `tests/playwright/integration`):
  `file:`, `chrome:`, `view-source:`, `javascript:`, `data:` refused at `open`
  and `session_run_test`. `http://127.0.0.1`, `http://[::1]`, `http://2130706433/`,
  and `http://localhost` blocked without `--allow-private-net`. A public test
  page doing `location = "file:///etc/hostname"` and `fetch("http://127.0.0.1:<port>")`
  is blocked. Scrape refuses on a blocked document URL.
- flag-on compatibility: legacy `browser_run` Node form and unconfined
  `browser_run_test` still work with `--allow-node-code`.
- live check in claude-docker: the companion's attack checklist.

## Non-goals

- Sandboxing the szkrabok Node process itself (seccomp/namespaces). It runs on
  the host by design. The flags and confinement are the control plane.
- General egress control for the browser (claude-docker documents it as
  absent). D7 blocks only host-local/private destinations by literal.
- Hardening `@playwright/mcp`, the other host MCP server. The same threat model
  applies (it exposes `browser_run_code_unsafe` and unrestricted
  `browser_navigate`). Separate work item in the claude-docker repo.
- Protecting a spec root from `jones2` itself. szkrabok runs as the owner, so
  "never writes" is a code invariant plus a tripwire (companion: read-only
  mode bits), not an OS guarantee.

## Rejected alternatives

- **Trust MCP roots but ignore `executable_path` from them**: whack-a-mole, the
  next sensitive key is one PR away. Dropping untrusted discovery sites is the
  durable rule.
- **Remove `browser_run` entirely**: the page-sandbox form keeps the useful 90%
  with no host capability.
- **Sign/HMAC spec files**: adds key management for a property a host-owned
  spec root already gives.
- **One flag (`--allow-node-code`) for test tools too** (pass 1): it forces the
  sandbox posture to grant `eval`/`import()` just to run reviewed specs. The
  spec root is the narrower grant.
- **Params denylist only** (pass 1 E1): `NODE_OPTIONS` alone has several
  spellings of the same attack across Node, npm, and the loader. Prefix-reserved
  families + fixed keys last is the minimum.

## Open questions

Decided 2026-10-24 (questions 1–4). The rationale compares each choice with
common practice in similar tools. The tool references come from general
knowledge and were not re-checked against current upstream docs.

1. `--work-root` default: `process.cwd()` (works with mcp-proxy `--cwd`
   unchanged) or a required flag in server mode (stricter, breaking)?

   **Decision: default to `process.cwd()`. Do not require the flag.** This is
   what the code already does (`src/flags.js`).

   Rationale: agent tools such as the Codex CLI workspace-write sandbox and
   Claude Code use the cwd as the writable root by default. Servers that
   expose a filesystem to a model (the reference MCP filesystem server, Deno's
   `--allow-write=<path>`) usually want the path named explicitly. Here the
   cwd is set by the host (mcp-proxy `--cwd`), never by the model, so it is
   already an explicit host choice. Making the flag required would add a
   breaking change with no gain in safety.

2. Page-mode `browser_run`: keep `code`/`path` names (call compatibility for
   pure page logic) or rename to make the semantic change loud?

   **Decision: keep the names.** Node-only inputs (`fn`, a body using
   `page.`) fail with a message pointing at `--allow-node-code`.

   Rationale: the usual API rule (e.g. Google AIP) is that a field must not
   change meaning under the same name. Browser tools keep the two contexts
   apart: Puppeteer/Playwright `page.evaluate` against plain Node, and
   Playwright MCP's separate `browser_evaluate` tool plus `--caps`, which
   hides gated tools instead of failing them. Keeping the names is
   acceptable here anyway. MCP clients re-read the tool description every
   session, so models adapt. The scripted caller (`spawnClient`) runs with
   `--allow-node-code` and sees no change. Not chosen, but on the table if
   the overload causes trouble: split into two tools (page-mode
   `browser_run` always on, a Node-mode tool registered only under
   `--allow-node-code`). A major release is the cheap time to do that.

3. D7 DNS-rebinding residual: is `--host-resolver-rules` (map private
   resolutions to `~NOTFOUND`) worth adding, or is the literal block enough
   until egress control exists?

   **Decision: keep the literal block, document the residual, and drop
   `--host-resolver-rules`. The planned fix is an egress proxy on the
   claude-docker side (companion).**

   Rationale:
   - `--host-resolver-rules` most likely cannot do this. Its `MAP`/`EXCLUDE`
     rules match hostname patterns before resolution, so it cannot refuse
     "anything that resolves to a private address".
   - The standard SSRF defence (OWASP SSRF cheat sheet) is to check the
     address after resolution, at the point of connection. For a browser
     that means an egress proxy that resolves and checks the IP itself
     (e.g. Stripe's Smokescreen, or a squid destination-IP ACL), wired in
     with `--proxy-server` / Playwright's `proxy` launch option.
   - A Node-side lookup in the route handler does not close it. The browser
     resolves again afterwards, and a rebinding server can answer
     differently the second time.
   - Playwright MCP has the same gap and documents `--allowed-origins` as
     not a security boundary. Treating the literal block as defence in
     depth, not a boundary, matches that.

4. Should the spec root declare allowed `params` names (e.g. a
   `szkrabok.params.json` next to the config), which turns D9 into a pure
   allowlist?

   **Decision: neither a params file nor a deferral. In this release,
   prefix every param: `params.foo` reaches the spec as
   `SZKRABOK_PARAM_FOO`. Keep the current key validation and reserved set as
   a second layer.**

   Rationale: when env vars cross a trust boundary, the standard is an
   allowlist: `sudo` (`env_reset` + `env_keep`), systemd
   (`PassEnvironment=`), sshd (`AcceptEnv`, often only `LANG`/`LC_*`),
   Docker (only what `-e` names). Env blocklists are known to leak, because
   every new interpreter adds its own variables. The D9 reserved set has
   already grown to `PYTHON*`, `PERL5*`, `JAVA_*`/`JDK_*` and the whole
   `npm_*` family, which is that problem in practice. A fixed prefix works
   like GitHub Actions turning inputs into `INPUT_<NAME>`: a param can never
   name `NODE_OPTIONS` or any other variable outside the namespace, with no
   list or config file to maintain. The prefix is applied after validation,
   and the fixed keys (step 3) are outside `SZKRABOK_PARAM_*`, so they still
   win. Cost: specs that read `process.env.FOO` must read
   `process.env.SZKRABOK_PARAM_FOO`. That is acceptable in a major release
   and goes into the release notes. A declared allowlist file would keep
   today's names but add a schema and a file per spec root. Not chosen.

5. Should the companion's `check.sh` hard-fail on
   `--trust-project-config` (it warns now)?

   **Decision: hard-fail on both code-execution grants,
   `--trust-project-config` and `--allow-node-code`, with a per-run override
   `CLAUDE_DOCKER_ALLOW_UNSAFE_SZKRABOK=1`. `--allow-private-net` stays a
   warning.** (Companion section 5.)

   Rationale: tools that load code from a workspace refuse by default and
   need a named opt-in: VS Code Workspace Trust, git `safe.directory`,
   direnv `allow`. Hard-failing only `--trust-project-config` would be
   inconsistent, because `--allow-node-code` runs host code from the
   container even more directly. `--allow-private-net` widens network reach
   but runs nothing.

## Progress

### 2026-10-23: TDD suite started (tests only, no implementation)

Location: `tests/node/hardening/`. Run with
`node --test tests/node/hardening/*.test.js`. These tests are kept out of
`npm test` on purpose, because `test:self` only globs `tests/node/*.test.js`.
They are red until the matching module lands. A missing module fails each test
on its own with `not implemented: <file> (<section>)`, not the whole file.
Nothing is committed yet, and `package.json` has no `test:hardening` script
yet.

| File | Covers | State |
|---|---|---|
| `helpers.js` | lazy module loader, temp dirs, `spawnServer` (MCP over stdio with flags + roots), `expectStartupFailure`, `findBrowser` | done |
| `paths.test.js` | D3 `confinePath` | 19 tests, all red |
| `session-name.test.js` | D5 `assertSessionName` + `storage.js` path assertions | 18 tests, 17 red, 1 green (ordinary ids already work) |
| `flags.test.js` | D1 `parseFlags` + `capabilities` matrix | 21 tests, all red |

API contracts fixed by the tests. Change the tests if the implementation
wants something else:

- `src/utils/paths.js`: `confinePath(root, input, { mustExist = true })`,
  **sync**. Returns the realpath'd absolute path, or throws
  `{ code: 'PATH_NOT_ALLOWED' }` with the root named in the message.
- `src/utils/validate.js`: `assertSessionName(name, { kind: 'template' | 'any' })`,
  caps 64 / 96. Throws `{ code: 'VALIDATION_ERROR', field: 'sessionName' }`.
- `packages/runtime/storage.js`: `getUserDataDir`, `sessionExists`
  (sync throw), `deleteSession`, `saveState`, `loadState`, `saveMeta`,
  `loadMeta`, `updateMeta`, and `ensureProfileDir` (reject) refuse escaping ids,
  `.`, and `''` with `{ code: 'PATH_NOT_ALLOWED' }`.
- `src/flags.js`: `parseFlags(argv, { cwd })` →
  `{ workRoot, specRoot, allowNodeCode, allowPrivateNet }`. It accepts both the
  `--flag value` and `--flag=value` forms, and ignores existing flags
  (`--headful`, `--no-headless`, `--config <v>`). It throws
  `{ code: 'INVALID_FLAGS' }` on a missing value, a relative path, a missing
  dir, a file instead of a dir, overlapping or equal roots (symlinks
  included, with the default cwd work root counted), or an unknown `--allow-*`.
  `capabilities(flags)` →
  `{ browserRunCode, browserRunPath, testTools, scaffoldInit, privateNet }`
  per the D1 matrix. `--allow-node-code` wins over `--spec-root`.

Still to write (from the Tests section above):

1. `run-test-env.test.js` (D9/E1), test-run env builder. Planned module:
   `src/tools/run_test_args.js` `buildTestEnv`. Write it allowlist-shaped:
   accepted keys pass, reserved keys/prefixes are refused, fixed keys win
   over params.
2. `run-test-argv.test.js` (D6/E3/E4/E8): `buildTestArgv` with `--`,
   `--output`, `--update-snapshots=none`, confined absolute files, and no
   registry fetch.
3. `url-guard.test.js` (D7), pure unit tests: scheme allowlist,
   private/loopback literals including the IPv4 encodings that `new URL()`
   normalizes, and the `allowPrivateNet` toggle.
4. `config-discovery-server.test.js` (D8/E5): MCP-root and cwd toml are
   ignored in server mode, and `.env` in cwd is not loaded.
5. `scaffold.test.js` additions (D4): off without the flag, and
   `--ignore-scripts` with it (inject `spawn`).
6. `server-gating.test.js` (D1/D5/D6, no browser): disabled-tool errors
   name the flag, tool descriptions reflect the flags, `list` reports flags
   and roots, startup refuses overlapping roots, delete `../x` and `*` are
   refused (the decoy dir survives), and confined test tools refuse
   outside paths, `-c`, reserved params, and `reportFile` with a separator.
   Argument checks must run **before** the session lookup, so these tests
   need no open session.
7. Browser-level tests (skipped when `findBrowser()` is null; this sandbox has
   no Chromium, so they run on the host only): navigation guard (call
   site, route block, `framenavigated` watcher, scrape refusal), page-mode
   `browser_run`, and a test run leaving the spec root unchanged.
8. Add a `test:hardening` script to `package.json`. Once every phase is green,
   fold the suite into `test:self`.

Known conflict for later: `tests/playwright/integration/config-mcp-roots.spec.js`
asserts that MCP-root config **is** loaded. It must be rewritten when D8 lands.

### 2026-10-23: `run-test-env.test.js` interrupted

The first attempt at item 1 was stopped mid-write by the assistant's safety
classifier. No file was created. The other suite files are unaffected.

Likely trigger (a guess, since the classifier gives no reason): the draft was
about to list concrete code-execution env payloads as test inputs. Earlier
in the session one such payload had also been run in a shell to reproduce
E1 (a harmless `console.log`). A file of working payloads reads as exploit
material whatever its purpose.

How to write it instead. This is enough to cover D9/E1 in full:

- **allowlist-shaped**: ordinary keys pass (`URL`, `SESSIONMODE`,
  `MY_PARAM_1`, lowercase input uppercased), and every fixed key overrides a
  same-named param.
- **reserved keys refused by name only**: each reserved prefix family and
  each exact name from D9 is tested with an inert placeholder value (`'x'`).
  The test proves the **key** is blocked, so the value never needs to be
  runnable.
- **inherited env scrubbed**: `NODE_OPTIONS` / `NPM_CONFIG_*` /
  `npm_config_*` in `baseEnv` are absent from the result.
- **shape rules**: bad key syntax, value over 4096 chars, NUL in a value, and
  a non-scalar value are all refused with
  `{ code: 'VALIDATION_ERROR', field: 'params' }`.
- **pure function only**: assert on the returned object. Never spawn a
  child with hostile env.
- End-to-end proof that the attack fails belongs in the companion's live
  verification checklist, run by hand on the host, not in the repo suite.

### 2026-10-24: implementation started (Phase 1 done, Phase 2 partly done, Phase 3 item 8 done)

Implemented (uncommitted):

- `src/flags.js`: `parseFlags`, `capabilities`, and process-wide
  `setFlags`/`getFlags`/`getCapabilities`. Without `setFlags`, the default is
  the fail-closed posture.
- `src/index.js`: flags parsed at startup. Invalid flags exit 2, written to
  stderr and `startup.log`. `dotenv` loads in CLI mode only (E5). The sessions
  dir is pinned to `<work-root>/sessions` via the new runtime export
  `setSessionsDir`.
- `src/server.js` + `packages/runtime/config.js`: `serverMode` drops the
  MCP-roots and cwd discovery steps (D8), and the config source is logged.
- `src/tools/policy.js`: tool-boundary guard (`CAPABILITY_DISABLED` errors
  name the flag), session-name checks per action, `_`-prefixed launch
  options stripped (E7), and descriptions prefixed with the availability
  note. Wired in `registry.js`.
- `src/utils/paths.js` (`confinePath`, `overlaps`) and `src/utils/validate.js`
  (`assertSessionName`). `storage.js` `getSessionDir` asserts one-level
  containment.
- `szkrabok_session.js`: glob delete and `matchGlob` removed. `list` reports
  `server.flags` and `server.capabilities`.
- `szkrabok_browser.js`: `REPO_ROOT` removed. Run paths are resolved per mode
  (confined: spec root for config/files, `<work-root>/reports/<session>/` for
  artifacts, `--output` + `--update-snapshots=none`; legacy: relative to the
  work root). All caller input is validated before the session lookup.
  Playwright comes from `<cwd>/node_modules/.bin`, else `npx --no-install` (E8).
  Page-sandbox `browser_run` (D2): `fn` refused, `path` from the spec root,
  errors carry `PAGE_EVAL_FAILED` + hint.
- `src/tools/run_test_args.js`: `buildTestEnv` (a second writer's version,
  kept as-is, see below) plus `buildTestArgv` and `assertReportName`.
- `scaffold.js`: `npm install --ignore-scripts`.
- Existing tests given the legacy capability (`setFlags` with
  `allowNodeCode`): `tests/node/preflight.test.js`,
  `tests/node/firefox-engine-guard.test.js`.

Test state:

| Suite | Result |
|---|---|
| `tests/node/hardening/*` | 115/115 pass (flags 21, paths 19, run-test-argv 12, run-test-env 45, session-name 18) |
| `tests/node/*.test.js` | 127/128. The failure is `open() response includes browserEngine: firefox` (`BROWSER_NOT_FOUND`: no Firefox in the sandbox, unrelated) |
| eslint `src packages/runtime tests/node` | clean |
| MCP smoke (no flags) | gated tools → `CAPABILITY_DISABLED`; delete `../x` / `*` → `VALIDATION_ERROR`; `list` shows capabilities; config source "none"; overlapping roots → exit 2 |
| Playwright integration / e2e | **not run**. No Chromium in the sandbox, so they run on the host only |

Corrections to the design above (the original text is left in place):

- **D6 `--` separator is wrong for Playwright 1.63.** Files after `--` match
  nothing (verified with `--list`: 1 test without `--`, 0 with). argv has no
  `--`. Option injection is prevented because `files` must be confined
  **absolute** paths (`buildTestArgv` refuses anything else), and `grep` is
  passed as a single `--grep=<v>` token.
- Legacy-mode `files` are resolved to absolute paths against the work root.
- Legacy default report location moved from `dirname(config)/sessions/<name>/`
  to `<work-root>/reports/<name>/`.

Concurrent-writer incident: at 00:06 a second writer replaced
`src/tools/run_test_args.js` with an env-only version and created
`tests/node/hardening/run-test-env.test.js`. That test file was then
overwritten by this session without being read first, and its original is
lost. The second writer's `buildTestEnv` was reviewed: same rules, slightly
stricter (`params: null` refused), and 45/45 tests pass against it. It was kept,
and the argv/report builders were merged below it. Keep a single writer in
the tree from here on.

Next:

1. Integration harness (`packages/runtime/mcp-client/runtime/transport.js`
   `spawnClient`, `tests/playwright/integration/config-mcp-roots.spec.js`):
   start the server with `--allow-node-code` and use `SZKRABOK_ROOT=<repo>`
   (cwd discovery is gone in server mode). Rewrite `config-mcp-roots.spec.js`
   to assert roots are **ignored**. Until then, the Playwright integration
   suite is expected to fail.
2. Local dev MCP config (`claude mcp add szkrabok ... node src/index.js`)
   now needs `--allow-node-code` (+ `--config` or `SZKRABOK_ROOT`) for the
   old behaviour. Document in `docs/development.md`.
3. Still-unwritten tests: `url-guard`, `config-discovery-server` (incl.
   `.env`), scaffold gating/`--ignore-scripts`, `server-gating` (port the
   smoke checks into `node:test`), browser-level.
4. D7 navigation guard (Phase 3 item 7), not started.
5. Pre-existing bug spotted: `scaffold.js` `npmInstall` uses
   `stdio: 'inherit'`, which writes npm output onto the MCP stdout stream in
   server mode. Fix with `stdio: ['ignore', 2, 2]`.
6. Add the `test:hardening` script to `package.json`. Docs and changelog
   (Phase 4).

### 2026-10-24 (later): harness, D7 guard, server-level tests, audit fixes

Since snapshot `f4bbf6a` (uncommitted):

- **Harness:** `spawnClient` (library + selftests) starts the server with
  `--allow-node-code --allow-private-net` and `SZKRABOK_ROOT=<caller cwd>`
  unless `SZKRABOK_CONFIG`/`SZKRABOK_ROOT` is set. It takes optional
  `{ args, env }`. The MCP client registry hash was regenerated
  (`npm run codegen:mcp`), because the schema text changed. Specs:
  - `config-mcp-roots.spec.js` now asserts that roots are **ignored** and
    `SZKRABOK_CONFIG` still works;
  - `firefox-engine.spec.js` passes `--allow-node-code`;
  - `scrape.spec.js` loads fixtures via `page.setContent`, because `data:`
    URLs are now blocked.
- **`scaffold.js`:** npm output goes to stderr, no longer onto MCP stdout
  (Next item 5).
- **D7:** pure classifier `src/utils/url-guard.js` (`blockedReason`,
  `assertNavigable`, `URL_BLOCKED`) and enforcement in
  `src/tools/nav_guard.js`. Enforcement layers:
  - call site: `open` (checked before launch), clone, `session_run_test`
    `navigation.url` (checked before any session is opened);
  - context: a `context.route` private-destination block (only without
    `--allow-private-net`, because routing disables the HTTP cache), a
    `routeWebSocket` block on destination (WebSockets bypass `route`), and
    a main-frame `framenavigated` watcher that resets a blocked main frame to
    `about:blank` (`chrome-error://` exempt);
  - read side: `browser_scrape` and page-mode `browser_run` refuse a blocked
    document URL.

  The guard is installed on template, clone, reuse and clone-from-live.
  Bypass found by the tests and fixed: trailing-dot FQDN (`localhost.`).
  Documented residuals: DNS names resolving to private IPs, and Service
  Worker traffic.
- **`buildTestEnv`:** the audit file `run-test-env-v2.test.js` (second
  writer's, not read or modified, only run) drove these changes:
  - F1: shell/interpreter names (`BASH_ENV`, `ENV`, `SHELLOPTS`, `BASHOPTS`,
    `IFS`, `PS4`, `PROMPT_COMMAND`, `CDPATH`, `GLOBIGNORE`) and the
    `PYTHON*`/`PERL5*`/`RUBY*`/`JAVA_*`/`JDK_*` families are reserved, while
    `PERL_X` and `JAVASCRIPT_X` still pass;
  - F4: the whole `npm_*` family is scrubbed from the inherited env;
  - F5: `fixed` must be a plain object;
  - F6: `NaN`/`Infinity` are refused;
  - F8: case-fold key collisions are refused.

  27/28 pass. The remaining failure, "F8: default call copies process.env
  … process.env must not be mutated", is most likely a test defect: the
  builder provably does not mutate `process.env` (identical serialization
  before and after). In Node, `assert.deepStrictEqual(process.env,
  {...process.env})` fails by itself ("not reference-equal"). Left for the
  file's owner.
- **Tests added:** `url-guard.test.js` (14) and `server-gating.test.js` (23, real
  MCP server over stdio, no browser). They cover gating errors and
  descriptions, `list` flags, delete/open traversal with a decoy that
  survives, URL block before launch, confined config/files/reportFile/params
  refusal, the order of checks (valid input reaches the session lookup, and
  nothing is written to the spec root), `_launchImpl` scrubbing, cwd
  toml + `.env` + MCP-root toml not loaded, `SZKRABOK_CONFIG` honoured, and
  startup refusal.
- **`package.json`:** `test:hardening`. **`docs/development.md`:** flag table,
  server-mode config rules, and the new local-dev MCP command.

Test state: `npm run test:hardening` 179/180 (the one is the F8 item above),
`tests/node/*.test.js` 127/128 (Firefox not installed), and eslint is clean
except `run-test-env-v2.test.js:43` (unused `INVALID`, owner's file). **Not
run:** the Playwright integration/e2e suites and every browser-level check
of the guard (route, WebSocket, watcher). There is no Chromium in the sandbox,
so these must be run on the host before release.

Incident: a failing assertion in the audit file printed the whole sandbox
`process.env` (including `GH_TOKEN`/`GITHUB_TOKEN`) into the session output.
Treat that token as exposed. Tests should never deep-compare or print
`process.env`.

Next:

1. Host run: `npm test` (integration + e2e) and a browser-level guard spec
   (file: via page script, `fetch`/WebSocket to 127.0.0.1, scrape refusal).
2. Owner fixes for `run-test-env-v2.test.js` (F8 assertion, lint).
3. Phase 4 docs: `docs/testing.md`, `docs/scaffold-init.md`,
   `docs/architecture.md` invariants, README `params` note, changelog (major).
4. Companion doc work on the claude-docker side (mount-guard verification first).

## Current situation (2026-10-24)

**Historical snapshot (at `67463d8`).** Superseded by the progress entries
below and by "End of day 2026-10-24: resume here", which is current. Kept
for the record; its test numbers, lint notes and "never run" rows are
out of date.

### Where the work is

- Branch `wip/claude-docker-hardening` (from `main` at `fa465f5`, release
  2.1.5). Not pushed. `main` is untouched.
- Commits (snapshots, not release-ready):
  - `f4bbf6a`: Phase 1 + partial Phase 2
  - `67463d8`: D7 guard, harness, server-level tests, audit fixes
- The working tree was clean after `67463d8`. This section is the only
  change since.
- The companion doc (`20261024-claude-docker-deployment-companion-proposal.md`)
  is written. None of its host-side work has started.

### Design item status

| Item | Status | Where |
|---|---|---|
| D1 flags + capability matrix | done | `src/flags.js`, `src/index.js`, `src/tools/policy.js` |
| D1 startup refusal (invalid/overlapping roots, unknown `--allow-*`) | done, exit 2 | `src/index.js` |
| D1 descriptions + `list` reporting | done | `policy.js` `availabilityNote`, `szkrabok_session.js` `list` |
| D2 page-sandbox `browser_run` | done | `szkrabok_browser.js` `run_page` |
| D3 `confinePath`, work root, sessions dir pinned, `REPO_ROOT` removed | done | `src/utils/paths.js`, `storage.js` `setSessionsDir` |
| D4 `scaffold_init` gated, `--ignore-scripts`, stdout off MCP stream | done | `policy.js`, `scaffold.js` |
| D5 session names, glob delete removed, storage containment | done | `src/utils/validate.js`, `storage.js` `getSessionDir` |
| D6 confined runner (spec root, `--output`, `--update-snapshots=none`, absolute files, report name) | done | `szkrabok_browser.js` `resolveRunPaths`, `run_test_args.js` |
| D7 navigation guard | done in code, **browser layers unverified** | `src/utils/url-guard.js`, `src/tools/nav_guard.js` |
| D8 server-mode discovery (no MCP roots, no cwd) | done | `packages/runtime/config.js` `serverMode`, `src/server.js` |
| D9 env builder | done, hardened by the audit | `run_test_args.js` `buildTestEnv` |
| E5 `.env` CLI-only | done | `src/index.js` |
| E7 `_`-prefixed launch options stripped | done | `policy.js` `scrubLaunchOptions` |
| E8 no registry fetch | done | `szkrabok_browser.js` `playwrightCommand` |
| E9 config metadata paths | accepted, documented | — |
| Phase 4 docs | partial: `docs/development.md` only | — |
| Companion (claude-docker side) | not started | — |

Deviations from the design text above (that text is left in place):

- **No `--` separator in argv** (D6). Playwright 1.63 matches nothing after
  it. Injection is prevented by absolute confined paths and `--grep=<v>`.
- **Legacy mode** (`--allow-node-code`) resolves `files` to absolute paths
  against the work root, and writes default reports to
  `<work-root>/reports/<session>/`, no longer `dirname(config)/sessions/<session>/`.
- **D7 watcher** resets a blocked main frame to `about:blank` instead of
  closing the page, because closing would break the session. `chrome-error://`
  is exempt.
- **D7 route block** is installed only without `--allow-private-net`, because
  routing disables the HTTP cache. A `routeWebSocket` destination block was
  added, since WebSockets bypass `route`.
- **D9 reserved set** is wider than designed, per the audit: shell/interpreter
  names, `PYTHON*`/`PERL5*`/`RUBY*`/`JAVA_*`/`JDK_*`, the whole inherited
  `npm_*` family scrubbed, case-fold collisions refused, finite numbers only,
  and `fixed` must be a plain object.
- **The client library (`spawnClient`)** starts its private server with
  `--allow-node-code --allow-private-net` and `SZKRABOK_ROOT=<caller cwd>`
  (trusted host context). It accepts `{ args, env }`.

### Behaviour changes for users (breaking, needs a major version)

- Server mode with no flags: `browser_run` runs in the page (`(args) =>
  result`). The Node form, `scaffold_init`, and the test tools are off.
- `szkrabok.config.toml` in cwd or in MCP roots, and `.env`, are not loaded
  by the server. Use `--config`, `SZKRABOK_CONFIG`, `SZKRABOK_ROOT` or XDG.
- `session_manage delete` takes exact names only (no globs). Session names
  must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (≤ 64; ids ≤ 96).
- Navigation to `file:`, `chrome:`, `data:` and other non-web schemes is
  always refused. `localhost`/private addresses are refused without
  `--allow-private-net`.
- `browser_run_test` `params`: reserved names are refused, and each param
  reaches the spec as `SZKRABOK_PARAM_<KEY>` instead of `<KEY>` (open
  question 4). Specs reading `process.env.FOO` must read
  `process.env.SZKRABOK_PARAM_FOO`. `reportFile` is a
  bare `*.json` name in confined mode.
- Local dev MCP command (in `docs/development.md`):
  `claude mcp add szkrabok -s local -e SZKRABOK_ROOT=<repo> -- node <repo>/src/index.js --allow-node-code --allow-private-net`

### Tests

| Suite | Last result (sandbox) |
|---|---|
| `npm run test:hardening` | 179/180. Fails: "F8: default call copies process.env without the scrubbed forms" (`run-test-env-v2.test.js:372`) |
| `node --test tests/node/*.test.js` | 127/128. Fails: `open() response includes browserEngine: firefox` (`BROWSER_NOT_FOUND`, no Firefox in sandbox) |
| eslint | clean except `run-test-env-v2.test.js:43` (unused `INVALID`) |
| `npm run test:runtime:unit` | 17/17 (before D7; re-run on host) |
| Playwright integration | **never run** (no Chromium in sandbox) |
| Playwright e2e | **never run** |
| D7 browser layers (route, WebSocket, watcher) | **never run** |

Hardening suite files (`tests/node/hardening/`):

| File | Tests | Owner |
|---|---|---|
| `helpers.js` | — | this session |
| `paths.test.js` | 19 | this session |
| `session-name.test.js` | 18 | this session |
| `flags.test.js` | 21 | this session |
| `run-test-env.test.js` | 45 | this session (overwrote the second writer's original, lost) |
| `run-test-argv.test.js` | 12 | this session |
| `url-guard.test.js` | 14 | this session |
| `server-gating.test.js` | 23 | this session |
| `run-test-env-v2.test.js` | 28 | second writer. Not read or modified by this session, only run |

The open F8 failure is most likely a defect in the test, not the builder.
`buildTestEnv()` does not change `process.env` (identical serialization
before and after). In Node, `assert.deepStrictEqual(process.env,
{...process.env})` fails on its own ("not reference-equal"). This is left
to the file's owner, who should also stop that assertion from printing the
env on failure.

### Host test plan (required before any merge or release)

From the repo root, on the branch:

1. Setup: `npm ci`, then `npx szkrabok doctor` (a Chromium must be found).
2. Lint: `npx eslint . --ignore-pattern tests/node/hardening/run-test-env-v2.test.js`.
   Plain `npm test` stops at lint because of the v2 file.
3. Node: `node --test tests/node/*.test.js`, `npm run test:hardening`,
   `npm run test:runtime:unit`, `npm run test:runtime:integration`.
4. Integration: `npx playwright test --project=integration`. Specs most at
   risk:

   | Spec | Risk |
   |---|---|
   | `config-mcp-roots.spec.js` | now asserts roots are ignored |
   | `scrape.spec.js` | `setContent` fixtures |
   | `session_run_test.spec.js`, `scaffold-smoke.spec.js` | new argv builder, reports in `reports/<session>/` |
   | `browser-run.spec.js`, `session.spec.js` | Node form via `--allow-node-code` |
   | all | navigation guard active in every session |

5. e2e: `npm run test:auto`.
6. D7 checks by hand, against a local MCP on the branch with **no flags**
   (`claude mcp add szkrabok -s local -e SZKRABOK_ROOT=$PWD -- node $PWD/src/index.js`,
   then restart the MCP server). Open `g1` at `https://example.com`, then run
   these `browser_run` calls:

   | `code` | Expected |
   |---|---|
   | `() => fetch('http://127.0.0.1:8932/').then(r => r.status).catch(() => 'blocked')` | `"blocked"` |
   | `() => new Promise(r => { const w = new WebSocket('ws://127.0.0.1:8932/'); w.onopen = () => r('open'); w.onerror = () => r('blocked'); })` | `"blocked"` |
   | `() => { location.href = 'file:///etc/hostname'; return 1 }`, then `() => location.href` | `about:blank` (or Chromium refuses by itself); never the file |
   | `(page) => page.title()` | error naming `--allow-node-code` |

   And these `session_manage` calls:
   - `open` `g2` with `file:///etc/hostname` → `URL_BLOCKED`
   - `open` `g3` with `http://localhost:3000` → `URL_BLOCKED` naming
     `--allow-private-net`
   - `list` → `testTools: "off"`, `privateNet: false`

   Afterwards, restore the normal MCP config.

The step 6 checks are now automated in
`tests/playwright/integration/nav-guard.spec.js`.

### Incidents

1. **Concurrent writer.** A second writer edited the tree twice during this
   work:
   - at 00:06 it replaced `run_test_args.js` (env-only version) and created
     a `run-test-env.test.js`, which this session then overwrote unread
     (the original is lost);
   - at 00:15 it added the audit file, later renamed `run-test-env-v2.test.js`.

   `ListAgents` showed no other Claude session either time. Its
   `buildTestEnv` was kept and merged. Rule from here on: one writer in the
   tree.
2. **Secret printed to output.** The v2 F8 failure printed the whole sandbox
   `process.env`, including `GH_TOKEN`/`GITHUB_TOKEN` and
   `CLAUDE_CODE_MESSAGING_TOKEN`. The output stayed in the local session, but
   the GitHub token should be rotated. Rule: tests never deep-compare or print
   `process.env`.
3. **Safety-classifier interruption.** An early draft of
   `run-test-env.test.js` was stopped mid-write (see the entry above). It was
   rewritten with names only and dummy values.

### Open items, in order

1. Run the host test plan, and fix whatever it finds.
2. The v2 file owner fixes the F8 assertion and the lint error.
3. Decide whether step 6 becomes a Playwright spec (a browser-level guard
   test).
4. Phase 4 docs: `docs/testing.md`, `docs/scaffold-init.md`,
   `docs/architecture.md` invariants, README `params`/`browser_run`
   notes, changelog entry (major).
5. Open questions 1–4 above (work-root default, page-mode naming, DNS
   rebinding, params allowlist file). Decided 2026-10-24, see "Open
   questions". Question 4 is implemented.
6. Companion work in claude-docker, starting with mount-guard verification
   (companion §3).
7. Squash the WIP snapshots into release commits, then decide on merging
   to `main`. Ask first.

### 2026-10-24: host verification run (supersedes the test table above)

Full report: [20261024-hardening-verification-run.md](./20261024-hardening-verification-run.md),
run on the host at `ba07d84`. `ba07d84` (by the user) added `test:hardening`
to `test:self` and fixed the v2 F8 check, which now compares key names only
and never prints values. That also fixed its lint issue.

| Step | Host result |
|---|---|
| lint | exit 0 |
| `tests/node/*.test.js` | 127/128 → R1 |
| `test:hardening` | 180/180 |
| runtime unit / integration | 17/17, 3/3 |
| Playwright integration (first run) | 32 passed, 6 skipped. **D8 verified live** (`config-mcp-roots.spec.js`) |
| e2e | 3 passed, 3 failed → R3 |

Follow-up (uncommitted at the time of writing):

- **R1, fixed.** `open()` installs the nav guard. The mock context in
  `firefox-engine-guard.test.js:111` had no `route`/`routeWebSocket`, and
  its page had no `on`, so `nav_guard.js:33` threw. The mock was fixed rather
  than the guard: a `page.on?.()` would let the guard silently not install.
  Both earlier causes were real. In the sandbox the test stops earlier at
  `BROWSER_NOT_FOUND` (no Firefox). On the host, Firefox exists and the crash
  surfaces. Verified in the sandbox with a stub `firefox` on `PATH`: the crash
  reproduces without the fix, and 5/5 pass with it.
- **R2, mitigated, root cause open.** Scrape fixtures now call `setContent`
  with `waitUntil: 'domcontentloaded'`. The guard's route is **not**
  installed in these runs (`spawnClient` passes `--allow-private-net`), and
  the frame watcher does nothing for `about:blank`, so the guard is not the
  suspect. Why `load` never fires after `setContent` on these pages is
  unknown. Re-check on the host that the 30s timeouts are gone.
- **R3, partly fixed.**
  - `example-com.spec.js` now asserts the title plus the "Learn more" link
    (the live page has no `<h1>`).
  - `rebrowser.spec.js` / `rebrowser-mcp.spec.js` are **not changed**. One
    of `KNOWN_FAILURES` (`mainWorldExecution`, `exposeFunctionLeak`) now
    passes. Fix: remove that entry and keep the exact count, which is the
    drift detector. Which one it is needs the e2e log from the host. The
    likely trigger is the site or the Playwright 1.63 upgrade (`9e4172b`),
    not hardening: e2e drives the browser directly, and the guard's route is
    off under `spawnClient`.
- `.gitignore`: `reports/` added (the new default artifact dir in the work
  root).

Corrections to "Current situation" above: the v2 F8 failure and the
lint error are resolved (`ba07d84`). The 127/128 node result was not
Firefox-only. The host plan's step-2 `--ignore-pattern` is no longer needed.

### 2026-10-24: after snapshot 3 (`f673c9f`)

- **Browser-level guard spec** `tests/playwright/integration/nav-guard.spec.js`
  (part of `npm test` via the integration project). Its two server postures:
  - strict, no flags: page navigation, `fetch` and WebSocket to a local
    server never reach it (hit count), `file:` never exposed, Node-form
    code refused, page-sandbox code works;
  - control, `--allow-private-net`: the same actions **do** reach the
    server, so the strict checks cannot pass on a broken fixture.

  The decisive check is a top-level navigation, because Chrome's Private
  Network Access can block public→private subresources by itself. **Not run
  yet** (no Chromium in the sandbox). In the sandbox it parses and stops at
  "no browser", like `config-mcp-roots.spec.js`.
- **Regression fixed: CLI glob delete.** `szkrabok session delete "cfg-*"`
  used the same `deleteSession` and silently matched nothing after D5. The CLI
  now expands `*` against stored names and deletes each match by exact name;
  the MCP tool stays exact-only. Checked in a temp dir: `cfg-a` and `cfg-b`
  were deleted, `keep` was kept, and a pattern with no matches reports so.
- **Phase 4 docs:**
  - `README.md`: capability banner; session-name, URL, `browser_run` (both
    modes), `browser_run_test` (confined/legacy, params, reportFile); config
    discovery (roots/cwd ignored by the server, how to point it at a
    project).
  - `docs/testing.md`: harness flags, the `nav-guard` row, `config-mcp-roots`
    semantics, `test:hardening`.
  - `docs/scaffold-init.md`: availability, `--ignore-scripts`.
  - `docs/architecture.md`: file layout, hardening invariants 10–16, the
    `browser_run_test` flow, server-mode discovery.
- **Formatting:** `prettier --write` on this session's files. `format:check`
  (not part of `npm test`) now warns only on `run-test-env-v2.test.js`
  (second writer's file, left alone).
- **Slip, recovered:** a stray `git checkout fa465f5 --` detached HEAD at the
  2.1.5 release. No data was lost: the commits stayed on the branch, and the 6
  uncommitted edits were carried over because their files are identical
  between the two commits. Switched back and re-verified (hardening 180/180).

Decision needed (new): **D8 for ordinary desktop users.** The MCP server now
ignores project `szkrabok.config.toml` from MCP roots/cwd for **every**
server, not only the sandbox one. Users who relied on that must set
`SZKRABOK_ROOT`/`SZKRABOK_CONFIG`/`--config`. An option to weigh:
keep roots/cwd discovery when `--allow-node-code` is set. With Node code
execution already granted, a planted config adds no new capability (#8's
impact is code execution). Not implemented; the current behaviour matches
D8 as written.

Still open:
- R3 rebrowser `KNOWN_FAILURES`: needs the host e2e log to know which
  check now passes.
- Host re-run: R2 (setContent timeouts gone?), `nav-guard.spec.js`, and the
  updated `example-com.spec.js`.
- No changelog file exists in the repo. Release notes for the major bump
  (the "Behaviour changes" list above) still need to be written wherever
  releases are documented (`scripts/release-github.js`).
- Open questions 1–4, the companion work, and the squash/merge decision.

### 2026-10-24: D8 decision, option C (`--trust-project-config`)

Decided by the user after weighing four options (A: always ignore; B: load
with `--allow-node-code`; C: separate flag; D: trust by default). B was
rejected because it is not risk-neutral. Node code needs the model to act
(a successful prompt injection). A project config is a **passive** trigger:
opening a cloned hostile repo is enough, because the next `session_manage
open` launches its `executable_path`. Folding that into `--allow-node-code`
would hide a supply-chain risk behind a flag named for something else.
D is fail-open.

Implemented:

- `src/flags.js`: `--trust-project-config` → `trustProjectConfig`, and
  capability `projectConfig`. It is not implied by `--allow-node-code`.
  Typos of `--trust-*` refuse startup, like `--allow-*`.
- `packages/runtime/config.js`: the `serverMode` option was renamed to
  `skipProjectConfig`. When skipping, the MCP-root and cwd steps record
  `{ found, ignored: true }` (existence check only; an ignored file is
  never parsed), and `configMeta.ignored` lists the dirs.
- `src/server.js`: `skipProjectConfig = !trustProjectConfig`. It logs a
  `[WARN]` naming the flag when project configs were ignored.
- `packages/runtime/errors.js`: `BROWSER_NOT_FOUND` puts the ignored dirs
  and `--trust-project-config` first in its hint, and adds
  `context.config.ignored`. That was the most likely failure for an upgraded
  desktop user whose `executablePath` lived in the project's `.local.toml`.
- `spawnClient` is unchanged: it already sets `SZKRABOK_ROOT=<cwd>`.

Tests:

- `flags.test.js`: parse, typo, matrix (not implied by node code).
- `server-gating.test.js`:
  - default: cwd and root toml listed in `config.ignored`;
  - an invalid ignored toml does not break startup (never parsed);
  - with the flag, cwd and MCP-root toml load and `.env` still does not.
- New `ignored-config-hint.test.js`: the hint and context, and that the hint
  is unchanged when nothing was ignored.
- `config-mcp-roots.spec.js`: new live case where the flag makes the root
  toml's UA apply (**host run needed**).

Results: hardening 188/188, runtime unit + error-diagnostics 50/50, node
127/128 (sandbox Firefox), lint clean.

Docs:

- `README.md`: a "Server flags" block after the client examples, with the
  desktop command `npx -y @pablovitasso/szkrabok --trust-project-config
  --allow-node-code` and the trust caveat; discovery steps 4–5 and the
  ignored-config reporting.
- `docs/development.md`: flag table row; the local-dev command now uses the
  flag instead of `SZKRABOK_ROOT`.
- `docs/architecture.md`: invariant 15, discovery table, server lifecycle.
- Companion: the flag is forbidden in the sandbox posture; `check.sh` warns
  (it could reasonably be a hard fail); checklist row 11 expects the project in
  `config.ignored`.

### 2026-10-24: `params` prefix implemented (open question 4)

- `src/tools/run_test_args.js`: `buildTestEnv` writes each validated param
  as `SZKRABOK_PARAM_<KEY>` (exported as `PARAM_ENV_PREFIX`). Key shape,
  reserved set and value checks are unchanged (second layer). Inherited
  `SZKRABOK_PARAM_*` variables are scrubbed from the base env, so a spec
  sees only the current call's params.
- `run-test-env.test.js` updated: prefixed names, no bare names, inherited
  prefix scrubbed, fixed keys still win.
- Tool description (`registry.js`), README, `docs/testing.md`,
  `docs/architecture.md`, and "Behaviour changes for users" updated.
- No spec in this repo reads params, so no spec changes were needed.

Results (sandbox): hardening without v2 163/163, lint clean.
`run-test-env-v2.test.js` 18/28: its 10 failing tests read params under the
bare name (`env.URL`), so they now expect the old behaviour. The file belongs
to another writer and was not modified. Its owner must switch those
assertions to `SZKRABOK_PARAM_<KEY>`.

### 2026-10-24: host run at `ecb8aa5` and R3

Report: `reports/npm-test-2026-10-24T190914Z.md` (raw log alongside as
`.log`). The run started before snapshot 6, so it does not cover the
`SZKRABOK_PARAM_` prefix.

| Stage | Result |
|---|---|
| lint | pass |
| integration | 42 passed, 6 skipped, 0 failed |
| `tests/node/*.test.js` | 128/128 |
| hardening | 188/188 |
| e2e | 3 passed, 3 failed |

Findings:

- `nav-guard.spec.js`: first full run, 8/8 pass (strict and control groups).
  D7 browser layers are now verified on the host.
- `config-mcp-roots.spec.js` trusted-roots case: pass.
- **R2 not fixed.** The literal timeouts are gone from `scrape.spec.js`, but
  all 15 scrape tests still take ~31.5s. `browser_run` →
  `page.setContent(..., { waitUntil: 'domcontentloaded' })` hits
  Playwright's default 30s action timeout (16× in the log), then a retry
  passes. Fix target: `src/tools/szkrabok_browser.js` (`setContent` call,
  ~line 324), not the spec.
- **`example-com.spec.js` fails at launch.** The localStorage restore in
  `packages/runtime/launch.js:413` navigates to the saved origin
  (`bot.sannysoft.com/favicon.ico`), and its 10s timeout aborts the whole
  launch. Repro steps in the report.
- **R3 (done in this entry).** Rebrowser scored 9/10: only
  `mainWorldExecution` fails, and `exposeFunctionLeak` now passes. Both
  rebrowser specs failed on the stale `passed === 8`. `exposeFunctionLeak`
  was removed from `KNOWN_FAILURES` in `rebrowser.spec.js` and
  `rebrowser-mcp.spec.js`, and the exact-count assertion was kept (now 9).
  Headers, `docs/testing.md` and `docs/architecture.md` now say 9/10.
- **Separate lifecycle failure.** The direct `rebrowser.spec.js` run died
  at `waitForTimeout` with "target closed", plus 14 stealth
  `onPageCreated` `TargetClosedError`s. Not investigated.

### 2026-10-24: audit of snapshot 6 and R3

Fixed:

- The generated client (`packages/runtime/mcp-client/mcp-tools.{js,d.ts}`)
  was not regenerated in snapshot 6: the `params` doc text was stale and
  `REGISTRY_HASH` did not match the registry. Regenerated with
  `npm run codegen:mcp`.
- The inherited `SZKRABOK_PARAM_*` scrub was case-sensitive, unlike the
  `npm_` scrub next to it. Now case-insensitive, with a test.
- `rebrowser.spec.js` header: standalone score 7/10 → 8/10, following R3.

Checked, no change needed:

- Open question 2: the host run's `nav-guard.spec.js` case "Node-form code
  refused in page sandbox with hint" passed, so the decision's error-message
  part is implemented and verified.
- The prefix applies in legacy mode (`--allow-node-code`) and through
  `spawnClient` too. That is intended (one behaviour) and is covered by
  "Behaviour changes for users".

Still open:

- Whether the reserved-name check should stay for prefixed params. With the
  prefix, names like `path` are harmless but still refused.
- The standalone `rebrowser.spec.js` run asserts the MCP count (9), but the
  header says standalone scores 8 (`useragent` also fails). The exact-count
  assertion fails standalone. This predates R3 (it was 8 against 7).
- Open question 3 docs (egress proxy as the planned fix in the
  architecture invariants and the companion) are not written yet.

Results (sandbox): hardening without v2 163/163, v2 18/28 (owner),
`tests/node/*.test.js` 127/128 (Firefox missing), lint clean.

### 2026-10-24: R2 root cause and fix (spec side)

Cause: not the server. `page.setContent` sets up a `console.debug(tag)`
and waits for it to arrive as `Runtime.consoleAPICalled`
(`interceptConsoleMessage` in playwright-core). The rebrowser patch
suppresses `Runtime.enable`, so the tag never arrives and every
`setContent` hits the 30s action timeout. `szkrabok_browser.js:324` is only
where `browser_run` calls the caller's function, so it is not the fix
target named in the host report.

Why the tests still passed: there was no retry. `runJs` in
`scrape.spec.js` did not check `isError`. `document.write` had already put
the content in before the wait, so each test swallowed a 30s error and
went on.

Fix (`tests/playwright/integration/scrape.spec.js`):

- Fixtures are written with `page.evaluate` + `document.open/write/close`,
  without `setContent`.
- `runJs` asserts `!isError`, so a failed fixture step fails the test.

Docs: `docs/development.md` (patch section) notes the side effect for users:
no CDP console events, so `setContent` hangs. `page.on('console')` is
probably affected too (not verified).

Verification: lint only (no browser in the sandbox). **Host run needed:**
the 15 SCRAPE tests should drop from ~31.5s to a few seconds each, with no
`page.setContent: Timeout` lines in the log.

### 2026-10-24: `example-com` launch failure (localStorage restore)

Not a hardening regression: `packages/runtime/launch.js` is unchanged on
this branch, and the nav guard lives in the server (`src/`), not in the
standalone runtime launch. The restore loop had no error handling (the
cookie restore above it did), so one origin whose `goto` timed out
(`bot.sannysoft.com/favicon.ico`, 10s) aborted the whole launch. Why that
origin stalled was not investigated (network).

Fix (`packages/runtime/launch.js`): `restoreLocalStorage(context, origins,
profile)` is exported and best-effort per origin. Flat control flow, one
`try` per function and none nested, guard clauses instead of nested ifs:
origins without items are filtered out first and an empty list returns
before any page is opened; `restoreOrigin` never throws (it logs and
returns `false`); `page.close` is always reached. The call site's
length-computing if/else was replaced by one call. The log line reports
`restored/pending`. Same pass in `run_test_args.js`: the three-way
inherited-key condition became `isInherited(k)`.

Tests: new `tests/node/restore-local-storage.test.js` (fake context, no
browser): failing goto skipped and later origins still restored, failing
evaluate skipped, empty or missing origins open no page, page closed
whenever opened. Sandbox: 5/5; `tests/node/*.test.js` 132/133 (Firefox
missing); hardening without v2 163/163; lint clean.
**Host run needed:** `example-com.spec.js` should pass with a
"localStorage restore skipped" log line if sannysoft stalls again.

### 2026-10-24: host rerun (R2 verification)

Report: `reports/npm-test-2026-10-24T193644Z.md` (raw logs `.log` and
`-e2e.log` alongside). State: `ecb8aa5` plus the working tree of snapshots
6–8 and an intermediate version of the `restoreLocalStorage` fix. The
final guard-clause version (no page opened when nothing needs restoring)
was not in this run; its log line `Restored localStorage for 0/2` for the
empty-origins test shows the earlier code. The final version is covered by
the sandbox node tests (5/5).

| Stage | Result |
|---|---|
| lint | pass |
| integration | 42 pass / 6 skip / 0 fail (28.6s, was 1.9m) |
| `tests/node/*.test.js` | 131/131 |
| hardening | 181/191: the 10 `run-test-env-v2.test.js` failures (owner) |
| e2e (run separately; the chain stopped at hardening) | 5 pass / 1 fail |

Confirmed:

- **R2 fixed.** SCRAPE tests take 2.0–2.4s each (were 31.3–31.9s); zero
  `page.setContent: Timeout` lines (were 16).
- `nav-guard.spec.js` 9/9, `config-mcp-roots.spec.js` 3/3.
- **`example-com.spec.js` fixed:** pass in 1.5s (`Restored localStorage for
  1/1 origin(s) in dev`).
- **R3 confirmed:** nested MCP rebrowser run 9/10 (only
  `mainWorldExecution` fails); `rebrowser-mcp.spec.js` green.

Still failing:

- `run-test-env-v2.test.js` 10×: one cause, bare-name assertions (`env.URL`)
  against the `SZKRABOK_PARAM_<KEY>` contract. No validation or refusal
  logic fails. Its header's "pin — green against current src" claim is now
  false. Owner must update it.
- Direct `rebrowser.spec.js` run: unchanged. Target closed at
  `waitForTimeout(3000)` after step 3, with 14 stealth `onPageCreated`
  `TargetClosedError`s. The same spec passes 9/10 via MCP, so this is a
  lifecycle problem on the direct (standalone launch) path, not the checks.
  Not investigated.

### 2026-10-24: direct `rebrowser.spec.js` failure, root cause (analysis only)

Not a hardening regression: `stealth.js` and the plugin are unchanged on
this branch. Analysis is from the host logs and code, not reproduced.

Chain:

1. `puppeteer-extra-plugin-stealth` `evasions/user-agent-override`
   `onPageCreated` ends with `client.send('Network.setUserAgentOverride',
   …)` **without `await` or `.catch`** (index.js:182). The promise is
   dropped.
2. A page is created and closed quickly (14 other evasions log
   `addInitScript: Target … closed` from `onPageCreated`, in both the direct
   and the MCP run). That `send` rejects with `cdpSession.send: Target page,
   context or browser has been closed`. No one handles the rejection.
   (playwright-extra's `onPluginError` cannot catch it, because the plugin
   method had already returned.) Which page this is was not identified.
3. Direct run: the rejection happens inside the Playwright test worker. The
   runner reports it as the first error (`Error: cdpSession.send …`) and
   tears the worker down. The worker fixture's `handle.close()` closes the
   `dev` context ("Context dev was closed" at 19:39:04), so
   `page.waitForTimeout` fails.
4. MCP run: the same plugin runs in the server process. It passed this
   time, probably because of timing (`getPageCDPSession` returns a dummy
   client when the session cannot be created, so the race only bites when
   the session is created and the send then fails).

Second-order risk: `src/` and `packages/runtime/` have no
`unhandledRejection` handler, and Node ≥ 15 exits on an unhandled
rejection. The same race could crash the MCP server.

Fix (implemented after snapshot 9): `packages/runtime/stealth.js`
`guardUserAgentPlugin` wraps the `UserAgentOverride` plugin's
`onPageCreated`. The page it receives is a Proxy whose `_client()` returns a
client with a `send` that never rejects (it logs and returns `undefined`).
Every other property passes through, bound to the real page. The wrapper
must stay `async`: playwright-extra's `dispatch` only attaches
`.catch(onPluginError)` to hooks whose constructor is `AsyncFunction`.
(Its `try`/`catch` covers sync throws for both kinds.) A plain wrapper
returning the inner promise would leave that promise's rejection unhandled,
e.g. `await page.browser().userAgent()` failing on a closed page. Wording
corrected after the host verification.

Audit of the fix:

- **Reproduced at unit level.** Negative control (scratch script, real
  plugin, fake page whose `send` fails): unguarded 1 unhandled rejection,
  guarded 0.
- **Other evasions:** only `user-agent-override` drops a CDP promise.
  `sourceurl` wraps `send` on a throwaway shim client and drops nothing.
  The 14 `addInitScript` errors are awaited and reach `onPluginError`
  (noise, not fatal).
- **Bypass found and closed.** StealthPlugin could load its own, unguarded
  UA copy through an `[evasions]` entry. playwright-extra skips a
  dependency whose name is already registered, so with the override enabled
  the guarded copy shadows it. With `[user-agent-override] enabled = false`
  plus `evasions."user-agent-override" = true`, the unguarded copy loaded
  (and ignored `enabled = false`). `enhanceWithStealth` now deletes
  `user-agent-override` from `enabledEvasions` after the config loop.
  The wiring test failed with that line removed (control) and passes with
  it.
- **Accepted:** the guard swallows every `send` error, not only closed
  targets, because the plugin dropped the promise, so rethrowing would only
  make it unhandled again. A failed override is now a log line
  (`user-agent-override: Network.setUserAgentOverride skipped: …`) instead
  of a crash.
- **Pre-existing, not changed:** `stealth.enabledEvasions.delete('user-data-dir')`
  runs *before* the config loop, so an `evasions."user-data-dir" = true`
  entry re-enables it, despite the "PERMANENTLY DISABLED" comment in
  `szkrabok.config.toml`. Moving the line after the loop would fix it.
  Ask first.
- **Pre-existing, not changed:** no `unhandledRejection` handler in the
  server or runtime. This guard removes the one known source.

Tests: new `tests/node/stealth-ua-guard.test.js` (7): real plugin with a
closed target, nothing unhandled and `send` reached; open target, override
sent unchanged; hook is `AsyncFunction`; other hook failures still reject;
puppeteer-shape `_client`; wiring with the override enabled (one guarded
copy) and disabled (none). Sandbox: node 139/140 (Firefox missing),
hardening 163/163, lint clean.
**Host run needed:** direct `rebrowser.spec.js` should reach step 7. If the
closed-target race recurs, the log should show the `skipped` line instead
of the worker dying.

### 2026-10-24: host full run green; `user-data-dir`; SESSIONMODE

Host (owner's run after the v2 update, before snapshot 10 was committed):
`npm test` exit 0. Lint pass, integration 42/6 skip (24.9s), node 139/0,
hardening 191/0, **e2e 6/6** (18.7s). The direct `rebrowser.spec.js` run
now passes, which confirms the `guardUserAgentPlugin` fix.

**`user-data-dir` evasion (fixed after snapshot 10).**
`stealth.enabledEvasions.delete('user-data-dir')` ran before the config
loop, so `evasions."user-data-dir" = true` re-added it. This stealth
version has no `evasions/user-data-dir`, so `resolveDependencies` then
threw "Plugin dependency not found" and the launch failed. The delete now
runs after the loop, next to the `user-agent-override` one. Test in
`stealth-ua-guard.test.js`; the control (line removed) fails with "Plugin
dependency not found". `szkrabok.config.toml` comment notes that an entry
is ignored.

**Found, not changed (pre-existing):** the separate
`puppeteer-extra-plugin-user-data-dir` is loaded in every config,
transitively: `user-agent-override` → `user-preferences` →
`user-data-dir`. Under `launchPersistentContext` the profile dir is
positional, so the plugin's `beforeLaunch` sees no `options.userDataDir`.
It creates a temp dir (`os.tmpdir()`, prefix `puppeteer_dev_profile-`) on
every launch and writes the user-preferences files there. Playwright
ignores that dir. Effects: (1) preferences from `user-preferences` never
reach the real profile (silently ineffective); (2) probably one leaked temp
dir per launch, because `onDisconnected` may not fire for a persistent
context (not verified; check `ls /tmp/puppeteer_dev_profile-*` on the
host). Session profiles are not affected. Decision needed: neutralise the
plugin, or route the preference files into the real profile.

**SESSIONMODE (v2 owner's flag).** `src/fixtures.js:58` reads bare
`process.env.SESSIONMODE`, so `params: { sessionMode: 'clone' }` now
arrives as `SZKRABOK_PARAM_SESSIONMODE` and is ignored. Analysis: params
only exist on the `browser_run_test` path, which always sets
`SZKRABOK_CDP_ENDPOINT`. In CDP mode `resolveConfig` throws on any
`szkrabokSessionMode` other than `template`. So clone-via-params never
worked: before the prefix it was a startup error, now it is silently
`template`. SESSIONMODE is a standalone-only knob, set in the shell
(`SESSIONMODE=clone npx playwright test`), and that path is unchanged.
Recommendation: keep the bare read, and don't read the prefixed name (it
would only bring back the CDP-mode error). The v2 test comment calling this
a "product gap" should say "by design: standalone-only, not a param".
Owner's file; not edited. The only regression is diagnostic: the
misconfiguration error no longer fires through params.

### 2026-10-24: host verification of the stealth fixes

Independent claim check on the host (verdicts: all VERIFIED or acceptable;
one wording correction, applied above):

- Mutation matrix on scratch copies (repo untouched). Each mutation is
  caught by exactly the intended tests:
  - M1 (wrapper not `async`): the AsyncFunction test;
  - M2 (no `delete('user-agent-override')`): only the
    override-disabled wiring test;
  - M3 (no `delete('user-data-dir')`): the user-data-dir test;
  - M4 (guard is a no-op): 3 tests.
- `stealth-ua-guard.test.js` 8/8 on the host.
- e2e 3/3: the direct `rebrowser.spec.js` reaches step 7 (9/10) and
  passes.

New fact: the race fires **on every run**, not occasionally. Each run logs
`user-agent-override: Network.setUserAgentOverride skipped: cdpSession.send:
Target … closed`, and the guard absorbs it. So some page is created and
closed on every launch. Likely candidate (not verified): the
`restoreLocalStorage` page, which `launch()` opens and closes right away
whenever the profile has saved localStorage. The UA plugin's
`onPageCreated` is still awaiting `page.browser().userAgent()` when the page
closes. Harmless now, but the override is never applied to that page (it
is about to close anyway).

### 2026-10-24: open-question audit; user-data-dir plugin; docs

- **Transitive `user-data-dir` plugin: switched off.** Audit: only
  user-agent-override depends on `user-preferences`, and only that pulls in
  `puppeteer-extra-plugin-user-data-dir`. Under `launchPersistentContext` its
  `beforeLaunch` never sees the real profile: it made a
  `/tmp/puppeteer_dev_profile-*` dir per launch, wrote a `Preferences` file
  Chrome never read, and set `options.userDataDir`, which Playwright ignores.
  The only pref was `intl.accept_languages`, which Playwright's `locale`
  already covers. The dir is removed on disconnect (`deleteTemporary`), so
  it leaked only on a crash (the earlier "leak per launch" note was wrong).
  Fix: `USER_PREFERENCES_STUB` in `packages/runtime/stealth.js`, a hook-less
  plugin named `user-preferences` registered first; playwright-extra skips a
  dependency whose name is taken, so neither plugin loads and user-data-dir
  is never constructed. Two tests in `tests/node/stealth-ua-guard.test.js`
  (the stub is the only `user-preferences`, no `user-data-dir`; full
  `beforeLaunch` dispatch, all hooks run, leaves no `userDataDir`). Mutation
  (stub registration removed): both fail. The first draft of the
  `beforeLaunch` test passed under the mutation, because without `args`
  navigator.webdriver threw first and the dispatch stopped; fixed by passing
  `args: []` and asserting no plugin error.
- **`check.sh`:** decided (open question 5): hard-fail on
  `--trust-project-config` and `--allow-node-code`, override
  `CLAUDE_DOCKER_ALLOW_UNSAFE_SZKRABOK=1`; companion section 5 updated. The
  script itself is claude-docker work.
- **Question 3 docs:** `README.md` (literal block, not a boundary),
  `docs/architecture.md` invariant 14, companion chapter-7 item and new
  section 6 (egress proxy: Smokescreen or squid destination-IP ACL, host
  loopback only, wired via Playwright `proxy` in host config).
- **SESSIONMODE:** no code change; closed (the v2 comment was removed in the v2 merge, below). Was: message for the v2 owner: SESSIONMODE is
  read only in standalone runs, by design; it is not a param, because under
  `browser_run_test` the session already exists and only template mode is
  valid. Reword "product gap" to "by design: standalone-only".
- Sandbox: lint clean; `test:hardening` 191/191; `tests/node/*.test.js`
  142/143. The one failure is `firefox-engine-guard.test.js` "open()
  response includes browserEngine: firefox" (`BROWSER_NOT_FOUND`, no Firefox
  in the sandbox); it fails the same with the HEAD `stealth.js`.
- Host check (is the every-run `user-agent-override ... skipped` line caused
  by the `restoreLocalStorage` page?): see the next entry.

### 2026-10-24: host check: race source; temp-dir debris; stale headers

Host result (direct `rebrowser.spec.js`, run with and without `origins` in
`sessions/dev/state.json`; state restored byte-identical afterwards):

| | Run 1 (saved localStorage) | Run 2 (localStorage emptied) |
|---|---|---|
| `skipped` lines | 1 | 1 |
| restore | `Restored localStorage for 1/1 origin(s) in dev` | none (cookies still restored) |
| outcome | pass, 9/10 | pass, 9/10 |

- **Hypothesis refuted:** the race is not the restore page. In run 1 the
  skip comes at .830, after the restore (.281), during step 3 ("trigger
  required checks"), before step 4. The spec opens no page there, so the
  racing page is most likely one the site opens and closes itself (a
  popup; playwright-extra's `onPageCreated` sees those too). The guard is
  the right fix for that either way.
- **Diagnostic added:** the skip log now names the page
  (`... skipped on <url>: ...`). `pageLabel` runs inside the guard's catch,
  so it never throws (own `try`; a throwing `url()` gives `unknown page`).
  Test in `stealth-ua-guard.test.js`; mutation (no `try` in `pageLabel`)
  fails it. Next host run: read the URL from that line.
- **Temp dirs:** `/tmp/puppeteer_dev_profile-*` count 209 before and after
  (net 0). The 209 cluster at 21:09, 21:36, 22:02–22:05 and 22:13: the
  pre-guard runs whose worker died on the unhandled rejection, skipping the
  plugin's cleanup. Debris from that bug, not a separate leak; safe to
  delete on the host (`rm -rf /tmp/puppeteer_dev_profile-*` with no browser
  running). Since snapshot 13 the plugin is not loaded at all.
- **Stale headers fixed:** `rebrowser.spec.js` said standalone scores 8/10
  because `applyStealthToExistingPage` "only runs in wrapper.js"; it runs in
  `packages/runtime/launch.js` after `launchPersistentContext` for both
  paths, and the host direct run scores 9/10. The CLI commands in the
  `rebrowser`, `navigator` and `intoli` spec headers named a removed
  `automation` project / `playwright-tests/` config; now
  `PLAYWRIGHT_PROJECT=e2e npx playwright test --project=e2e <file>`.
  `scripts/inspect-page.mjs` named the removed `browser.run_file` tool; now
  `browser_run` with `path`, noting it needs `--allow-node-code`. This also
  closes the "standalone count" item under "audit of snapshot 6".
- Sandbox: lint clean; `test:hardening` 191/191; `tests/node/*.test.js`
  143/144 (Firefox missing, as before).

### 2026-10-24: v2 merged into `run-test-env.test.js`

At the user's request, `tests/node/hardening/run-test-env-v2.test.js` was
merged into `run-test-env.test.js` and deleted, to remove the duplication.
Rule: no coverage lost.

- Taken from v2: every F1–F8 test, `invalidField` (each refusal also
  checks `err.field`), `false`/`0` stringified, 1-char keys, BigInt and
  function values refused, F2/F3 fixed-key pins, purity tests, the
  key-names-only `process.env` check.
- Kept from the main file (v2 lacked them): `PARAM_ENV_PREFIX` exported;
  inherited `SZKRABOK_PARAM_*` dropped including stale and lowercase keys;
  a fixed key beats a param at the same prefixed key (folded into the
  "fixed is applied last" test); one named test per reserved key (now also
  for the F1 names and families, which v2 checked in one loop).
- v2's SESSIONMODE "product gap" comment is gone, with no replacement:
  test files check behaviour and carry no design claims. Design lives in
  this file and `docs/architecture.md`; tests do not drive it.
- Added: `params: []` refused. An empty array has no keys for the key
  check to reject, so only the shape check catches it.
- **Proof, mutation matrix** over `src/tools/run_test_args.js`, 27
  mutants, each run against the old main file, v2 and the merged file.
  Lost coverage: 0. Every mutant either old file killed, the merged file
  kills. Old main alone missed 10 (e.g. npm_* family, PYTHON/BASH_ENV,
  collisions, NaN, `fixed` shape and field, frozen keys, baseEnv
  mutation); v2 alone missed 2 (inherited-param scrub, its case-folding).
  The one mutant all three missed (array check on `params` removed) is
  killed by the new `[]` case.
- Counts: 48 (main) + 28 (v2) tests became 74. The reserved-name loops
  now emit one test per name.
- Sandbox: lint clean; `test:hardening` 189/189 (was 191: 48 + 28 env tests became 74).

### 2026-10-24: host: racing page identified; snapshot 13 verified

- The skip line names the page: `user-agent-override:
  Network.setUserAgentOverride skipped on about:blank: cdpSession.send:
  Target page, context or browser has been closed` (21:11:23.557), during
  step 3, 0.9s after the localStorage restore. A transient `about:blank`
  popup the site opens and closes itself; the spec's own page survives to
  step 8. Fully explained; the guard stays the fix, no further diagnosis.
- Run: pass, 9/10, reached step 8.
- Snapshot 13 verified on the host: `/tmp/puppeteer_dev_profile-*` 209 →
  209, no new dir; `USER_PREFERENCES_STUB` keeps
  `puppeteer-extra-plugin-user-data-dir` out. The 209 are pre-guard debris;
  the user may delete them (`rm -rf /tmp/puppeteer_dev_profile-*` with no
  browser running). Nothing deleted so far.

### 2026-10-24: host full run before release (21:24Z)

Report: `reports/npm-test-2026-10-24T212435Z.md` (per-suite logs alongside).
The host tree had the code of snapshot 15 (`fc5dd1b`); snapshots 16–17 are
docs only. The host git is at `05c6d4a`, with the sandbox snapshots present as
uncommitted changes, so a bundle hand-off is needed before release.

| Suite | Result |
|---|---|
| `node --test tests/node/*.test.js` | 144/144 (Firefox included) |
| `test:hardening` | 189/189 |
| Playwright integration | 42 passed / 6 skipped (environment-gated, as before) |
| e2e | 6/6; direct `rebrowser.spec.js` 9/10, one `skipped on about:blank` line (known popup race) |

Corrections from this run:

- `npm run test:node` is a disabled stub, and has been since `f703f43` (not
  this branch). The real suite is `node --test tests/node/*.test.js`, run
  inside `test:self`. `CLAUDE.md` now says so.
- `package.json` had `test:hardening` twice, with the same value. Two writers
  added it (`67463d8`, `ba07d84`). One is removed.

### 2026-10-24: docs audit before release; runtime suite wired in

- **Gap:** `tests/node/runtime/*.test.js` (15 files, 239 tests) was in no
  npm script except two single-file shortcuts, so no full run since
  `5c03377` covered it, and the release gate missed it. Now
  `npm run test:runtime`, part of `test:self`. Sandbox: 216/239; all 23
  failures are `BROWSER_NOT_FOUND` / no Firefox. **Needs a host run before
  release.**
- Every test file is now reached by a script: `tests/node/*.test.js`,
  `test:runtime`, `test:hardening`, integration (`test:self`), e2e
  (`test:auto`).
- Release notes: the intro claimed clients cannot "reach host-local
  services"; reworded to the literal-address block (invariant 14).
  `NODE_OPTIONS`/`npm_*` scrubbing moved from fixes to breaking (a spec that
  relied on them changes); "stale `SZKRABOK_PARAM_*`" dropped (2.x had no
  prefix). `spawnClient` `SZKRABOK_ROOT` default made precise; CLI noted as
  unaffected; design link is a URL at the tag.
- README: `spawnClient` (not `mcpConnect`) sets `SZKRABOK_ROOT`, only when
  unset; legacy `reportFile` is a path.
- `docs/mcp-client-library.md`: `spawnClient({ args, env })` and its default
  flags were undocumented.
- `docs/testing.md`: config order lacked `--config` and the server-mode
  roots/cwd rule; runtime commands updated.
- `docs/architecture.md` invariant 8 said `src/fixtures.js` never reads
  `process.env`; it reads the runner-channel defaults (unchanged since
  2.1.5). The doc now describes the code. Invariants 7–9 put in order.
- Companion proposal: row 4 had a working payload and row 9 a wrong
  expectation; fixed, and the checklist points at the handout, which is now
  the current source for tasks and checks.
- "Current situation" marked as a historical snapshot; it claimed to be
  current and was not.
- Open from incident 2: rotate the GitHub token printed on 2026-10-24, if not
  done yet.

## End of day 2026-10-24: resume here

State: the snapshots are squashed into `139acf2` on `main` (on top of
`fa465f5`, 2.1.5) and adopted on the host; `wip/claude-docker-hardening`
keeps the full history. Not pushed, not published.

Done: every design item D1–D9 and E5–E9, the D8 option C flag
(`--trust-project-config`), Phase 4 docs, the browser-level guard spec, and
the CLI glob fix.

Last results:

| Suite | Where | Result |
|---|---|---|
| `test:hardening` | sandbox @ `fc5dd1b` | 189/189 (v2 merged) |
| lint | sandbox @ `fc5dd1b` | clean |
| `tests/node/*.test.js` | sandbox @ `fc5dd1b` | 143/144 (only `firefox-engine-guard`: no Firefox in the sandbox) |
| `tests/node/*.test.js` | host @ `ecb8aa5` | 128/128 |
| `test:hardening` | host @ `ecb8aa5` | 188/188 |
| Playwright integration | host @ `ecb8aa5` | 42 passed / 6 skipped |
| e2e | host @ `ecb8aa5` | 3 passed / 3 failed (R3, now fixed; `example-com` launch) |
| e2e | host, after the fixes | 6/6; direct `rebrowser.spec.js` 9/10, racing page `about:blank` |
| full run | host @ snapshot 15 code (21:24Z) | node 144/144, hardening 189/189, integration 42/6 skip, e2e 6/6 |

Resume with, in order (updated after the host rerun at 19:36Z):

1. **`run-test-env-v2.test.js`:** merged into `run-test-env.test.js` and
   deleted (see "v2 merged"). One env-contract file now.
2. **Direct `rebrowser.spec.js` target-closed failure:** root cause found
   and fixed (`guardUserAgentPlugin`, see its entry). Confirmed on the host
   (e2e 6/6). The `user-data-dir` re-enable gap is
   fixed, and the transitive `user-data-dir` plugin is switched off (see
   "open-question audit"; verified on the host, 209 → 209 temp dirs). The
   race is a transient `about:blank` popup, not the restore page (host
   check); fully explained. R2, `example-com` and R3 are
   fixed and verified on the host (see "host rerun").
3. **Decisions:** open questions 1–4 are decided (see "Open questions").
   Question 5 (`check.sh` hard fail) is decided too. The
   `SZKRABOK_PARAM_` prefix (question 4) is implemented (see the
   progress entry below); it still needs a release-notes entry. The
   question 3 rebinding docs are written (README, architecture invariant
   14, companion section 6). SESSIONMODE: closed; v2 is merged and its
   comment removed, so there is no owner message to send.
4. **Release:** notes written (`docs/releases/3.0.0.md`); WIP snapshots
   squashed into one commit on `main` and handed off as a bundle. On the
   host: adopt, then `npm run release:major`, `release:publish`,
   `release:github` (it uses `docs/releases/<version>.md` when present).
5. **Companion work** in claude-docker, starting with mount-guard verification.
   Work order: [companion handout](./20261024-claude-docker-companion-handout-proposal.md).

Related docs:

- [Companion: claude-docker host wiring](./20261024-claude-docker-deployment-companion-proposal.md)
- [Companion handout (work order)](./20261024-claude-docker-companion-handout-proposal.md)
- [Host verification run](./20261024-hardening-verification-run.md)

The sandbox has no Chromium or Firefox. Browser suites run only on the
host, and the results come back to this file.

Working rules learned today:

- One writer in the tree. A concurrent writer once cost a test file.
- Never deep-compare or print `process.env` in tests. A failing
  `deepStrictEqual(process.env, …)` once printed the sandbox `GH_TOKEN`.
  Compare key names only.
- Env and security tests prove that a key or path is **blocked**, using
  reserved names with dummy values (`'x'`). They never contain working
  payloads and never spawn a child with hostile env. A payload-style draft
  was stopped by the safety classifier. End-to-end attack checks belong in
  the companion's manual host checklist.
- (Retired after the v2 merge: "`run-test-env-v2.test.js` belongs to
  another writer". The user handed it over; it no longer exists.)
- Commit only when asked, as WIP snapshots on the branch.
- Status goes in this feature file, never in assistant memory.

### 2026-10-24: host `test:self` — PC-5 mocks; report back applied

- Host `test:self`: node 144/144; `test:runtime` 257 pass / 5 fail / 1 skip
  (first full run); `test:hardening` not reached (`&&` chain).
- The 5 failures: `pc-layer5.test.js` PC-5.1–5.3, 5.5, 5.6. Stale mocks, not
  product code: `installNavGuard` (wired into `open` by D7) calls
  `page.on`, `context.route` and `context.routeWebSocket`, which the fakes
  lacked. The host saw only the first (`page.on`); the mock fix exposed
  `context.route`. Fixed in the fakes. Sandbox with a stand-in
  `CHROMIUM_PATH=/bin/true`: 12/12 (before: the host's TypeError,
  reproduced).
- Correction: I had filed all 23 sandbox runtime failures as "no browser".
  These 5 stop at `checkBrowser` in the sandbox, which hid the defect. With
  the stand-in path, every remaining runtime failure is a real launch
  (`DevToolsActivePort`, state persistence), Firefox, or a no-browser
  expectation; none is a mock defect.
- PC-5.4 asserted `/open|clone/i`; now the exact guard message
  (`cannot clone … while it is open`). It was passing for the right reason
  (the guard throws before any launch).
- Report back (below), checked against the code: the session-name limit is
  64 for templates and 96 for ids (`src/utils/validate.js`), so the
  handout's "rename any" advice is fixed (clone-id-shaped dirs are crash
  leftovers: delete). `@playwright/mcp` is removed on that side; the
  handout and companion say so. Open on that side: the one-directional
  mount guard (fix pending) and the `config/settings.json` deny list, which
  blocks `browser_run`/`browser_run_test` (decision at rollout).

## Report back from the claude-docker side (2026-10-24)

Per the companion handout ("Report back to szkrabok"). The wrapper
repo state: hardened guards deployed (D2), the C5-audit fixes
committed, D3 pending.

### Task 1, per box (the mount guard)

| Box | Result |
|---|---|
| project ⊇ path (`/home/jones2` refused) | holds. `guard_mount` hostcode group, `subject_holds`. Rows in `check.sh` (`check_c1`) |
| path ⊇ project (`/home/jones2/szkrabok-tests/automation` refused) | **failed as found.** The hostcode group was one-directional. Fix in scope, lands with the next wrapper commit: `subject_holds \|\| path_holds`, with rows for the inside case |
| realpaths compared, every string element scanned | holds. `readlink -f` both sides; `mcp_hosts_strings` walks the parsed JSON: every string, keys included, anything after `--` (audit F10) |

### Where the handout is wrong or unclear

1. **Session-name regex.** The handout states
   `^[A-Za-z0-9][A-Za-z0-9._-]*$`, at most 64 chars. D5 here sets
   `{0,95}` (96 total), deliberately: 64-char template names plus
   generated clone ids (≤ 87) must pass. The handout's migration
   advice ("rename any whose name does not match") would reject
   clone ids. Feature wins.
2. **`@playwright/mcp` residual.** The handout treats it as a
   residual to document. In the claude-docker posture it is removed
   entirely (dropped from `mcp-hosts.json`, pinned out) and must not
   return. The wrapper doc line becomes "removed; do not re-add".

### What the wrapper side needs once the release lands

Blocked on step 0. Nothing below is started.

- Task 3: the two root flags add path strings to `mcp-hosts.json`.
  The F10 scan covers them; the task-1 box-2 guard fix lands first.
- Task 5: a `check.sh` posture suite: hard fail on
  `--allow-node-code`/`--trust-project-config` (override
  `CLAUDE_DOCKER_ALLOW_UNSAFE_SZKRABOK=1`, env only, never in
  `config/`), warn on `--allow-private-net`, spec-root invariants
  (exists, no writable bits, disjoint from work-root and `--cwd`,
  `node_modules/.bin/playwright` present).
- Task 4: chapter 7 (the flags table, the spec-root contract, the
  rebinding caveat), the Mount guards section, one line in the
  seeded handout.
- The F6 deny list (`config/settings.json`) denies `browser_run`,
  `browser_run_test`, `scaffold_init` — a speed bump for the
  pre-hardening RCE. It blocks the handout's own goal (rows 1 and 13
  need `browser_run`). Decision at rollout: shrink it to nothing, or
  keep `scaffold_init` as belt and braces. Not yet decided.

Task 6 (the live verification table) not run: blocked on the
release.
