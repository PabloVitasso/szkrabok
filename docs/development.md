# Development

## Contents

- [Adding a new MCP tool](#adding-a-new-mcp-tool)
- [CLI (bebok)](#cli-bebok)
- [Release workflow](#release-workflow)
- [Consumer projects](#consumer-projects)
- [Config modules](#config-modules-config)

---

## Adding a new MCP tool

1. Add handler to the appropriate file in `src/tools/` (or create a new one)
2. Register it in `src/tools/registry.js` — name, handler, schema
3. Regenerate the client: `npm run codegen:mcp`
4. Commit the updated `packages/runtime/mcp-client/mcp-tools.js`
5. Run `npm run test:contracts` and `npm run test:playwright`

---

## CLI (`bebok`)

`bebok` is the human/shell operator interface. It is registered as a bin entry alongside `szkrabok`:

```json
"bin": {
  "szkrabok": "./src/index.js",
  "bebok": "./src/cli.js"
}
```

**Design rule:** `bebok` calls the same handler functions as the MCP tools. It never re-implements session logic. When adding a new MCP tool handler that makes sense as a CLI command, import and call it from `src/cli.js`.

CLI-only operations (no MCP equivalent, live only in `cli.js`):
- `bebok open` — human-facing browser launch
- `bebok session inspect` — raw cookie/localStorage dump
- `bebok endpoint` — print endpoints to stdout

---

## Release workflow

```bash
# 1. Commit all changes
git add -A && git commit -m "..."

# 2. Bump version, create git tag, pack both packages
npm run release:patch    # or release:minor

# Produces:
#   dist/szkrabok-runtime-x.y.z.tgz
#   
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
| `szkrabok-p4n` | `../szkrabok-p4n/` | `@szkrabok/runtime`, `@szkrabok/runtime` |

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
