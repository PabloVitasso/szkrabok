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
| **10** | **Consumer install path (`npm pack` + versioning)** | **TODO** |

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

---

## What is NOT done

### Phase 10 — Consumer install path (`npm pack`)

**Current state:** `@szkrabok/runtime` and `@szkrabok/mcp-client` exist only as
workspace-local packages. A project outside this monorepo cannot install them.

**Target state:** `npm pack` produces versioned tarballs in `dist/`. Consumer installs
from a local path or URL to the tarball — no registry needed.

**Versioning workflow (automated):**
```bash
# Bump patch version across all packages + root, then pack both into dist/
npm run release:patch

# Or minor
npm run release:minor
```
This runs `npm version patch --workspaces --include-workspace-root` (bumps all
`package.json` files consistently, creates a git tag `v1.0.1`), then packs both
workspace packages into `dist/szkrabok-runtime-1.0.1.tgz` and
`dist/szkrabok-mcp-client-1.0.1.tgz`.

**Consumer install:**
```bash
npm install /path/to/dist/szkrabok-runtime-1.0.1.tgz
npm install /path/to/dist/szkrabok-mcp-client-1.0.1.tgz
```

Tasks:
- [ ] Run `npm run pack` and verify tarballs are produced
- [ ] Test install from outside the repo (`npm install /abs/path/to/tgz`)
- [ ] Verify `@szkrabok/runtime` and `@szkrabok/mcp-client` resolve correctly post-install
- [ ] Document install steps in README

---

## Consumer portability test

The goal is met when this works on a fresh machine with no clone of this repo:

```bash
mkdir my-project && cd my-project
npm init -y
npm install @szkrabok/runtime @szkrabok/mcp-client @playwright/test
```

```js
// my-spec.spec.js
import { test } from '@playwright/test';
import { launch } from '@szkrabok/runtime';

test('my test', async ({}) => {
  const { context, close } = await launch({ profile: 'my-profile' });
  const page = await context.newPage();
  await page.goto('https://example.com');
  await close();
});
```

```bash
npx playwright test my-spec.spec.js
```

This currently does NOT work. Phases 8-10 are required.
