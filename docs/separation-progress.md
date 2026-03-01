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
| **8** | **`mcp-client/` → `packages/mcp-client/` (`@szkrabok/mcp-client`)** | **TODO** |
| **9** | **Remove repo-local `config/` imports from `automation/`** | **TODO** |
| **10** | **Consumer install path (npm publish or git URL)** | **TODO** |

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

---

## What is NOT done

### Phase 8 — `@szkrabok/mcp-client` package

**Current state:** `mcp-client/` sits at the repo root with no `package.json`.
It is not a workspace package. Consumer specs import it via relative path:
```js
import { mcpConnect } from '../mcp-client/mcp-tools.js';       // repo-relative
```

**Target state:** Move to `packages/mcp-client/` with `package.json` naming it
`@szkrabok/mcp-client`. Add to workspace. Consumer imports become:
```js
import { mcpConnect } from '@szkrabok/mcp-client';
```

Tasks:
- [ ] Add `packages/mcp-client/package.json` (`@szkrabok/mcp-client`)
- [ ] Move `mcp-client/` contents into `packages/mcp-client/`
- [ ] Update root `package.json` workspace glob if needed
- [ ] Fix all relative `../mcp-client/` imports in `automation/` to use `@szkrabok/mcp-client`
- [ ] Add `postinstall` to auto-generate `mcp-tools.js` on install
- [ ] Export `mcpConnect` from `packages/mcp-client/index.js`

### Phase 9 — Remove repo-local `config/` imports from `automation/`

**Current state:** `automation/park4night/park4night.spec.js` imports:
```js
import { loadToml } from '../../config/toml.js';
import { paths } from '../../config/paths.js';
```
This is used only to read `[credentials.park4night]` from the local TOML.
A consumer project has no `config/` directory — this import breaks portability.

**Target state:** Credentials via env vars (`P4N_EMAIL`, `P4N_PASSWORD`) or a
runtime-provided config helper. No `../../config/` imports anywhere in `automation/`.

Tasks:
- [ ] Add credential env var support to `park4night.spec.js` (`P4N_EMAIL`, `P4N_PASSWORD`)
- [ ] Keep TOML path as optional fallback for this repo (or drop entirely)
- [ ] Audit all `automation/` files for other `../../config/` or `../../src/` imports

### Phase 10 — Consumer install path

**Current state:** `@szkrabok/runtime` and `@szkrabok/mcp-client` exist only as
workspace-local packages. A project outside this monorepo cannot install them.

**Target state options (pick one):**
- Publish to npm (`npm publish --workspaces`)
- Install via git URL: `npm install github:PabloVitasso/szkrabok#main`
- Private registry

Tasks:
- [ ] Decide on distribution mechanism
- [ ] Test install from outside the repo
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
