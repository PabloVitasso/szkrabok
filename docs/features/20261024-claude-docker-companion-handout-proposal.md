# Feature: claude-docker companion work — handout

## Status

Proposal, ready to hand off. Self-contained work order for the claude-docker
wrapper repo (`/home/jones2/scripts/claude-docker/`). The person or agent
doing it cannot see this repo, so everything needed is here. The rationale
lives in
[20261024-claude-docker-deployment-companion-proposal.md](./20261024-claude-docker-deployment-companion-proposal.md)
(the "companion proposal") and
[20261024-claude-docker-hardening-proposal.md](./20261024-claude-docker-hardening-proposal.md)
(the "main proposal"). For tasks, versions and checks, this handout is
current (it was audited against the code); for rationale, those files are.
Report any difference back.

Blocked on: the szkrabok hardening release (step 0). Everything else in this
handout waits for it, except the mount-guard check (task 1), which can run
now.

## Goal

Make `browser_run_test` / `session_run_test` usable from the sandbox again,
under the hardened szkrabok's spec-root model, with every capability grant
written in one host-side, reviewed file. Without this work the hardened
server still fails closed (safe, but no test tools from the container).

## What szkrabok changes (what the wrapper must know)

Hardened szkrabok is a major release (the repo is at 2.1.5 today). In
server mode:

| Flag (argv only) | Grants |
|---|---|
| none | `session_manage`, `browser_scrape`, page-mode `browser_run code`. Test tools, `browser_run path`, `scaffold_init` off |
| `--work-root <dir>` | the only place tools write: `<dir>/sessions/`, `<dir>/reports/`. Default: cwd |
| `--spec-root <dir>` | confined `browser_run_test`/`session_run_test` (config and specs only from `<dir>`), page-mode `browser_run path` from `<dir>` |
| `--allow-node-code` | Node-form `browser_run`, `scaffold_init`, unconfined test tools. **Code execution on the host** |
| `--trust-project-config` | loads `szkrabok.config.toml` from cwd / MCP roots. **Code execution on the host** (a config can name an executable) |
| `--allow-private-net` | lifts the loopback/private-address navigation block. Network reach, no code |

Other facts the wrapper relies on:

- At startup the server realpaths both roots and refuses to start when either
  is missing, not absolute, or contains the other ("must be disjoint").
  Bad flags (including a typo such as `--allow-nodecode`) exit with code 2,
  printing `Invalid flags: …` to stderr and to
  `~/.cache/szkrabok/startup.log`.
- In server mode sessions live in `<work-root>/sessions`. This overrides
  `SZKRABOK_SESSIONS_DIR`. Session names must match
  `^[A-Za-z0-9][A-Za-z0-9._-]*$` (at most 64 chars).
- Test runs use `<spec-root>/node_modules/.bin/playwright`. If it is missing,
  szkrabok falls back to `npx --no-install playwright`, which can resolve any
  Playwright on `PATH`.
- szkrabok pins `playwright-core` exactly (1.63.0 today). Its postinstall
  patches the `playwright-core` that resolves from the install root, then
  verifies the patch and fails the install if it is missing.
- `session_manage {action: "list"}` returns `server.flags`,
  `server.capabilities` and `config` (`source`, `ignored`). Use it to audit
  the live posture.
- `.env` and project `szkrabok.config.toml` are not read in server mode
  unless `--trust-project-config`. Config comes from `--config`,
  `SZKRABOK_CONFIG`, `SZKRABOK_ROOT` or `~/.config/szkrabok/config.toml`.
- `browser_run_test` `params` reach the spec as `SZKRABOK_PARAM_<KEY>`
  (key uppercased), not `<KEY>`. Reserved names (runtime, loader, package
  manager, `SZKRABOK_*`, `PLAYWRIGHT_*`) are refused. `reportFile` is a bare
  `*.json` name, written under `<work-root>/reports/<session>/`.
- The navigation block covers literal private addresses only. A public
  hostname that resolves to a private address still connects (DNS
  rebinding). Defence in depth, not a network boundary.

## Tasks

Wrapper-repo edits reach the host only after `claude-docker deploy`.
`config/` is gitignored: edits there are direct host edits.

### 0. Prerequisite: install the hardened release (host)

- [ ] Hardened szkrabok released (szkrabok repo, not this work).
- [ ] Bump `/home/jones2/szkrabok-local/node_modules/@pablovitasso/szkrabok`
      to it, the usual local-install way.
