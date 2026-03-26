# Bug: `@pablovitasso/szkrabok/runtime` import fails in user projects using npx MCP

## Problem

```bash
claude mcp add szkrabok -- npx -y @pablovitasso/szkrabok
```

`npx -y` installs the MCP server into the npx cache. The server process works. But when `browser_run_test` spawns `npx playwright test`, the user's `fixtures.js` does:

```js
import { initConfig, launch, connect } from '@pablovitasso/szkrabok/runtime';
```

Node resolves this from the **test file's directory**, not from `cwd`. The npx cache is not on that path. Import fails.

**Root cause:** npx covers the server process only. User test files have their own resolution chain.

## Stealth clarification

Stealth is applied at **browser launch time** (`session_manage open`), not at connection time. Any option that connects to an MCP-managed browser inherits stealth regardless of how the connection is made. Options that launch their own browser in standalone mode need the runtime to get stealth.

---

## Options

### Option A — Inject `NODE_PATH`

Set `NODE_PATH: dirname(REPO_ROOT)` in the env passed to the Playwright subprocess. Points Node at the npx cache's `node_modules/` where `@pablovitasso/szkrabok` lives.

- **MCP stealth:** Yes — connects to session_manage browser which launched with stealth
- **Standalone stealth:** Yes — runtime resolves via NODE_PATH, `launch()` available
- **Tradeoffs:** Relies on npx cache layout. May shadow user deps in edge cases. Quick fix, not structural.

---

### Option B — Dynamic import for standalone only

Template `fixtures.js` Path A uses plain `chromium.connectOverCDP()`. Path B uses `await import('@pablovitasso/szkrabok/runtime')` only when needed.

- **MCP stealth:** Yes — attaches to already-stealthy session_manage browser
- **Standalone stealth:** Yes, but requires `npm install @pablovitasso/szkrabok` — error is actionable rather than a silent startup crash
- **Tradeoffs:** Template becomes more complex. `connect()` wrapper replaced by raw CDP; context setup must be verified. Clean structural fix for MCP mode.

---

### Option C — Programmatic Playwright runner

Replace the `npx playwright test` subprocess with Playwright's programmatic API called directly inside the MCP server process. No cross-process module resolution boundary.

- **MCP stealth:** Yes
- **Standalone stealth:** Yes — runtime is in-process
- **Tradeoffs:** Must mirror CLI behavior (reporters, retries, sharding). Playwright internals are semi-private. Heavy implementation. Industry pattern in Nx/Vitest runners.

---

### Option D — Ephemeral install into user project

When `browser_run_test` detects the runtime is missing, run `npm install --no-save @pablovitasso/szkrabok` in the user's project dir before spawning tests.

- **MCP stealth:** Yes
- **Standalone stealth:** Yes
- **Tradeoffs:** Mutates user project (some teams disallow hidden installs). Requires package manager detection (npm/pnpm/yarn/bun). Lockfile safety needed. Precedent: Cypress binary, Playwright `install-deps`, Prisma engines.

---

### Option E — Bundle runtime + ESM loader

Ship a single-file MCP bundle with embedded runtime. Register a custom `--loader` that resolves `@pablovitasso/szkrabok/runtime` to the bundled module. Loader flag must propagate into the Playwright subprocess via `NODE_OPTIONS`.

- **MCP stealth:** Yes
- **Standalone stealth:** Yes
- **Tradeoffs:** Advanced Node internals. Harder stack traces. Loader flags must survive subprocess env. Pattern used by ts-node, Vitest runtime, Next.js SWC.

---

### Option F — Ephemeral shim + `NODE_OPTIONS --import`

