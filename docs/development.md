# Development

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
|------|-----|------------|
| `README.md` | Upstream has its own README | Keep ours — discard upstream content |
| `Dockerfile` | Upstream Docker setup; szkrabok does not use it | Handled by `.gitattributes` (`merge=ours`) |

### After resolving conflicts

1. Run `node packages/runtime/scripts/patch-playwright.js` if `playwright-core` version changed
2. Run `npm run test:contracts` to verify invariants
3. Commit with: `merge: upstream/main (0.0.X -> 0.0.Y)`

### playwright-core version bump during merge

```bash
rm -rf node_modules/playwright-core
npm install --ignore-scripts
node packages/runtime/scripts/patch-playwright.js
```

---

## Adding a new MCP tool

1. Add handler to the appropriate file in `src/tools/` (or create a new one)
2. Register it in `src/tools/registry.js` — name, handler, schema
3. Regenerate the client: `npm run codegen:mcp`
4. Commit the updated `packages/mcp-client/mcp-tools.js`
5. Run `npm run test:contracts` and `npm run test:playwright`

---

## Release workflow

```bash
# 1. Commit all changes
git add -A && git commit -m "..."

# 2. Bump version, create git tag, pack both packages
npm run release:patch    # or release:minor

# Produces:
#   dist/szkrabok-runtime-x.y.z.tgz
#   dist/szkrabok-mcp-client-x.y.z.tgz
```

The `prepack` guard prevents packing without a version tag. Raw `npm run pack` will fail if HEAD is untagged — always use `release:*`.

Consumer projects update their dependency path:
```json
"@szkrabok/runtime": "file:../szkrabok/dist/szkrabok-runtime-x.y.z.tgz"
```

---

## Consumer projects

| Project | Location | What it uses |
|---------|----------|-------------|
| `szkrabok-p4n` | `../szkrabok-p4n/` | `@szkrabok/runtime`, `@szkrabok/mcp-client` |

When releasing, update the dependency path in each consumer project's `package.json` and run `npm install`.

---

## Config modules (`config/`)

TypeScript modules used only by `playwright.config.js` — not by the runtime or MCP server.

| Module | Purpose |
|--------|---------|
| `env.ts` | Single reader for all relevant `process.env` vars |
| `paths.ts` | All filesystem paths (sessions dir, config file, test dirs) |
| `toml.ts` | `loadToml()` — loads + deep-merges base and local TOML |
| `preset.ts` | `resolvePreset()` — for playwright.config.js use only |
| `session.ts` | `resolveSession()` — session paths from env + paths |
| `browser.ts` | `resolveExecutable()` — finds bundled or system Chromium |
| `projects.ts` | `integration`, `e2e` project definitions |

Do not import these in `src/` or `packages/runtime/` — the runtime has its own `config.js`.
