# Feature: hardening the szkrabok MCP server (claude-docker host)

## Status

- Done. Released as 3.0.0: `cd0d237`, tag `v3.0.0`. Notes:
  [`docs/releases/3.0.0.md`](../releases/3.0.0.md).
- `wip/claude-docker-hardening` keeps the snapshot history.
- Host wiring: [companion proposal](./20261024-claude-docker-deployment-companion-proposal.md)
  (rationale), [handout](./20261024-claude-docker-companion-handout-proposal.md)
  (work order, current).

## Goal

szkrabok runs on the host as the browser MCP server for claude-docker
(`config/mcp-hosts.json` → `uvx mcp-proxy --cwd /home/jones2/szkrabok-npx --
node …/bin/szkrabok.js`, 127.0.0.1, unix-socket relay into the container).
Tool calls come from the container; side effects land on the host as
`jones2`.

Required: a hostile tool call gives no host code execution, no host file
read, no host write outside two fixed dirs, no reach into host-local
services by literal address.

## Threat model

| Input | Trust |
|---|---|
| server argv (`config/mcp-hosts.json`) | trusted: hand-written, reviewed at deploy, mount-guarded |
| tool arguments | hostile (container is prompt-compromised) |
| MCP client roots, project dir | hostile (mounted read-write in the container) |
| `szkrabok.config.toml` via roots/cwd, `.env` in cwd | hostile |
| spec root (specs, config, its `node_modules`) | trusted: host-authored, never written by szkrabok or Playwright |
| web content | hostile; runs on the host network stack |
| CDP endpoint | never relayed; never `--remote-allow-origins` |

The claude-docker mount guard refuses a project overlapping any path in
`mcp-hosts.json`, so every root flag falls under it (both directions
required; see claude-docker side).

## Findings and fixes

Severity as found in 2.1.5.

| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | crit | every tool registered unconditionally, no gate | D1 flags + capability matrix |
| 2 | crit | `browser_run` = Node `eval` / `import()` → host RCE | D2 page sandbox by default |
| 3 | high | no path confinement; `config`/`files`/`reportFile` escape via `..`/absolute; `REPO_ROOT` ≠ `--cwd` | D3 `confinePath`, two roots |
| 4 | high | `scaffold_init install` runs planted `preinstall` | D4 gated + `--ignore-scripts` |
| 5 | high | `session_manage delete` globs + `../` traversal → `rm -r` anywhere; same join in open/close/meta | D5 name rule, exact delete, storage containment |
| 6 | crit | test tools run container-supplied config/specs (Node code) | D6 spec root |
| 7 | high | `file://` navigation + scrape → host file exfiltration | D7 scheme allowlist |
| 8 | crit | config from MCP roots → `executable_path` spawned | D8 server ignores roots/cwd |
| E1 | crit | `params` spread into child env after fixed keys → `NODE_OPTIONS=--import=data:…` RCE with no file; also overrides `PLAYWRIGHT_JSON_OUTPUT_NAME` etc. | D9 prefix + reserved set + fixed keys last |
| E2 | high | `reportFile` = arbitrary JSON write | D3/D6 bare name under reports dir |
| E3 | high | `files` entries parsed as Playwright options (`-c`, `--output=`) | D6 absolute confined paths only |
| E4 | med | runs write into the spec root (`test-results`, snapshots) | D6 `--output`, `--update-snapshots=none` |
| E5 | med | `.env` in cwd loaded at startup, can set `SZKRABOK_CONFIG`/`ROOT`/`SESSIONS_DIR` | D8 `.env` CLI-only |
| E6 | med | browser proxies into host loopback/LAN (other MCP proxies, CDP `/json`) | D7 private-address block |
| E7 | low | `launchOptions._launchImpl` test seam reachable | `_`-prefixed launch options stripped |
| E8 | low | `npx` may fetch `playwright` from the registry | local `.bin/playwright`, else `npx --no-install` |
| E9 | info | `list` config metadata shows host paths | accepted (audit value > attacker value) |

Found during implementation and verification:

