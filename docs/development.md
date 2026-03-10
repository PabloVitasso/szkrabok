# Development

## Contents

- [Adding a new MCP tool](#adding-a-new-mcp-tool)
- [CLI](#cli)
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

## CLI

`szkrabok` is both the MCP server and the CLI — a single binary. Invoked with no arguments it starts the MCP server (stdio). Invoked with a subcommand it runs the CLI.

```
szkrabok                        # MCP server (used by Claude)
szkrabok session list           # CLI
szkrabok open <profile>         # CLI
```

**Design rule:** CLI commands call the same handler functions as the MCP tools. They never re-implement session logic. When adding a new MCP tool handler that makes sense as a CLI command, import and call it from `src/cli.js` and register it there.

CLI-only operations (no MCP equivalent, live only in `cli.js`):
- `szkrabok open` — human-facing browser launch
- `szkrabok session inspect` — raw cookie/localStorage dump
- `szkrabok endpoint` — print endpoints to stdout
- `szkrabok detect-browser` — lists Chrome/Chromium paths; outputs ready-to-paste `executablePath` line
- `szkrabok install-browser` — runs `npx playwright install chromium`; use when `launch()` throws "Chromium not found"

---

## Release workflow

```bash
# 1. Update dependencies (optional, deliberate — not automatic)
npm run deps:update
git add -A && git commit -m "chore: update deps"

# 2. Commit all feature/fix changes
git add -A && git commit -m "..."

# 3. Bump version, commit, tag, push
npm run release:patch    # or release:minor

# 4. Publish to npm (requires npm login)
npm run release:publish
```

**`release:patch` / `release:minor`** does everything atomically:
- Bumps `package.json` + workspace versions (`--no-git-tag-version` suppresses npm's auto-tag)
- Creates a single `chore: release x.y.z` commit staging all version files
- Tags that commit as `vx.y.z`
- Pushes commit and tag

This ensures the tag always points at the release commit — no manual tag moves needed.

**`deps:update`** runs `npm-check-updates -u` across all workspaces then `npm install`. Run it deliberately before a release — not on every build. Dependency bumps are a conscious decision; CI always installs from the lockfile.

The `prepack` guard prevents publishing without a version tag on HEAD.

`release:publish` checks `npm whoami` and fails with a clear message if not logged in. Run `npm login` then re-run.

Scaffolded consumer projects reference the published package from npm:
```json
"@pablovitasso/szkrabok": "^x.y.z"
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