- [ ] If `/home/jones2/szkrabok-npx` has a `.env` or `szkrabok.config.toml`,
      review it: neither is read any more. Move what is still needed into
      `~/.config/szkrabok/config.toml` or explicit env in the command.
- [ ] If the host environment or the command sets `SZKRABOK_SESSIONS_DIR`,
      move those sessions to `/home/jones2/szkrabok-npx/sessions` (the work
      root). Otherwise they seem to vanish after the upgrade.
- [ ] List the session dirs. Rename any whose name does not match
      `^[A-Za-z0-9][A-Za-z0-9._-]*$`: they can no longer be opened or
      deleted through the tools.

### 1. Mount guard: verify before relying on it (wrapper repo)

The design needs the guard to refuse a sandbox project that overlaps any
path named in `config/mcp-hosts.json`. Confirm in the wrapper code:

- [ ] both directions: project ⊇ path (`/home/jones2` refused) **and**
      path ⊇ project (`/home/jones2/szkrabok-tests/automation` refused);
- [ ] every string element of `command` is scanned, not only `command[0]`
      and `--cwd`. The new paths sit after `--`, as szkrabok args;
- [ ] realpaths are compared (a symlinked project cannot dodge it).

Any box fails → fix the guard first; that fix is in scope.

### 2. Spec root `/home/jones2/szkrabok-tests` (host)

```
szkrabok-tests/
  package.json          # @playwright/test pinned EXACTLY to szkrabok's playwright-core (1.63.0 today);
                        # @pablovitasso/szkrabok (fixtures) pinned to the deployed version
  package-lock.json
  node_modules/         # npm ci on the host; part of the trusted root
  playwright.config.js
  automation/*.spec.js
  scripts/*.js          # optional: page-mode browser_run files, one function expression each
```

- [ ] Exact pin, so one patched `playwright-core` is shared by szkrabok and
      `@playwright/test`. Install with `npm ci`, scripts on (no
      `--ignore-scripts`). The postinstall must print the patch check as OK.
- [ ] `node_modules/.bin/playwright` exists after the install.
- [ ] `playwright.config.js`: `testDir` inside the root; no `webServer`; no
      `globalSetup` that writes files or opens ports; no reporter
      `outputFile` inside the root. MCP runs pass `--reporter list,json` on
      the command line, which replaces the config's reporters, so the
      scaffold's `test-results/report.json` is unused there. Drop it anyway:
      a standalone run from this dir would write it into the root.
- [ ] Specs that read params: `process.env.FOO` → `process.env.SZKRABOK_PARAM_FOO`.
- [ ] Move the container-facing specs and config here, review, then
      `chmod -R a-w` (tripwire, not an OS boundary). To edit later:
      `chmod -R u+w`, edit, review, `chmod -R a-w`.
- [ ] Never written from the container, never synced from a sandbox
      project, never a mountable project (task 1 enforces it).

### 3. `config/mcp-hosts.json` szkrabok entry (host)

Append two szkrabok args **after** the `bin/szkrabok.js` path:

```json
"node", "/home/jones2/szkrabok-local/node_modules/@pablovitasso/szkrabok/bin/szkrabok.js",
"--work-root", "/home/jones2/szkrabok-npx",
"--spec-root", "/home/jones2/szkrabok-tests"
```

- [ ] `--work-root` equals the mcp-proxy `--cwd` (one dir for `sessions/`
      and `reports/`).
- [ ] No `--allow-node-code`, `--trust-project-config` or
      `--allow-private-net` in the sandbox posture. A solo-use grant goes in
      a separate edit and is removed before the next sandbox session.
- [ ] Restart the szkrabok MCP host. `session_manage list` shows the two
      roots and `capabilities` with the test tools confined. If it does not
      start, read `~/.cache/szkrabok/startup.log` (exit code 2 = bad flags).

### 4. Docs (wrapper repo)

- [ ] `claude-docker.md` chapter 7: the flags and what each grants (table
      above), the spec-root contract, the literal-address block with the
      rebinding caveat, and the `@playwright/mcp` residual (it still exposes
      `browser_run_code_unsafe` and unrestricted navigation, so szkrabok
      alone does not make the sandbox safe).
