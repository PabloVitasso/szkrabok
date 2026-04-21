# Config Meta Exposure in MCP Tools
## Feature (Done — 2026-04-21)

Implemented in: `src/tools/szkrabok_session.js`, `packages/runtime/config.js`,
`src/cli/commands/doctor.js`.

---

## Problem

Szkrabok's config discovery has 6 fallback steps (explicit path → env var → MCP roots → CWD →
XDG → defaults). When something goes wrong — e.g. browser launches unconfigured, wrong preset
is used, wrong profile directory — there is no way to tell from outside the process which step
was actually used.

### Concrete incident

User-level MCP config used `npx -y @pablovitasso/szkrabok` without setting CWD. Discovery
step 4 (CWD) resolved to Claude Code's working directory, not the user's project. The file
`szkrabok.config.local.toml` was invisible. Browser launched with built-in defaults instead of
the configured preset.

Follow-up finding: MCP roots (step 3) do not reach user-level MCP servers in Claude Code —
confirmed by `config.source: "none"` when testing from the estate project with no `cd` workaround.

---

## What was implemented

### `session_manage list`

Added top-level `config` and updated `server`:

```json
{
  "sessions": [...],
  "server": {
    "version": "2.0.12",
    "source": "/home/jones2/.nvm/.../bin/szkrabok",
    "sourceGuess": "global-npm"
  },
  "config": {
    "phase": "final",
    "source": "none (no config file found — using built-in defaults)",
    "previousSource": null,
    "searched": [
      { "step": "env:SZKRABOK_CONFIG", "paths": ["/abs/path.toml"], "found": false },
      { "step": "mcp-root", "paths": ["/project/szkrabok.config.toml", "/project/szkrabok.config.local.toml"], "found": false },
      { "step": "cwd", "paths": ["/usr/local/szkrabok.config.toml", "/usr/local/szkrabok.config.local.toml"], "found": false },
      { "step": "xdg", "paths": ["/home/jones2/.config/szkrabok/config.toml", "/home/jones2/.config/szkrabok/config.local.toml"], "found": false }
    ]
  }
}
```

`server.sourceGuess` — best-effort heuristic from `process.argv[1]`:
- `"npx-cache"` — path contains `/_npx/`
- `"local-dev"` — path ends with `/src/index.js`
- `"global-npm"` — path contains nvm/volta/fnm/AppData patterns or `/bin/szkrabok`
- `"unknown"` — none of the above matched

Cross-platform: normalizes backslashes before matching.

### `session_manage open`

Added `configSource` (the `source` string) to all success return paths — template launch,
reuse, and clone.

### `packages/runtime/config.js` — `_discover()`

Collects a `searched` array during discovery: one entry per step actually attempted, with the
exact file paths checked and a boolean `found`. Stored in `_configMeta` and returned by
`getConfigMeta()`. Uses spread accumulation (no `.push` — lint rule).

Note: for MCP roots, only the first hit is walked; subsequent roots that were not checked
show `found: false`.

### `szkrabok doctor`

Added "Config discovery" section (step 5 in the output) after browser resolution. Prints
`source` and one line per searched step showing paths and `[PASS]`/`[ABSENT]` status.
`initConfig` is already called by `runDetect()` so `getConfigMeta()` is available immediately.

---

## Out of scope (unchanged)

- Root cause of MCP roots not reaching user-level servers — Claude Code client behavior.
- Structured `source` object (deferred in the determinism refactor, §3) — kept as string.
- Config meta in other tools (`browser_run`, `browser_scrape`) — `session_manage` is enough.
