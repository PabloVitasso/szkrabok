# Feature: claude-docker deployment companion — host-side wiring for the hardening

## Status

Proposal. Companion to
[20261024-claude-docker-hardening-proposal.md](./20261024-claude-docker-hardening-proposal.md).
Read that first: it defines the flags (D1 capability matrix) and the trust
model. The actionable work order for the wrapper repo is
[20261024-claude-docker-companion-handout-proposal.md](./20261024-claude-docker-companion-handout-proposal.md). Nothing here is needed for safety, because the hardened server fails
closed with the current host config. This document is the opt-in that brings
test tooling back.

Pass 2 (2026-10-23): aligned with the main proposal's fixed gating
(`--spec-root` alone enables confined tests; `--allow-node-code` is not
needed), added the spec-root layout and permissions, made the mount-guard
assumption an explicit check, replaced the vague `check.sh` item with concrete
assertions, and turned "the four attack chains" into a checklist.

## Goal

Wire the hardened szkrabok into the claude-docker deployment so that
`browser_run_test` / `session_run_test` work from the container again, under
the spec-root model, with every capability grant visible in one reviewed file.

Changes target `/home/jones2/scripts/claude-docker/` (the wrapper repo and its
gitignored `config/`) plus two host directories. Wrapper-repo edits reach the
host via `claude-docker deploy`. Szkrabok code does not change here.

## Why the counterpart exists at all

1. Capability flags live in argv. `config/mcp-hosts.json` is the only place the
   launch command is written. It is host-side and reviewed at deploy, which is
   the property D1 relies on.
2. The spec root is a deployment decision: a host directory that no szkrabok
   tool or Playwright run writes into, and that is never a mountable project.
3. `claude-docker.md` chapter 7 documents the MCP host commands. The flags
   change what those commands mean, and the house rule is to update the doc
   when behaviour changes.

## Changes

### 1. `config/mcp-hosts.json`: the szkrabok entry

Current:

```json
"szkrabok": {
  "port": 8932,
  "command": [
    "uvx", "mcp-proxy",
    "--transport", "streamablehttp",
    "--port", "8932", "--host", "127.0.0.1",
    "--cwd", "/home/jones2/szkrabok-npx",
    "--",
    "node", "/home/jones2/szkrabok-local/node_modules/@pablovitasso/szkrabok/bin/szkrabok.js"
  ]
}
```

Target:

```json
"szkrabok": {
  "port": 8932,
  "command": [
    "uvx", "mcp-proxy",
    "--transport", "streamablehttp",
    "--port", "8932", "--host", "127.0.0.1",
    "--cwd", "/home/jones2/szkrabok-npx",
    "--",
    "node", "/home/jones2/szkrabok-local/node_modules/@pablovitasso/szkrabok/bin/szkrabok.js",
    "--work-root", "/home/jones2/szkrabok-npx",
    "--spec-root", "/home/jones2/szkrabok-tests"
  ]
}
```

Resulting posture (main proposal D1 matrix, `--spec-root` column):
page-sandbox `browser_run`, `browser_run path` from the spec root only,
confined test tools, `scaffold_init` off, loopback/private destinations
blocked.

Rules:

- **No `--allow-node-code`, no `--allow-private-net`, no
  `--trust-project-config`** in the sandbox posture. The last one would
  load `szkrabok.config.toml` from the container's project (MCP roots),
  which is the #8 hijack. Either is a deliberate solo-use grant. Add it in a separate entry
  or edit, and remove it before the next sandbox session.
- The flags go **after** the `bin/szkrabok.js` path, because they are
  szkrabok argv, not mcp-proxy argv. The first one starts with `--`, which
  keeps `src/index.js` in server mode.
- `--work-root` matches the mcp-proxy `--cwd` on purpose: one directory holds
  `sessions/` and `reports/`. Once the hardening lands, the server checks at
  startup that the two roots are disjoint.
- The pinned install path stays. Bumping
  `szkrabok-local/node_modules/@pablovitasso/szkrabok` to the hardened
  release (a major bump, since it is breaking in server mode) is a
  prerequisite, done the usual local-install way.
- If `/home/jones2/szkrabok-npx` holds a `.env` or `szkrabok.config.toml`
  today, review it. Under the hardening neither is read in server mode
  (D8/E5). Move anything still needed into `~/.config/szkrabok/config.toml` or
  into explicit env in the command.

### 2. The spec root: `/home/jones2/szkrabok-tests`

Layout (host-side, reviewed):

```
szkrabok-tests/
  package.json          # @playwright/test pinned EXACTLY to szkrabok's playwright-core,
                        # @pablovitasso/szkrabok (fixtures) pinned to the deployed version
  package-lock.json
  node_modules/         # installed on the host; part of the trusted root
  playwright.config.js
  automation/*.spec.js
  scripts/*.js          # optional: page-mode browser_run files (one function expression each)
```

