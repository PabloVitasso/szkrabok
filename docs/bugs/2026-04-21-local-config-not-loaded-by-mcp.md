# Bug: szkrabok.config.local.toml not loaded when MCP runs via npx

**Date:** 2026-04-21  
**Reporter:** Pablo Vitasso  
**szkrabok version:** 2.0.9  
**Environment:** Linux jones2-VirtualBox 6.11.0-19-generic (Ubuntu 24.04), Node v20.20.0

---

## Summary

When szkrabok MCP server is installed globally via `npx -y @pablovitasso/szkrabok`, the `szkrabok.config.local.toml` file is NOT loaded. As a result, the `executablePath` setting defined in that file is ignored and the browser cannot be found.

---

## Environment Details

| Item | Value |
|------|-------|
| OS | Ubuntu 24.04, kernel 6.11.0-19-generic |
| Node | v20.20.0 |
| szkrabok | 2.0.9 |
| MCP install method | `npx -y @pablovitasso/szkrabok` (global, via Claude MCP) |
| Config file location | `/home/jones2/mega/research/szkrabok/szkrabok.config.local.toml` |
| Claude project | `/home/jones2/mega/research/estate/` |
| Browser | `/usr/bin/ungoogled-chromium` (exists, confirmed) |

---

## Steps to Reproduce

1. Install szkrabok MCP globally:
   ```
   claude mcp add szkrabok -- npx -y @pablovitasso/szkrabok
   ```
2. Verify `szkrabok.config.local.toml` exists at `/home/jones2/mega/research/szkrabok/` with:
   ```toml
   [default]
   executablePath = "/usr/bin/ungoogled-chromium"
   ```
3. Confirm the browser exists:
   ```
   $ ls /usr/bin/ungoogled-chromium
   /usr/bin/ungoogled-chromium
   ```
4. In Claude Code (in any project), call:
   ```
   mcp__szkrabok__session_manage { "action": "open", "sessionName": "test", "url": "http://localhost:3000" }
   ```

---

## Actual Result

```json
{
  "code": "BROWSER_NOT_FOUND",
  "message": "Chromium not found.\n\nOptions (choose one):\n  1. szkrabok doctor install\n  2. export CHROMIUM_PATH=/usr/bin/google-chrome\n  3. Set executablePath in szkrabok.config.toml\n\nCandidates checked:\n  env          (not set) — not set\n  config       (not set) — not set\n  playwright   /home/jones2/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome — file not found\n  system       (not set) — not set"
}
```

Note: `config (not set)` — the local config file is not being read at all.

---

## Expected Result

The MCP server should load `szkrabok.config.local.toml` and resolve `executablePath = "/usr/bin/ungoogled-chromium"`, reporting:

```
config   /usr/bin/ungoogled-chromium — ok
```

---

## Root Cause Hypothesis

When running via `npx -y @pablovitasso/szkrabok`, the process working directory is likely a temp/cache directory (e.g. `~/.cache/szkrabok/` or the npx cache), not the directory where the user's `szkrabok.config.local.toml` lives.

The config loader probably resolves `szkrabok.config.local.toml` relative to `process.cwd()` or `__dirname` — neither of which points to the project repo when installed via npx.

Confirmed by `claude mcp list`:
```
szkrabok: npx -y @pablovitasso/szkrabok - ✓ Connected
```
No working directory specified.

---

## Workaround Attempted

Setting `CHROMIUM_PATH=/usr/bin/ungoogled-chromium` via env var in shell — does NOT propagate to the MCP server process started by Claude Code.

---

## Suggested Fix

One or more of:
1. **Env var support at launch:** Respect `CHROMIUM_PATH` env var passed in the MCP server's launch environment (Claude Code can pass env vars via MCP server config).
2. **Config search path:** Search for `szkrabok.config.local.toml` in a list of known locations: `$HOME/.config/szkrabok/`, `$HOME/`, and the directory specified in an env var like `SZKRABOK_CONFIG_DIR`.
3. **MCP server working directory:** Allow specifying `--config /path/to/szkrabok.config.local.toml` as a CLI argument to the MCP server.
4. **Claude MCP config:** Support passing env vars in the MCP server definition so users can set `CHROMIUM_PATH` there.
