# Config Meta Exposure in MCP Tools
## Feature (Proposal — 2026-04-21)

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

Workaround applied: `bash -c "cd /path/to/project && npx -y @pablovitasso/szkrabok"`. This
works but:
- hard-codes a single project path in a user-level entry (breaks multi-project setups)
- hides the real question: **are MCP roots being sent by Claude Code to user-level MCP servers?**

If MCP roots (step 3) worked correctly, the CWD workaround would be unnecessary — the server
would find the config regardless of where it was started from.

### Why we can't diagnose this today

`getConfigMeta()` exists in `packages/runtime/config.js` and returns
`{ phase, source, previousSource }`. The `source` string is exactly what we need
(e.g. `"mcp-root (/home/jones2/mega/research/szkrabok)"` vs `"cwd (/usr/local)"` vs
`"none (no config file found — using built-in defaults)"`).

But none of the MCP tools expose it. The user has to guess.

---

## Goal

Expose `configMeta` in `session_manage` tool responses so any MCP client can see which config
source was used without access to server logs.

---

## Scope

Two actions in `session_manage`:

### `list`

Add a top-level `config` field alongside the existing `server` field:

```json
{
  "sessions": [...],
  "server": { "version": "2.0.10", "source": "..." },
  "config": {
    "phase": "final",
    "source": "mcp-root (/home/jones2/mega/research/szkrabok)",
    "previousSource": "cwd (/usr/local/bin)"
  }
}
```

### `open`

Add `configSource` to the success response (the `source` string only — enough for a quick
sanity check after opening a session):

```json
{
  "success": true,
  "sessionName": "dev",
  "preset": "chromium-honest",
  "label": "Ungoogled Chromium",
  "configSource": "mcp-root (/home/jones2/mega/research/szkrabok)"
}
```

---

## What this enables

1. **Immediate diagnosis**: call `session_manage { action: "list" }` from any external Claude
   Code instance → see at a glance if the user-level server is picking up the right config.

2. **Confirm the roots question**: without the `cd` workaround, if `source` says `mcp-root`
   → MCP roots work and the workaround can be removed. If `source` says `cwd` or `none` →
   roots are not being sent by the client to user-level servers → needs a different fix.

3. **Ongoing debuggability**: misconfigured presets, wrong browser, unexpected defaults — all
   diagnosable from the tool response without touching logs.

---

## Implementation

Files to change:

- `src/tools/szkrabok_session.js` — `list()`: add `config: getConfigMeta()` to return value.
  `open()`: add `configSource: getConfigMeta()?.source` to both template and reuse return paths.
- `src/config.js` — re-export `getConfigMeta` from `#runtime` if not already (it is).

No schema changes needed — MCP tool descriptions are prose, not typed. No new exports required.
`getConfigMeta()` is already part of the runtime public API.

---

## Out of scope

- Fixing the root cause (if MCP roots don't reach user-level servers, that is a Claude Code
  client issue or requires a different mitigation like `SZKRABOK_ROOT` env var guidance).
- Adding config meta to other tools (`browser_run`, `browser_scrape`, etc.) — `session_manage`
  is the natural diagnostic entry point.
- Structured `source` object (deferred in the determinism refactor, §3) — keep it as a string.
