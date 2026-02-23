# Development Guide

## Upstream fork relationship

Szkrabok is a fork of [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp).

```
remote: upstream = https://github.com/microsoft/playwright-mcp.git
remote: origin   = git@github.com:PabloVitasso/szkrabok.git
```

Files prefixed `szkrabok_` are ours only and will never conflict with upstream.

---

## Merging upstream

```bash
git fetch upstream
git checkout -b merge-upstream-playwright-mcp
git merge upstream/main
```

### Known conflict zones

| File | Why | Resolution |
|---|---|---|
| `README.md` | Upstream owns it; we have a short szkrabok README | **Do not keep upstream content in README.md.** Move all new upstream content into `docs/playwright.md` and keep `README.md` as the short szkrabok overview. |
| `docs/playwright.md` | Does not exist — link to upstream GitHub instead | Nothing to merge |

### After resolving conflicts

1. Keep `README.md` as the short szkrabok overview — discard upstream README changes (see [../README.md](../README.md))
2. Upstream docs live at https://github.com/microsoft/playwright-mcp — no local copy to maintain
3. Update the version note at the top of `docs/playwright.md`
4. Commit with: `merge: upstream/main (0.0.X -> 0.0.Y)`

### playwright-core version bump during merge

If the merge updates `playwright` / `playwright-core` to a new version, the lib files
in `node_modules` must be cleanly replaced — npm caches packages and will NOT overwrite
modified files with just `npm install`.

```bash
rm -rf node_modules/playwright-core
npm install --ignore-scripts        # reinstall clean, skip postinstall
node scripts/patch-playwright.js    # re-apply our patches manually
```

Then restart the MCP server.

If `patch-playwright.js` fails after a playwright-core version bump, the search strings
in the relevant patch step need updating — see comments in the script for guidance.
Check `vendor/rebrowser-patches/patches/playwright-core/src.patch` for reference
on what the upstream logic looks like in TypeScript.

---

## Branch conventions

| Branch | Purpose |
|---|---|
| `main` | Stable, production |
| `upstream-playwright-mcp` | Szkrabok-specific refactoring before an upstream merge |
| `merge-upstream-playwright-mcp` | Active upstream merge in progress |

---

## Adding a szkrabok tool

1. Export `async function` from a file in `src/tools/`
   - Name the file `szkrabok_*.js` if it is szkrabok-specific
2. Register in `registry.js`: name, handler, description, inputSchema
3. Tool is auto-exposed via MCP — no other wiring needed

See [architecture.md](./architecture.md) for tool ownership map and szkrabok hacks to preserve.

---

## Restarting the MCP server

After editing source files: in Claude Code run `/mcp` → select **restart** for szkrabok. No `pkill` needed.