| Finding | Cause | Fix |
|---|---|---|
| CLI `session delete "cfg-*"` silently matched nothing | shared `deleteSession` lost globs (D5) | CLI expands `*` over stored names, deletes each exactly; MCP stays exact-only |
| `localhost.` passed the guard | trailing-dot FQDN | normalised before classification |
| `scaffold_init` npm output corrupted MCP stdout | `stdio: 'inherit'` | npm output to stderr |
| scrape tests 31s each (R2) | rebrowser patch suppresses `Runtime.enable`; `setContent` waits for a console tag that never arrives | fixtures use `document.open/write/close`; `runJs` asserts `!isError`; documented in `docs/development.md` |
| `example-com` launch aborted | one stalled localStorage origin (`goto` timeout) aborted `launch()` | `restoreLocalStorage` best-effort per origin, no page when nothing to restore |
| direct `rebrowser.spec.js` worker died | stealth `user-agent-override` drops the `Network.setUserAgentOverride` promise; a transient `about:blank` popup closes → unhandled rejection (Node ≥ 15 exits; could crash the server too) | `guardUserAgentPlugin`: `_client().send` never rejects, logs `skipped on <url>`; wrapper stays `async` |
| unguarded UA copy loadable | `[evasions] "user-agent-override" = true` with the override disabled | `enhanceWithStealth` deletes it from `enabledEvasions` after the config loop |
| `evasions."user-data-dir" = true` broke launch | delete ran before the config loop | delete moved after the loop |
| `/tmp/puppeteer_dev_profile-*` per launch, prefs never applied | transitive `user-agent-override` → `user-preferences` → `user-data-dir` (Puppeteer-only); only pref `intl.accept_languages`, covered by `locale`; dir leaked on crash | `USER_PREFERENCES_STUB` registered first; playwright-extra skips a taken dependency name, so neither plugin loads |
| rebrowser exact count stale (R3) | `exposeFunctionLeak` now passes (site / Playwright 1.63) | removed from `KNOWN_FAILURES`; count kept as drift detector (9/10) |
| mocks without `on`/`route`/`routeWebSocket` (`firefox-engine-guard`, PC-5) | nav guard now installed on every `open` | mocks completed; guard not made optional (`page.on?.()` would let it silently not install) |
| `tests/node/runtime/*` in no full run | absent from `test:self` since `5c03377` | `npm run test:runtime`, part of `test:self` |
| `test:hardening` defined twice; `npm run test:node` a stub | two writers; stub since `f703f43` | duplicate removed; `CLAUDE.md` names the real commands |

