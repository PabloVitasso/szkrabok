# Calling MCP tools from inside a Playwright test

## Why

The LLM (Claude Code) manages szkrabok sessions by calling MCP tools:
`session.open`, `nav.goto`, `interact.click`, etc.  When it opens a session it
loads the persistent Chrome profile from `sessions/{id}/profile/` — which
carries cookies, localStorage, auth tokens, and any state built up in previous
LLM interactions.

Normal Playwright tests have no equivalent.  `playwright.config.ts` supports a
`storageState` file (cookies + localStorage snapshot), but that is a manual
export and does not cover the full profile (IndexedDB, service workers,
extension state, etc.).  There is no built-in Playwright concept of a named,
reusable, self-managing session.

**The insight:** a Playwright test that uses `@modelcontextprotocol/sdk` as an
MCP client can call `session.open('p4n-test')` and get exactly the same session
the LLM would get — including the full persisted profile.  The test gains
szkrabok's session management without any manual state export.

---

## Transport reality

szkrabok runs on **stdio transport only** (`src/server.js` →
`StdioServerTransport`).  A `StdioClientTransport` inside a Playwright test
*spawns a new `node src/index.js` child process*.  That process is isolated
from the Claude Code MCP process (separate in-memory pool), but it reads from
the **same `sessions/` directory on disk**.  So `session.open('p4n-test')`
inside the test loads the same profile that the LLM session built up.

The in-memory isolation does not matter — what matters is the shared file
storage, and that works out of the box.

---

## Pattern: test-initiator block

Place a structured config block in the spec file.  A shared helper spawns the
MCP client, drives the sequence, and returns parsed results for assertion or
console output.

```ts
// automation/park4night.spec.ts

// ── MCP session config ────────────────────────────────────────────────────────
// The LLM creates and manages this session. Tests reuse it to get the full
// persisted Chrome profile (cookies, auth, localStorage) without any manual
// state export.
const SESSION = 'p4n-test';

import { test, expect } from '@playwright/test';
import { mcpSession } from './helpers/mcp-initiator.js';

test('park4night — navigate and snapshot via MCP session', async () => {
  await mcpSession(SESSION, async mcp => {
    await mcp.call('nav.goto', { url: 'https://park4night.com' });
    const snap = await mcp.call('browser.snapshot');
    console.log(snap);
    // assert something from snap ...
  });
});
```

`automation/helpers/mcp-initiator.js`:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Open a szkrabok MCP session by name, run a callback with a tool-call helper,
 * then close the session cleanly.
 *
 * The named session loads the persisted Chrome profile from sessions/{id}/
 * exactly as the LLM tool does — cookies, auth state, etc. are all present.
 *
 * @param {string} sessionId  - szkrabok session ID
 * @param {(mcp: { call: (tool: string, args?: object) => Promise<any> }) => Promise<void>} fn
 */
export async function mcpSession(sessionId, fn) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['src/index.js'],
  });

  const client = new Client({ name: 'playwright-mcp-initiator', version: '1.0.0' });
  await client.connect(transport);

  await client.callTool({ name: 'session.open', arguments: { id: sessionId } });

  const mcp = {
    call: async (tool, args = {}) => {
      const result = await client.callTool({
        name: tool,
        arguments: { id: sessionId, ...args },
      });
      return result.content;
    },
  };

  try {
    await fn(mcp);
  } finally {
    await client.callTool({ name: 'session.close', arguments: { id: sessionId } });
    await client.close();
  }
}
```

---

## What the test gets that normal Playwright tests cannot

| Capability | Normal Playwright test | MCP-client test |
|---|---|---|
| Persistent Chrome profile (full) | No | Yes — `sessions/{id}/profile/` |
| Cookies from LLM-managed session | Partial (storageState export) | Yes — automatic |
| Stealth browser identity | Manual setup | Yes — inherited from szkrabok config |
| Session created/managed by LLM | No | Yes — same session ID |
| Drive browser via Playwright API | Yes | Possible — add CDP bridge on top |

---

## Combining with CDP bridge

The two approaches are composable.  Use the MCP client to open the session
(which gives the profile + CDP port), then attach Playwright directly via CDP
for richer interaction:

```ts
test('hybrid — MCP session + direct Playwright API', async () => {
  // 1. Open session via MCP (loads profile, starts Chrome with CDP port)
  const client = await openMcpClient();
  const openResult = await client.callTool({
    name: 'session.open',
    arguments: { id: 'p4n-test' },
  });
  const cdpPort = parseCdpPort(openResult); // extract from response

  // 2. Connect Playwright directly to that same Chrome
  const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  const [context] = browser.contexts();
  const [page] = context.pages();

  // 3. Use full Playwright API — session state (cookies etc.) already loaded
  await page.goto('https://park4night.com');
  await expect(page).toHaveTitle(/park4night/);

  // 4. Close via MCP (saves profile)
  await client.callTool({ name: 'session.close', arguments: { id: 'p4n-test' } });
  await client.close();
});
```

In practice `session.open` returns a text message, not a structured object, so
the CDP port would need to be derived from the session ID using the same hash
formula as `tools/szkrabok_session.js` (`20000 + abs(hash) % 10000`), or
`session.endpoint` can be called to get it explicitly.

---

## Notes

- `client.close()` does not call `session.close` — always close the session
  explicitly or Chrome leaks.
- The spawned MCP server process inherits env vars — TOML config, `HEADLESS`,
  etc. work as normal.
- `@modelcontextprotocol/sdk` is already a dependency of szkrabok — no new
  package needed.