`playwright.config.js` requirements, on top of what szkrabok forces via argv
(D6: `--output`, `--update-snapshots=none`):

- no `outputFile` for reporters that points inside the spec root. The
  scaffold template writes `test-results/report.json` relative to the config,
  so drop it. szkrabok's JSON report already goes to
  `<work-root>/reports/<session>/`;
- no `webServer`, no `globalSetup` that writes files or opens ports;
- `testDir` inside the spec root.

Permissions:

- Owned by `jones2`, mode `a-w` on everything (`chmod -R a-w`) as a tripwire.
  szkrabok runs as the owner, so this is not an OS boundary, but it makes any
  accidental write by szkrabok or Playwright fail loudly instead of silently
  planting code. To edit: `chmod -R u+w`, edit, review, `chmod -R a-w`.
- Spec changes reach the root the same way wrapper changes reach the host:
  review, then write on the host. Never through the container. No sync from a
  sandbox project.

Contract (main proposal D6): no szkrabok tool or Playwright run writes into
it, the container cannot write into it, and it is never the project dir of a
sandbox run (or inside one, or containing one).

### 3. Mount guard: verify, then document

The design relies on the wrapper's guard refusing a sandbox project that
overlaps any path named in `mcp-hosts.json`. This tree cannot see the wrapper
code, so before relying on it, confirm in the wrapper repo:

- [ ] the guard checks **both** directions: project ⊇ path (mounting
      `/home/jones2` is refused) **and** path ⊇ project (mounting
      `/home/jones2/szkrabok-tests/automation` is refused);
- [ ] it scans every string element of `command`, not only `command[0]` and
      `--cwd` values. The new paths sit after `--` as szkrabok args;
- [ ] it compares realpaths, so a symlinked project path cannot dodge it.

If any box fails, fix it in the wrapper **before** step 3 of the order of
work. In that case "Wrapper logic changes" moves out of non-goals.

### 4. Docs in the wrapper repo

- `claude-docker.md` chapter 7 ("MCP scope" / "How the browser servers cross
  the boundary"): the szkrabok flags and what each grants (copy the D1 matrix
  row for the chosen posture), the spec-root contract, and that the browser
  cannot reach literal host loopback/private addresses without
  `--allow-private-net`. Say that this is defence in depth, not a network
  boundary: a public hostname that resolves to a private address (DNS
  rebinding) still connects. Section 6 is the planned fix.
- `claude-docker.md` "Mount guards": state that the guard covers the
  `--work-root` and `--spec-root` values, in both directions. That is now
  verified (section 3), so future edits will not rely on an accident.
- `sandbox-handout.md`, one line: tests run from a host-side spec root via
  `browser_run_test`/`session_run_test`, specs cannot be created or changed
  from inside the container, and `browser_run` runs in the page, not in Node.
- `README.md` file table unchanged. The two md files above are already listed.

### 5. `check.sh` assertions (optional)

Static checks on the deployed `config/mcp-hosts.json` szkrabok entry, in the
same style as the deploy gate:

- **hard fail** if the command contains `--allow-node-code` or
  `--trust-project-config`. Both let the container run code on the host
  (directly, or through a project config that names an executable). Override
  only with an explicit `CLAUDE_DOCKER_ALLOW_UNSAFE_SZKRABOK=1` in the
  environment of that `check.sh` run; the failure message names the variable.
  The override is per run, never stored in `config/`;
- **warn** if it contains `--allow-private-net` (wider network reach, no code
  execution);
- if `--spec-root` is present, the path exists, is a directory, has no
  writable bits (`find <root> -perm /222` is empty), and is disjoint from
  `--work-root` and from the mcp-proxy `--cwd` realpaths;
- `--work-root` equals the mcp-proxy `--cwd`.

The live state (which tools are on) comes from `session_manage list` →
`server.flags` once the hardening ships. `claude-docker mcp status` can print
that instead of re-deriving it.

Decided 2026-10-24 (main proposal, open questions): fail, not warn, for the
two code-execution grants. Rationale: tools that load code from a workspace
refuse by default and need a named opt-in: VS Code Workspace Trust
(restricted mode), git `safe.directory`, direnv `allow`. A warning in a
check script gets scrolled past; a solo posture stays possible through the
override. `--allow-private-net` widens reach but runs nothing, so it stays a
warning.

### 6. Egress control (planned, not part of this rollout)

The hardened server blocks literal loopback/private destinations only (main
proposal D7, open question 3). A hostname that resolves to a private address
still connects, because Chrome resolves it after the check. The standard fix
(OWASP SSRF cheat sheet) is to check the address after resolution, at
connection time, which for a browser means an egress proxy:

- Run a resolving, IP-checking proxy on the host: Stripe's Smokescreen
  (denies private/loopback/link-local ranges by default) or squid with a
  destination-IP ACL. It must listen on host loopback only and never be
  relayed into the container.
