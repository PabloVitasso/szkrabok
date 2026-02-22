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

---

## Branch conventions

| Branch | Purpose |
|---|---|
| `main` | Stable, production |
| `upstream-playwright-mcp` | Szkrabok-specific refactoring before an upstream merge |
| `merge-upstream-playwright-mcp` | Active upstream merge in progress |

---

## Adding a szkrabok tool

1. Export `async function` from a file in `szkrabok.playwright.mcp.stealth/src/tools/`
   - Name the file `szkrabok_*.js` if it is szkrabok-specific
2. Register in `registry.js`: name, handler, description, inputSchema
3. Tool is auto-exposed via MCP — no other wiring needed

See [architecture.md](./architecture.md) for tool ownership map and szkrabok hacks to preserve.

---

## Restarting the MCP server

After editing source files: in Claude Code run `/mcp` → select **restart** for szkrabok. No `pkill` needed.