Modern scoped alternative to NODE_PATH. No global module resolution mutation. The MCP server can already resolve the runtime (it's in the same npx install), so the runtime entry point is discoverable server-side and can be forwarded to subprocesses via a generated shim.

**Step 1 — Discover runtime entry (server side)**

```js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const runtimeEntry = require.resolve('@pablovitasso/szkrabok/runtime');
```

Works because the MCP server itself can resolve the runtime from its own npx location. No cache path hardcoding needed.

**Step 2 — Write shim to tmp**

```js
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shimPath = join(tmpdir(), `szkrabok-runtime-${process.pid}.mjs`);
writeFileSync(shimPath, `export * from ${JSON.stringify(runtimeEntry)};`);
```

**Step 3 — Inject into subprocess env**

```js
const env = {
  ...process.env,
  NODE_OPTIONS: [
    process.env.NODE_OPTIONS,
    `--import=${shimPath}`
  ].filter(Boolean).join(' '),
};
```

Node preloads the shim before any test file runs. `@pablovitasso/szkrabok/runtime` resolves for all imports in the subprocess.

**Strengths over Option A (NODE_PATH)**
- No reliance on npx cache directory layout
- No global resolution mutation (won't shadow user deps)
- Works with both CJS and ESM
- Clean stack traces (no loader transform)
- Coexists with existing user NODE_OPTIONS

**Failure modes**
- Concurrent test runs with same PID reuse → fix with UUID suffix on shim filename
- Windows quoting issues in NODE_OPTIONS (spaces in path)
- Node <18.6 lacks stable `--import` support
- If user already aliases the same specifier → precedence ambiguity

**Operational maturity:** High. Pattern used in Vite SSR polyfills, Jest runtime patches, Next.js instrumentation hooks.

- **MCP stealth:** Yes — connects to session_manage browser launched with stealth
- **Standalone stealth:** Yes — runtime resolves via shim, `launch()` available
- **Tradeoffs:** Shim file is a temp artifact (cleanup on process exit recommended). Still tactical rather than structural — does not eliminate the fixture template dependency.

---

### Option G — Playwright preset package (structural endgame)

Users configure:

```js
// playwright.config.js
import { defineConfig } from '@pablovitasso/szkrabok/preset';
export default defineConfig();
```

Preset internally wires CDP connect or stealth launch. No fixture template to copy or maintain.

- **MCP stealth:** Yes
- **Standalone stealth:** Yes
- **Tradeoffs:** Requires project-level install — cannot be pure zero-install MCP. But dependency is declared where Playwright expects it, template fragility eliminated. Dominant industry pattern: `@playwright/experimental-ct-*`, `jest-preset-*`, `vitest/config`.

---

### Option H — Transport / handle injection (Playwright protocol, not CDP)

Tests do not import runtime, call `connectOverCDP()`, or open their own browser. The MCP server launches a browser server and passes the already-connected Playwright protocol endpoint to the test runner via env. Tests attach using `chromium.connect()` — Playwright's own wire protocol, not CDP.

**Step 1 — MCP server launches browser server**

```js
import { chromium } from 'playwright';
const browserServer = await chromium.launchServer({ headless: false });
const wsEndpoint = browserServer.wsEndpoint();
```

**Step 2 — Inject endpoint into subprocess env**

```js
const env = { ...process.env, PW_WS_ENDPOINT: wsEndpoint };
```

**Step 3 — Fixture connects via Playwright protocol**

```js
import { test as base, chromium } from '@playwright/test';

export const test = base.extend({
  browser: [
    async ({}, use) => {
      const ws = process.env.PW_WS_ENDPOINT;
      if (!ws) throw new Error('No injected browser endpoint');
      const browser = await chromium.connect(ws);
      await use(browser);
      // no close — server owns lifecycle
    },
    { scope: 'worker' }
  ]
});
```

No runtime import. No resolution problem. Fixtures.js reduces to pure `@playwright/test`.

**Strengths over CDP attach**
- Eliminates runtime dependency entirely — no resolution issue to solve
- Full Playwright fidelity: tracing, video, HAR, selectors engine, context isolation all work correctly (CDP attach loses some of these)
- Faster attach, deterministic context reuse
- Industry precedent: Playwright remote mode, Playwright Grid, browserless, CI browser farms

**Critical failure modes**

| Risk | Detail |
|------|--------|
| Version skew **(major)** | Playwright wire protocol is not semver-stable. Server on `1.x`, user on `1.y` → cryptic failures or silent feature loss. CDP does not have this issue. |
| Lifecycle coupling | Server crash kills all test transports; CDP reconnect is sometimes recoverable |
| Parallelism topology | Must design worker→browser mapping explicitly; wrong design → memory explosion or cross-test leakage |
| Network/container boundary | wsEndpoint unreachable across Docker bridge, WSL, remote MCP, CI sandbox; CDP tunnels more easily |
| Security | Playwright protocol endpoint gives full browser control with no auth by default; requires ephemeral token + localhost bind + random port |

**Standalone stealth:** No — there is no server to provide the handle in standalone mode; standalone still requires runtime or an alternative launch strategy.

**CDP vs Playwright protocol comparison**

| Dimension | CDP attach | Option H (PW protocol) |
|-----------|-----------|----------------------|
| Version tolerance | High | Low |
| Feature completeness | Medium | High |
| Runtime dependency | Sometimes | None |
| Reconnect ability | Medium | Low |
| Infra complexity | Low | Medium |
| Long-term scalability | Medium | High |

**Robustness is conditional.** If you control Playwright version in both server and user tests, MCP server is local, worker→browser mapping is deterministic, and endpoint security is implemented — H is architecturally cleaner than CDP. If any assumption breaks, H is more fragile than B or F.

- **MCP stealth:** Yes — server launches browser with stealth at `launchServer` time; tests inherit it
- **Standalone stealth:** No — no server to provide transport; standalone needs runtime or another mechanism

---

## Ranking

| Option | MCP stealth | Standalone stealth | Complexity | Structural |
|--------|------------|-------------------|------------|------------|
| G — preset | Yes | Yes | Medium | Yes (endgame) |
| B — dynamic import | Yes | Yes (install req'd) | Low | Partial |
| C — programmatic runner | Yes | Yes | High | Yes |
| D — ephemeral install | Yes | Yes | Medium | No |
| F — NODE_OPTIONS shim | Yes | Yes | Low | No |
| A — NODE_PATH | Yes | Yes | Minimal | No |
| E — ESM loader bundle | Yes | Yes | High | Partial |
| H — IPC handle | Yes | No | High | No |

## Recommendation

**Structural endgame:** **G** (preset) eliminates template fragility; dependency declared where Playwright expects it.

**Near-term clean fix:** **B** (dynamic import) — zero infrastructure change, makes MCP zero-install true today.

**Tactical bridge:** **F** (shim) or **A** (NODE_PATH) for users with existing fixtures that already import runtime.

**Optimal long-term stack (hybrid):**
1. **H** — Playwright protocol injection as primary path (zero install, full fidelity, when version parity is controlled)
2. **B** — CDP attach as fallback (version-tolerant, handles infra variance)
3. **F** — shim preload as safety net (covers edge cases where H and B both need runtime)

Single-mechanism solutions are weaker. H gives the cleanest fixture code but requires infra assumptions; B gives resilience; F covers the gaps. H cannot serve standalone mode — standalone always needs either runtime (B/F path) or an independent launch strategy.