- Point the szkrabok browser at it via Playwright's `proxy` launch option
  (`--proxy-server`), set in the host-side szkrabok config (not reachable from
  tool arguments, invariant 10).
- Keep the literal block as a second layer.

Not built yet; tracked here so chapter 7 can point at it.

## Order of work

1. Szkrabok hardening lands, is released (major), and is installed into
   `szkrabok-local` (main proposal phases 1-3).
2. Mount-guard verification (section 3). Fix the wrapper if needed.
3. Create `/home/jones2/szkrabok-tests` with the layout above, `npm ci` on the
   host, move the container-facing specs and config there, review, then
   `chmod -R a-w`.
4. Edit `config/mcp-hosts.json` as above. `config/` is gitignored, so this is
   a direct host edit, not a deploy. Restart the szkrabok MCP host.
5. Doc updates in the wrapper repo (+ optional `check.sh`), then
   `claude-docker deploy`.
6. Live verification from the container (checklist below).

Rollback: remove the two flags from `mcp-hosts.json` and restart. The server
falls back to the fail-closed default (no test tools). Nothing else needs
undoing.

## Live verification checklist

Superseded by the audited version (with setup steps) in the
[handout](./20261024-claude-docker-companion-handout-proposal.md), task 6.

Run from a sandbox session after step 5. Every attack row must fail with a
structured error, and nothing may appear on the host outside
`<work-root>/{sessions,reports}`.

| # | Attempt | Expected |
|---|---|---|
| 1 | `browser_run {code: "async (page) => (await import('node:child_process')).execSync('id').toString()"}` | page-mode error, no Node execution |
| 2 | `browser_run {path: "/home/jones2/.bashrc"}` and `{path: "../szkrabok-npx/sessions/<s>/state.json"}` | refused: outside spec root |
| 3 | `browser_run_test {config: "/project/evil.config.js"}`, `{files: ["-c", "/project/x.js"]}` | refused |
| 4 | `browser_run_test {params: {node_options: "x"}}` | refused: reserved key |
| 5 | `browser_run_test {reportFile: "../../.bashrc"}` | refused |
| 6 | `scaffold_init {install: true}` | disabled, flag named |
| 7 | `session_manage {action: "delete", sessionName: "../../x"}`, `{sessionName: "*"}` | refused |
| 8 | `session_manage open {url: "file:///etc/hostname"}`, then `browser_scrape` | refused at open; scrape refuses too |
| 9 | on a public page: `browser_run {code: "() => { location.href = 'file:///etc/hostname' }"}`, then `browser_scrape` | no file content: Chrome blocks it, or the watcher resets the main frame to `about:blank` |
| 10 | `session_manage open {url: "http://127.0.0.1:8932/"}` and `http://localhost:<cdpPort>/json/list` | blocked destination |
| 11 | plant `szkrabok.config.toml` with `executable_path = "/bin/touch"`-style payload in the project (MCP root), restart, `session_manage list` | `config.source` is not the project; the project is listed in `config.ignored`; payload not run |
| 12 | positive: `browser_run_test` on a spec from the spec root | passes; spec root unchanged (`find <spec-root> -newer <marker>` empty) |
| 13 | positive: page-mode `browser_run {code: "() => document.title"}` | returns the title |

## Non-goals

- Wrapper logic changes, **provided section 3 passes**. The mount guard and
  the relay already cover the new flags.
- `@playwright/mcp` (the other host browser server). It shares the threat
  model (`browser_run_code_unsafe`, unrestricted navigation) and is a separate
  work item, which nothing here depends on. Until that item lands, the
  hardened szkrabok does not make the sandbox safe on its own, because the
  container can still reach the same host capabilities through
  `@playwright/mcp`. Say so in chapter 7. **Update (report back,
  2026-10-24):** the claude-docker side removed `@playwright/mcp` from the
  sandbox posture entirely; the residual is gone and chapter 7 says "removed;
  do not re-add".
- Any grant of `--allow-node-code`, `--allow-private-net` or
  `--trust-project-config` in the sandbox posture.

## Open questions

1. Spec root location: `/home/jones2/szkrabok-tests`, or a `tests/` subdir of
   `szkrabok-npx`? Decided by the main proposal: the roots must be disjoint
   (startup check), so it has to be a separate top-level dir.
2. Shared fixtures: should the spec root also serve standalone (non-MCP)
   Playwright runs on the host? It can, if those runs also use
   `--output`/`--update-snapshots=none` or run from a writable copy. Otherwise
   duplicate. This affects layout only, not the contract.
3. Should the `@playwright/mcp` hardening block this rollout, given non-goal
   2? Proposal: no. Ship this, and track the residual in chapter 7.
   Resolved: `@playwright/mcp` is removed from the sandbox posture.
