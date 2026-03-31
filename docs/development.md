# Development

## Contents

- [Adding a new MCP tool](#adding-a-new-mcp-tool)
- [CLI](#cli)
- [Release workflow](#release-workflow)
- [Upgrading playwright-core](#upgrading-playwright-core)
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

**Design rule:** CLI commands call the same handler functions as the MCP tools. They never re-implement session logic. When adding a new MCP tool handler that makes sense as a CLI command, add a file to `src/cli/commands/` and register it in `src/cli/index.js`.

CLI-only operations (no MCP equivalent):
- `szkrabok open` — human-facing browser launch
- `szkrabok session inspect` — raw cookie/localStorage dump
- `szkrabok endpoint` — print endpoints to stdout
- `szkrabok doctor` — checks node version, playwright-core installed + patched, browser resolution chain, server imports, startup log path; also prints the correct dev MCP config snippet (see below)
- `szkrabok doctor detect [--write-config]` — runs the full resolution chain, shows all candidates with pass/fail/skip/absent status, prints resolved path; `--write-config` pins the discovered path to `~/.config/szkrabok/config.toml`
- `szkrabok doctor install [--force]` — installs Playwright-managed Chromium (idempotent: skips if browser already found via any source; `--force` bypasses this guard to force re-download)
- `CHROMIUM_PATH` env var — set to any system Chrome path to skip Playwright-managed Chromium (highest resolution priority)

**Adding a new CLI command:**
1. Create `src/cli/commands/<name>.js` — export `register(program, ctx)`
2. Import and call `register` in `src/cli/index.js`
3. Add the command name to `CLI_COMMANDS` in `src/index.js`

---

## MCP config for developing szkrabok

End users add szkrabok via `npx`:
```json
{
  "szkrabok": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@pablovitasso/szkrabok"],
    "env": {}
  }
}
```

When developing szkrabok itself, choose between two configs:

**Config A — local source** (source changes take effect on MCP restart, no publish needed):

Add a project-local entry that overrides the user-level config for this repo only:

```bash
claude mcp add szkrabok -s local -- node /absolute/path/to/szkrabok/src/index.js
```

**Config B — published registry** (stable, matches what consumers get):

`npx` must run from a directory **outside** the szkrabok repo tree. If run from inside, Node's module resolution walks up past `node_modules` in the repo and finds the repo's own copies of playwright-core and other packages — corrupting the patching logic. Use the stub at `~/szkrabok-npx/` (a single `package.json` with a different package name, located outside the repo):

```bash
claude mcp add szkrabok -s local -- bash -c "cd ~/szkrabok-npx && npx -y @pablovitasso/szkrabok"
```

Run `szkrabok doctor` to get the correct path for your machine. Both commands write to `.mcp.json` in the repo root (project-local scope, gitignored).

**Verify which server is running** — after restarting, call `session_manage { "action": "list" }`. The response includes:

```json
{ "server": { "version": "1.0.25", "source": "/path/to/src/index.js" } }
```

`source` is the entry point Node was invoked with — local repo path for Config A, npx cache path for Config B. The same info is written to `~/.cache/szkrabok/startup.log` on every start.

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

`prepublishOnly` runs `npm run lint` then `scripts/smoke-test.js` before every `npm publish`. The smoke-test packs a tarball, installs it in a fresh bare temp directory using `--foreground-scripts` (exercising the real postinstall pipeline: `apply-patches.js` → `verify-playwright-patches.js`), then runs `szkrabok --version` and `szkrabok doctor`. Chromium download is **not** part of postinstall — `postinstall.js` is retained for manual use but excluded from the chain. Install Chromium separately with `szkrabok doctor install` or `doctor detect --write-config`. Publish fails loudly if any step fails — catching lint errors, missing files, broken postinstall, or binary resolution issues before they reach npm.

`release:publish` checks `npm whoami` and fails with a clear message if not logged in. Run `npm login` then re-run.

Scaffolded consumer projects do **not** depend on `@pablovitasso/szkrabok` locally —
szkrabok runs as a global MCP server (via `npx` or `claude mcp add`). The scaffolded
`package.json` only adds `@playwright/test` and `smol-toml` as devDependencies.
Projects that also want standalone Playwright runs (Path B in `fixtures.js`) need to
`npm install @pablovitasso/szkrabok` manually — the dynamic import will fail with a
clear error if the package is absent.

---

## Upgrading playwright-core

playwright-core is pinned to an exact version and patched via `patch-package`. The patch file lives in `patches/playwright-core+<version>.patch` and is committed to the repo. When upgrading:

1. Bump the version in `package.json` (both `playwright` and `playwright-core`):
   ```json
   "playwright": "1.59.0",
   "playwright-core": "1.59.0"
   ```

2. Install fresh files without running postinstall:
   ```bash
   npm install --ignore-scripts
   ```

3. Apply patches to the new version using the patch script:
   ```bash
   node packages/runtime/scripts/patch-playwright.js
   ```
   All 7 entries must report `patched`. If any fail, the script rolls back and exits 1 — the anchor string changed upstream and the patch script needs updating first.

4. Regenerate the patch file for the new version:
   ```bash
   npx patch-package playwright-core
   ```
   This diffs the patched files against the clean npm tarball and writes `patches/playwright-core+1.59.0.patch`.

5. Verify the full postinstall chain works on a clean install:
   ```bash
   rm -rf node_modules/playwright-core
   npm install playwright-core
   ```
   Expected output: `patch-package` reports ✔, verify script reports all PASS.

6. Run the patch tests:
   ```bash
   node --test tests/node/playwright-patches.test.js
   ```

7. Commit:
   ```bash
   git add package.json package-lock.json patches/
   git commit -m "chore: upgrade playwright-core to 1.59.0"
   ```

   Delete the old patch file if it is still present:
   ```bash
   git rm patches/playwright-core+1.58.2.patch
   ```

---

## Consumer projects

| Project | Location | What it uses |
|---------|----------|-------------|
| `szkrabok-p4n` | `../szkrabok-p4n/` | `@szkrabok/runtime`, `@szkrabok/runtime` |

When releasing, update the dependency path in each consumer project's `package.json` and run `npm install`.

---

## ESLint

Config lives in `eslint.config.js` (flat config, ESLint v9+). Rules: `eslint:recommended` base, `no-unused-vars` as error (unused args and caught errors may be prefixed `_`), `eqeqeq`, `no-throw-literal`, `prefer-const`, `no-var`. Browser globals are added for files that pass callbacks to `page.evaluate()` / `addInitScript()`. Architectural boundary rules (no direct `chromium.launch*`, no stealth imports, no runtime subpath imports outside `packages/runtime/`) are enforced via additional file-scoped config blocks.

```bash
npm run lint        # runs standalone
npm run test:self   # lint runs as the first step before Playwright + node tests
```

**Prefer code rewrites over `eslint-disable`.** If a lint rule fires, the first instinct should be to restructure the code so the rule no longer applies — not to suppress it. Suppressions hide real issues and accumulate silently. `reportUnusedDisableDirectives` is enabled and will error on any stale suppression.

If suppression is genuinely unavoidable (e.g. a rule misfires on intentional code with no clean rewrite), use the `-- <reason>` format so the intent is explicit and reviewable:

```js
// eslint-disable-next-line no-empty -- intentional: signal file absence is a no-op
catch {}
```

Never suppress without an explanation.

---

## Coding Style

- **No repeated string literals for dispatch.** If a string (tool name, event type, key) controls branching in more than one place, put it in a registry/map keyed by that string. The string appears once as the key; behaviour is a value. Adding a new case = adding one entry, not touching multiple `if`/`switch` blocks
- **No ANSI codes in programmatic output.** Subprocess output piped into structured data must be clean text. Set `FORCE_COLOR=0` (or equivalent) when spawning CLI tools whose output is parsed or logged
- **Fail fast — no silent fallbacks.** Do not substitute empty values (`?? 0`, `?? []`, `?? 'unknown'`) for data that should always be present. If a field is unexpectedly missing, let it throw — that is a real bug and should surface immediately. Only use fallbacks for fields that are genuinely optional by design (e.g. `error` on a passing test result). Masking missing data with defaults hides bugs and produces silently wrong output

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