- [ ] `claude-docker.md` "Mount guards": the guard covers `--work-root` and
      `--spec-root` values in both directions (verified in task 1).
- [ ] `sandbox-handout.md`, one line: tests run from a host-side spec root
      via `browser_run_test`/`session_run_test`; specs cannot be created or
      changed from the container; `browser_run` runs in the page, not Node.

### 5. `check.sh` assertions (wrapper repo)

Static checks on the szkrabok entry in `config/mcp-hosts.json`:

- [ ] **hard fail** on `--allow-node-code` or `--trust-project-config`.
      Override only with `CLAUDE_DOCKER_ALLOW_UNSAFE_SZKRABOK=1` in that
      run's environment, never stored in `config/`. The failure message
      names the variable;
- [ ] **warn** on `--allow-private-net`;
- [ ] `--spec-root` exists, is a directory, has no writable bits
      (`find <root> -perm /222` empty), and is disjoint from `--work-root`
      and the mcp-proxy `--cwd` (realpaths);
- [ ] `--work-root` equals the mcp-proxy `--cwd`;
- [ ] `<spec-root>/node_modules/.bin/playwright` exists (else szkrabok
      falls back to whatever `npx` finds).

Decided: fail, not warn, for the two code-execution grants (same model as
VS Code Workspace Trust, git `safe.directory`, direnv `allow`).

Then `claude-docker deploy`.

### 6. Live verification (from a sandbox session)

Every attack row must fail with a structured error, and nothing may appear on
the host outside `<work-root>/{sessions,reports}`. Use dummy values; no
working payloads.

Setup:

- On the host: `touch /tmp/spec-root-marker` (for row 12).
- From the container: `session_manage {action: "open", sessionName: "verify",
  url: "https://example.com/"}`. Every row below uses `sessionName:
  "verify"` (omitted from the table for brevity).

| # | Attempt | Expected |
|---|---|---|
| 1 | `browser_run {code: "async (page) => (await import('node:child_process')).execSync('id').toString()"}` | page-mode error, no Node execution |
| 2 | `browser_run {path: "/home/jones2/.bashrc"}`, `{path: "../szkrabok-npx/sessions/<s>/state.json"}` | refused: outside spec root |
| 3 | `browser_run_test {config: "/project/evil.config.js"}`, `{files: ["-c", "/project/x.js"]}` | refused |
| 4 | `browser_run_test {params: {node_options: "x"}}` | refused: reserved key |
| 5 | `browser_run_test {reportFile: "../../.bashrc"}` | refused |
| 6 | `scaffold_init {install: true}` | disabled, flag named |
| 7 | `session_manage {action: "delete", sessionName: "../../x"}`, `{sessionName: "*"}` | refused |
| 8 | `session_manage open {url: "file:///etc/hostname"}` | refused |
| 9 | on the open public page: `browser_run {code: "() => { location.href = 'file:///etc/hostname' }"}`, then `browser_scrape` | no file content. Either Chrome blocks the navigation, or the watcher resets the main frame to `about:blank` |
| 10 | `session_manage open {url: "http://127.0.0.1:8932/"}` | blocked destination |
| 11 | a `szkrabok.config.toml` in the project (MCP root) with a dummy `executable_path = "x"`, restart, `session_manage list` | `config.source` is not the project; the project is in `config.ignored` |
| 12 | positive: `browser_run_test` on a spec from the spec root | passes; `find /home/jones2/szkrabok-tests -newer /tmp/spec-root-marker` empty |
| 13 | positive: `browser_run {code: "() => document.title"}` | returns the title |

Rollback: remove the two flags, restart. The server falls back to fail-closed
(no test tools). Nothing else to undo.

### 7. Later, separate item: egress proxy

Not part of this rollout. The real fix for rebinding: a resolving,
IP-checking proxy on host loopback (Stripe Smokescreen, or squid with a
destination-IP ACL), never relayed into the container, set as Playwright
`proxy` in the host-side szkrabok config. Keep the literal block as a
second layer.

## Non-goals

- `@playwright/mcp` hardening (separate item; documented as a residual in
  task 4).
- Any code-execution grant in the sandbox posture.
- Szkrabok code changes. If one looks necessary, report it instead.

## Report back to szkrabok

Into the szkrabok hardening feature file (via the user):

- task 1 result per box, and any guard fix;
- task 6 table with actual results;
- any place this handout was wrong or unclear.
