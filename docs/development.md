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
| ---- | --- | ---------- |
| `README.md` | Upstream owns it; we have a short szkrabok README | Discard upstream content. Keep our README. |
| `src/upstream/wrapper.js` | We stripped browser-launch code; upstream may re-add it | Keep our version — launch lives in `packages/runtime/launch.js` |
| `Dockerfile` | Upstream Docker setup; szkrabok does not use it | Handled by `.gitattributes` (`merge=ours`). No action needed. |

### After resolving conflicts

1. Keep `README.md` as the short szkrabok overview — discard upstream README changes
2. Run `node scripts/patch-playwright.js` if `playwright-core` version changed
3. Commit with: `merge: upstream/main (0.0.X -> 0.0.Y)`

### playwright-core version bump during merge

npm caches packages and will NOT overwrite modified files with just `npm install`.

```bash
rm -rf node_modules/playwright-core node_modules/playwright/node_modules/playwright-core
npm install --ignore-scripts        # reinstall clean, skip postinstall
node scripts/patch-playwright.js    # re-apply patches to all copies
```

Then restart the MCP server.

If `patch-playwright.js` fails, the search strings in the relevant patch step need updating — see inline `UPSTREAM FRAGILITY` comments in the script.

Key things to re-verify after any playwright-core version bump:

- `crPage.js` still has `utilityWorldName` property (patch #5b)
- `crPage.js` still matches context by `contextPayload.name === this._crPage.utilityWorldName`
- Worker constructor signature (patches #3b and #6a must stay in sync)
- `PageBinding.dispatch` still parses a JSON payload string (patch #6c guard)

Reference: `docs/rebrowser-patches-research.md` — detection results and patch overview.
Reference: `docs/waitForSelector-bug.md` — utility world name bug investigation.

---

## Branch conventions

| Branch                          | Purpose                                                |
| ------------------------------- | ------------------------------------------------------ |
| `main`                          | Stable, production                                     |
| `plan/separation`               | Current: monorepo separation (phases 1-7 complete)     |
| `upstream-playwright-mcp`       | Staging before an upstream merge                       |
| `merge-upstream-playwright-mcp` | Active upstream merge in progress                      |

---

## Adding a szkrabok MCP tool

1. Export `async function` from a file in `src/tools/`
   - Name the file `szkrabok_*.js` if it is szkrabok-specific
2. Register in `registry.js`: name, handler, description, inputSchema
3. Tool is auto-exposed via MCP — no other wiring needed
4. If the tool needs session access: `import { getSession } from '@szkrabok/runtime'`
5. Never import stealth, storage, pool, or config internals — only the runtime public API

Regenerate `mcp-client/mcp-tools.js` after any registry change:

```bash
npm run codegen:mcp
```

See [architecture.md](./architecture.md) for tool ownership map and invariants to preserve.

---

## Restarting the MCP server

After editing source files: in Claude Code run `/mcp` → select **restart** for szkrabok.
