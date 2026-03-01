# Separation Progress

Tracks implementation state against the consumer portability goal:
> External projects install `@szkrabok/runtime` + `@szkrabok/mcp-client`, write specs,
> get stealth + persistence with no MCP server in dev. No imports from `src/` or
> internal package paths.

---

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Extract `@szkrabok/runtime` | DONE |
| 2 | MCP `src/` imports from runtime | DONE |
| 3 | `automation/fixtures.js` uses runtime only | DONE |
| 4 | CLI `szkrabok open <profile>` | DONE |
| 5 | Selftest suites (runtime unit, integration, mcp contracts) | DONE |
| 6 | ESLint boundary rules | DONE |
| 7 | CI pipeline yml | DONE (disabled — headless env not configured) |
| 8 | `mcp-client/` → `packages/mcp-client/` (`@szkrabok/mcp-client`) | DONE |
| 9 | Remove repo-local `config/` imports from `automation/` | DONE |
| 10 | Consumer install path (`npm pack` + versioning) | DONE |

---

## What is done

### Phase 1 — `@szkrabok/runtime`

`packages/runtime/` is a workspace package. Within this monorepo, `@szkrabok/runtime`
resolves via the workspace symlink. Public API: `launch`, `connect`, `closeSession`,
`getSession`, `listRuntimeSessions`, `updateSessionMeta`, `deleteStoredSession`,
`closeAllSessions`, `resolvePreset`, `PRESETS`.

### Phase 2 — MCP imports from runtime

All tools in `src/tools/` import `getSession`, `launch`, `closeSession`, etc. from
`@szkrabok/runtime`. `src/core/pool.js`, `src/core/storage.js`, `src/core/szkrabok_stealth.js`
deleted. `src/config.js` trimmed to MCP-only concerns (TIMEOUT, LOG_LEVEL, DISABLE_WEBGL).

### Phase 3 — `automation/fixtures.js`

Path A (`SZKRABOK_CDP_ENDPOINT` set): `connect(endpoint)` from runtime.
Path B (standalone): `launch({ profile: 'dev', reuse: true })` from runtime.
No stealth import. No direct `chromium.launch`.

### Phase 4 — CLI `szkrabok open`

`src/cli.js` has `szkrabok open <profile>` — calls `runtime.launch()`, prints `cdpEndpoint`,
keeps alive until SIGINT.

### Phase 5 — Selftest suites

- `selftest/runtime/unit.test.js` — config, storage, stealth without MCP
- `selftest/runtime/integration.test.js` — session persistence across two launches
- `selftest/mcp/contract.test.js` — invariant checks (no direct launch calls in MCP tools)
- `selftest/playwright/` — session lifecycle, stealth, CSS tools via MCP
- `selftest/node/` — schema, basic, playwright_mcp, scrap

### Phase 6 — ESLint boundary rules

`eslint.config.js` enforces:
1. No `chromium.launch*()` outside `packages/runtime/`
2. No stealth imports outside `packages/runtime/`
3. No `@szkrabok/runtime/*` subpath imports (only public root)

### Phase 7 — CI yml

`.github/workflows/ci.yml` exists but is disabled (renamed `.disabled`).
Needs a headless-capable CI environment before enabling.

### Phase 8 — `@szkrabok/mcp-client` package

`mcp-client/` contents copied to `packages/mcp-client/` with a `package.json` naming it
`@szkrabok/mcp-client`. Public API exported from `packages/mcp-client/index.js`:
`mcpConnect`, `spawnClient`. All consumer imports updated to `@szkrabok/mcp-client`.
`codegen:mcp` script updated to `packages/mcp-client/codegen/generate-mcp-tools.mjs`.

### Phase 9 — Remove `config/` imports from `automation/`

`automation/park4night/park4night.spec.js` now reads credentials from `P4N_EMAIL` and
`P4N_PASSWORD` env vars. No `../../config/` imports remain in `automation/`.

### Phase 10 — Consumer install path (`npm pack`)

`npm run release:patch` / `release:minor` bumps all workspace versions via
`npm version --workspaces --include-workspace-root --ignore-scripts` (git tag created,
postinstall hooks skipped during bump), then packs both packages into `dist/`.

A `prepack` guard enforces that `npm run pack` is never called without a version tag
at HEAD — raw packing is blocked with a clear error message.

`patch-playwright.js` uses `INIT_CWD` (set by npm to the consumer project root) to
locate `node_modules/playwright-core` regardless of where postinstall runs from.

**Consumer install (verified working):**
```bash
npm install /path/to/dist/szkrabok-runtime-1.0.4.tgz
npm install /path/to/dist/szkrabok-mcp-client-1.0.4.tgz
```

---

## Consumer portability test

All phases complete. Install from tarballs on a machine without this repo:

```bash
mkdir my-project && cd my-project
npm init -y
npm install /path/to/szkrabok-runtime-x.y.z.tgz /path/to/szkrabok-mcp-client-x.y.z.tgz
```

Verified exports:
- `@szkrabok/runtime`: `launch`, `connect`, `closeSession`, `getSession`, `listRuntimeSessions`, `resolvePreset`, `PRESETS` + more
- `@szkrabok/mcp-client`: `mcpConnect`, `spawnClient`