Checked, not findings: `grep`/`project` are separate argv elements;
`browser_scrape` is a pure `page.evaluate`; MCP-roots walk-up is bounded
(still hostile, #8).

## Design (as built)

### D1. Capabilities are server argv, never tool arguments

| Flag | Grants |
|---|---|
| `--work-root <abs>` | only tool write target: `<dir>/sessions/`, `<dir>/reports/`. Default cwd |
| `--spec-root <abs>` | confined `browser_run_test`/`session_run_test`; page-mode `browser_run path` |
| `--allow-node-code` | Node-form `browser_run`, `scaffold_init`, unconfined test tools |
| `--trust-project-config` | project `szkrabok.config.toml` (roots/cwd) |
| `--allow-private-net` | loopback/private destinations |

| Tool | default | `--spec-root` | `--allow-node-code` |
|---|---|---|---|
| `session_manage`, `browser_scrape` | on | on | on |
| `browser_run code` | page | page | Node |
| `browser_run path` | off | page, spec root | Node |
| test tools | off | confined | unconfined |
| `scaffold_init` | off | off | on |

- argv only (`src/flags.js`); not toml, not env, not `.env`.
- Startup refuses (exit 2, stderr + `~/.cache/szkrabok/startup.log`):
  relative/missing root, root not a dir, overlapping roots (realpath,
  default cwd counted), unknown `--allow-*`/`--trust-*`. Rationale: a typo
  must not change posture; disjoint roots are what keep writes out of the
  spec root, so checked, not assumed.
- Gated call → `CAPABILITY_DISABLED` naming the flag; descriptions carry an
  availability note built from active flags.
- `session_manage list` → `server.flags`, `server.capabilities`, `config`
  (`source`, `searched`, `ignored`): container adapts, operator audits.
- Every call passes `guardToolCall()` (`src/tools/policy.js`) before the
  handler; all validation precedes session lookup, launch, mkdir, spawn.

### D2. `browser_run` runs in the page

- `code`: `(args) => result`, `page.evaluate`, JSON result. No Node, no
  Playwright API → nothing can feed host paths to `setInputFiles`.
- `path`: one function expression from the **spec root** (not the work
  root: `sessions/*/state.json` evaluated as JSON would return cookies).
- `fn` refused (`export` is a syntax error in `page.evaluate`). Errors:
  `PAGE_EVAL_FAILED` + hint naming `--allow-node-code`.
- Names kept (decision 2).

### D3. Two roots, one validator

`confinePath(root, input, { mustExist })` (`src/utils/paths.js`): refuse
non-string, empty, NUL, leading `-`; resolve; realpath (missing write target:
parent + basename); must stay inside the realpath'd root; callers use only
the returned path.

| Input | Root |
|---|---|
| `browser_run path`, test `config`/`files` | spec |
| `reportFile` | `<work-root>/reports/<session>/`, bare `*.json` |
| `scaffold_init dir` | work (with `--allow-node-code`) |

- `REPO_ROOT` removed. Run artifacts (`last-run.log`, `.attach-signal`,
  report, `test-results`) → `<work-root>/reports/<session>/`.
- Sessions → `<work-root>/sessions`, overriding `SZKRABOK_SESSIONS_DIR`:
  one place decides.
- TOCTOU accepted: the container writes neither root.

### D4. `scaffold_init`

Behind `--allow-node-code` (useless in the sandbox posture: its output can
never be test config there). `npm install --ignore-scripts`.

### D5. Session names

`^[A-Za-z0-9][A-Za-z0-9._-]*$`, templates ≤ 64, server ids ≤ 96
(`src/utils/validate.js`).

- Alphanumeric first char rejects `.`, `..`, `-flag`.
- 96: clone ids are `<template>-<13-digit ms>-<8 hex>` (+23 chars).
- MCP delete exact-only; `matchGlob` removed.
- `storage.getSessionDir(id)` asserts one-level containment: covers `rm`,
  `saveState`, `saveMeta`, `getUserDataDir` at once.

### D6. Confined test runner

- `config` (default `playwright.config.js`) and `files` confined to the
  spec root; spawn `cwd` = spec root.
- argv only from validated values (`buildTestArgv`): `--config <abs>`,
  `--output <reports>/test-results`, `--update-snapshots=none`,
  `--reporter list,json` (replaces config reporters), `--project`,
  `--workers` (1–64), `--grep=<v>` (one token), absolute files.
- No `--` separator: Playwright 1.63 matches nothing after it. Injection is
  closed by absolute-only files instead.
- Binary: `<spec-root>/node_modules/.bin/playwright`, else `npx
  --no-install playwright`.
- Unconfined (`--allow-node-code`): relative to the work root; default
  report under `<work-root>/reports/<session>/`.

### D7. Navigation guard

- Schemes: `http:`, `https:`, `about:blank` only; always, regardless of
  flags.
- Destinations (without `--allow-private-net`): `localhost`,
  `*.localhost`, trailing-dot forms; loopback, link-local, private,
  unspecified IPv4/IPv6 literals incl. IPv4-mapped and the encodings
  `new URL()` normalises.
- Layers (`src/utils/url-guard.js`, `src/tools/nav_guard.js`), installed on
  template, clone, reuse, clone-from-live:
  1. call site: `open`, clone, `session_run_test navigation.url`, before
     launch;
  2. context: `route('**/*')` aborts blocked requests; `routeWebSocket`
     blocks by destination (WebSockets bypass `route`); both only without
     `--allow-private-net` (routing disables the HTTP cache);
  3. main-frame `framenavigated` watcher resets a blocked frame to
     `about:blank` (closing would break the session; `chrome-error://`
     exempt);
  4. read side: `browser_scrape` and page-mode `browser_run` refuse a
     blocked document URL.
- Residuals: hostnames resolving to private IPs (DNS rebinding), Service
  Worker traffic. Defence in depth, not a boundary (decision 3).
- Downloads: Playwright default; no tool exposes download content.

### D8. Config: host-controlled sources only

- Server order: `--config` → `SZKRABOK_CONFIG` → `SZKRABOK_ROOT` → (roots,
  cwd: only with `--trust-project-config`) → XDG → defaults. CLI unchanged.
- Skipped files: existence-checked only, never parsed; listed in
  `config.ignored`, a startup `[WARN]`, and first in the
  `BROWSER_NOT_FOUND` hint (likeliest upgrade failure: `executablePath` in
  the project's `.local.toml`).
- `.env`: CLI only.
- `--trust-project-config` is its own flag, not implied by
  `--allow-node-code`. Rationale: Node code needs the model to act; a
  project config is passive (cloning a repo is enough, next `open` runs its
  `executable_path`). Folding it into `--allow-node-code` hides a
  supply-chain risk behind an unrelated name. Trust-by-default is
  fail-open.

### D9. Test-run env

`buildTestEnv` (`src/tools/run_test_args.js`), in order:

1. base `process.env` minus inherited `NODE_OPTIONS`, `npm_*`
   (case-insensitive), `SZKRABOK_PARAM_*`;
2. params as `SZKRABOK_PARAM_<KEY>` (decision 4);
3. fixed keys last: `FORCE_COLOR`, `SZKRABOK_SESSION`,
   `SZKRABOK_CDP_ENDPOINT`, `PLAYWRIGHT_JSON_OUTPUT_NAME`,
   `SZKRABOK_ATTACH_SIGNAL`, `PLAYWRIGHT_PROJECT`.

Second layer, kept under the prefix:

- key `^[A-Z][A-Z0-9_]{0,63}$` after uppercasing; case-fold collisions
  refused;
- reserved prefixes `NODE_ NPM_ NPX_ LD_ DYLD_ PLAYWRIGHT_ PW_ SZKRABOK_
  DEBUG ELECTRON_ UV_ GIT_ PYTHON PERL5 RUBY JAVA_ JDK_`;
- reserved names `PATH HOME SHELL TMPDIR TMP TEMP USER LOGNAME DISPLAY
  XAUTHORITY SSH_AUTH_SOCK BROWSER BASH_ENV ENV SHELLOPTS BASHOPTS IFS PS4
  PROMPT_COMMAND CDPATH GLOBIGNORE`;
- values: string, finite number, boolean; ≤ 4096; no NUL. `params` a plain
  object (not array); `fixed` a plain object.

Audit findings F1–F8 (tags in `tests/node/hardening/run-test-env.test.js`)
widened the original design: F1 shell/interpreter names and families, F2/F3
fixed keys pinned, F4 whole `npm_*` family, F5 plain `fixed`, F6 finite
numbers, F7 length in UTF-16 units, F8 NUL keys, case-fold collisions, no
`process.env` mutation.

`SESSIONMODE` stays a bare, standalone-only knob (`src/fixtures.js`): params
exist only on the CDP path, where `resolveConfig` accepts only `template`.

## Decisions

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | `--work-root` required? | default cwd | cwd is set by the host (mcp-proxy `--cwd`), never the model; required flag = breaking change, no safety gain |
| 2 | rename `browser_run` for page mode? | keep names; Node-only input fails with a hint | clients re-read descriptions each session; `spawnClient` keeps Node mode. Fallback if it confuses: split into two tools (cheap in a major) |
| 3 | DNS rebinding | literal block + documented residual; egress proxy is the fix (companion §6) | `--host-resolver-rules` matches hostnames, not resolved IPs; a Node-side lookup is re-resolved by the browser; OWASP SSRF: check after resolution (Smokescreen, squid dest-IP ACL); Playwright MCP calls `--allowed-origins` not a boundary either |
| 4 | params allowlist | fixed prefix `SZKRABOK_PARAM_` | env across a trust boundary = allowlist (sudo `env_keep`, systemd `PassEnvironment`, sshd `AcceptEnv`); blocklists leak per new interpreter; prefix = GitHub Actions `INPUT_*`, nothing to maintain. Cost: specs read the prefixed name (release notes) |
| 5 | `check.sh` on code grants | hard fail `--allow-node-code`, `--trust-project-config`; override `CLAUDE_DOCKER_ALLOW_UNSAFE_SZKRABOK=1` per run; warn `--allow-private-net` | workspace-code loaders refuse by default with a named opt-in (VS Code Workspace Trust, git `safe.directory`, direnv `allow`); warnings get scrolled past |
| 6 | project config for desktop users | `--trust-project-config` (D8) | see D8 |
| 7 | Puppeteer-only `user-data-dir` plugin | stub `user-preferences` | it never reached the real profile; its one pref duplicates `locale` |
| 8 | UA guard scope | swallow every `send` error, log it | the plugin drops the promise; rethrowing only makes it unhandled again |

## Rejected alternatives

- Trust roots but ignore `executable_path`: whack-a-mole; drop untrusted
  sources instead.
- Remove `browser_run`: the page form keeps most value, no host capability.
- Sign/HMAC specs: key management for what a host-owned root already gives.
- One flag for Node code and tests: forces `eval` grants to run reviewed
  specs; the spec root is narrower.
- Params denylist only: `NODE_OPTIONS` has many spellings across Node, npm,
  loaders.
- `page.on?.()` in the guard for mock convenience: guard could silently not
  install.

## Non-goals and residual risk

- Sandboxing the szkrabok process (runs on the host by design).
- Egress control: literal-address block only until the proxy exists.
- Protecting the spec root from `jones2`: code invariant + `chmod a-w`
  tripwire, not an OS guarantee.
- Spec code is trusted host code: it can do anything; review the spec root,
  including `node_modules`.
- `@playwright/mcp`: removed from the claude-docker posture (their side).
- No `unhandledRejection` handler in server/runtime; the one known source
  (UA plugin) is guarded.

## Behaviour changes (breaking → 3.0.0)

Full list: release notes. In short: fail-closed server; page-mode
`browser_run`; test tools need a root flag; params prefixed; no project
config or `.env` in server mode; exact-name delete; sessions under the work
root; non-web schemes refused, private literals refused by default;
`spawnClient` keeps `--allow-node-code --allow-private-net` (trusted
caller).

## Tests

| Suite | Covers |
|---|---|
| `tests/node/hardening/` (`test:hardening`, 189) | flags + matrix, `confinePath`, session names + storage, env builder (74), argv builder, URL classifier, ignored-config hint, real MCP server gating over stdio (no browser) |
| `tests/node/*.test.js` | incl. `stealth-ua-guard` (11), `restore-local-storage` (5), `firefox-engine-guard`, scaffold, config discovery |
| `tests/node/runtime/` (`test:runtime`) | launch, pool, clones (PC-1…6), resolve, Firefox |
| integration (`nav-guard.spec.js`, `config-mcp-roots.spec.js`, …) | browser layers of D7 in two postures (strict, and control with `--allow-private-net` so a broken fixture cannot pass); roots ignored / trusted |
| e2e | stealth health (rebrowser 9/10, `mainWorldExecution` known) |

`test:self` = lint → integration → `tests/node/*.test.js` → `test:runtime`
→ `test:hardening`; `test:auto` = e2e. Every test file is reached.

Proofs beyond pass/fail:

- mutation matrices: env builder (27 mutants, merged file kills every
  mutant either old file killed, plus `params: []`); stealth fixes (each of
  4 mutations caught only by its intended test);
- negative controls: unguarded UA plugin → 1 unhandled rejection, guarded 0;
  PC-5 / Firefox mock crashes reproduced with stand-in browser paths before
  the fix.

Rules:

- Security tests prove a key/path is **blocked**, by name, with dummy
  values (`'x'`); no working payloads; never spawn a child with hostile
  env. End-to-end attacks: the handout's manual live checklist.
- Never deep-compare or print `process.env`; compare key names.
- Tests check behaviour; they carry no design claims and do not drive
  architecture.
- A sandbox failure stopping at `BROWSER_NOT_FOUND` hides later defects:
  rerun with a stand-in `CHROMIUM_PATH=/bin/true` (fake `_launchImpl`
  tests) or on the host.

## Verification

Sandbox has no Chromium/Firefox; browser suites run on the host.

| Suite | Result |
|---|---|
| lint | clean |
| `tests/node/*.test.js` | host 144/144 |
| `test:hardening` | host 189/189 |
| `test:runtime` | host 257/263 before the PC-5 mock fix; PC-5 12/12 in sandbox after; host rerun result not recorded |
| integration | host 42 pass / 6 skip (environment-gated) |
| e2e | host 6/6 |

## Open

1. Record the host `test:self` result for `5e3e33f` / `v3.0.0` (first full
   run through `test:runtime` and `test:hardening`), and whether
   `release:publish` / `release:github` ran.
2. Rotate the GitHub token a failing env assertion printed in the sandbox
   (2026-10-24), if not done.
3. claude-docker side (below).

## claude-docker side (report back, 2026-10-24)

- Mount guard: project ⊇ path holds; **path ⊇ project failed**
  (one-directional); fix pending in the wrapper. Realpaths and full string
  scan of `mcp-hosts.json` hold.
- `@playwright/mcp` removed from the posture; must not return.
- `config/settings.json` deny list blocks `browser_run`,
  `browser_run_test`, `scaffold_init` (pre-hardening speed bump); it
  defeats the rollout goal. Decide at rollout: empty it, or keep
  `scaffold_init`.
- Blocked on the release: spec root, `mcp-hosts.json` flags, `check.sh`
  posture suite, chapter 7 docs, live checklist.

## Related

- [Companion proposal](./20261024-claude-docker-deployment-companion-proposal.md)
- [Companion handout](./20261024-claude-docker-companion-handout-proposal.md)
- [First host verification run](./20261024-hardening-verification-run.md)
- [Release notes 3.0.0](../releases/3.0.0.md)
