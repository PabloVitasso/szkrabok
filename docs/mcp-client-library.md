# MCP Client Library — Architecture

Reusable library for calling szkrabok MCP tools from Playwright tests.
Provides a typed handle object (`mcp.workflow.scrape(...)`) generated from the live
tool registry, with JSONL console output that is 1:1 copy-pasteable for LLM
invocation.

---

## File layout

```
packages/mcp-client/
  runtime/                    generic MCP execution — any server, any session model
    transport.js              spawnClient() — stdio process lifecycle
    invoker.js                createCallInvoker() — serialization, closed guard
    logger.js                 createLogger() — JSONL formatter, console + sidecar

  adapters/
    szkrabok-session.js       szkrabok session adapter — open/close, sessionName wire key

  codegen/                    run: npm run codegen:mcp
    generate-mcp-tools.mjs    entry — IO glue, spawns server, writes output file
    render-tools.js           pure function: (tools[]) -> string (file content)
    schema-to-jsdoc.js        pure function: (inputSchema) -> JSDoc type strings

  sequences/                  optional — stored JSONL call sequences for reuse

  mcp-tools.js                GENERATED — namespaced handle factory + JSDoc types
  index.js                    Public API: mcpConnect, spawnClient
```

`runtime/` contains nothing szkrabok-specific. It could drive any MCP server.
`adapters/szkrabok-session.js` is the only file that knows about `session.open`,
`session.close`, and the wire key name `sessionName`.

---

## Layers

```
your-spec.js
  └─ mcpConnect(sessionName, adapter)      ← from mcp-tools.js (generated)
       └─ mcp.workflow.scrape(args)        ← namespaced method, sessionName injected by adapter
       └─ mcp.browser.run_test(args)
       └─ mcp.close()

mcp-tools.js  [GENERATED]
  └─ spawnClient()                         ← from runtime/transport.js
  └─ createCallInvoker(...)                ← from runtime/invoker.js
       └─ adapter.injectSession(args)      ← from adapters/szkrabok-session.js
       └─ log.before(call, seq)            ← from runtime/logger.js
       └─ client.callTool(...)             ← SDK wire call
       └─ log.afterSuccess/afterFailure(...)

runtime/transport.js
  └─ StdioClientTransport                  ← spawns node src/index.js
  └─ Client.connect()

runtime/invoker.js
  └─ serialized callChain                  ← Promise chain, no parallel call races
  └─ closed guard                          ← throws if invoked after close()

runtime/logger.js
  └─ before(call, seq)                     ← intent line, _phase: "before"
  └─ afterSuccess(call, result, ms, seq)
  └─ afterFailure(call, err, ms, seq)

adapters/szkrabok-session.js
  └─ open(client, sessionName)             ← calls session.open { sessionName }
  └─ close(client, sessionName)            ← calls session.close { sessionName }
  └─ injectSession(args, sessionName)      ← returns { sessionName, ...args }
  └─ hasSession(tool)                      ← true if inputSchema.properties contains sessionName
```

---

## Generated file: `mcp-tools.js`

Single output file. Never edited by hand. Committed to git. Lives at
`packages/mcp-client/mcp-tools.js`.

Structure:

```
[header comment — timestamp, tool count, registry hash, regen command]
[imports — runtime/transport.js, runtime/invoker.js, runtime/logger.js]
[imports — adapters/szkrabok-session.js]
[REGISTRY_HASH constant]
[JSDoc @typedef McpHandle — all namespaces and methods with param types]
[export async function mcpConnect(sessionName, adapter, options) — returns McpHandle]
```

`mcpConnect` accepts an adapter as its second argument. The generated file
imports `szkrabok-session.js` and uses it as the default, so existing call
sites require no change. Passing a different adapter is the extension point
for testing against a different server or session model.

`sessionName` is passed through the adapter — generic code never references
the wire key `sessionName` directly. The adapter owns that mapping.

`session.*` tools are not exposed as handle methods — they are lifecycle,
called internally by the adapter via `open` and `close`.

### Registry drift detection

On connect, `mcpConnect` validates the live registry against the snapshot
baked in at codegen time. Count comparison alone is insufficient: renaming a
tool, mutating a schema, or swapping two tools preserves count while silently
breaking the generated handle.

The correct signal is a content hash. Codegen computes:

```js
import { createHash } from 'node:crypto';

function registryHash(tools) {
  const canonical = tools
    .map(t => ({ name: t.name, inputSchema: t.inputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return createHash('sha1')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 12);
}
```

The hash is baked into the generated file as `REGISTRY_HASH` and into the
header comment. At connect time, `mcpConnect` calls `client.listTools()` on
the already-open client (no second spawn), hashes the result, and compares:

```js
const liveHash = registryHash(await client.listTools());
if (liveHash !== REGISTRY_HASH) {
  throw new Error('MCP registry drift detected. Run npm run codegen:mcp');
}
```

`REGISTRY_HASH` is a generated constant at the top of `mcp-tools.js`.

**No second process is spawned.** The client opened by `spawnClient()` is
reused for the drift check, then handed to `createCallInvoker`. Spawning a
second client for the check would be wasteful and subtly racy if the registry
changed between spawns.

---

## `runtime/transport.js`

Single export: **`spawnClient()`** — spawns `node src/index.js` via
`StdioClientTransport`, connects an MCP `Client`, returns it. The caller owns
the lifecycle. Contains nothing session- or tool-specific.

---

## `runtime/invoker.js`

Single export: **`createCallInvoker({ client, log, adapter, sessionName })`** —
returns `{ invoke, close }`.

- `invoke(name, args)` — calls `adapter.injectSession(args, sessionName)` if
  `adapter.hasSession(tool)` is true, serializes via a promise chain, logs
  before/after, calls `client.callTool`. Throws if called after `close()`.
- `close()` — idempotent. Sets closed flag, then delegates to the adapter:

```js
async function close() {
  if (closed) return;
  closed = true;
  try {
    await adapter.close(client, sessionName);
  } finally {
    await client.close();
  }
}
```

`try/finally` is required. If `adapter.close` fails (e.g. browser already
crashed), `client.close()` must still run or the stdio transport leaks.

### Call serialization

All invocations chain onto a single `callChain` promise. Concurrent awaits
from test code are queued, not interleaved.

This is a deliberate policy: the MCP server is not assumed to be
concurrency-safe. It is a per-session constraint, not a global one.

If a caller knows specific tools are safe to overlap, an escape hatch is
available via `{ parallel: true }` in `invoke` options, which bypasses the
chain for that call. Default remains serial. The escape hatch is opt-in so
the safe path requires no thought.

---

## `adapters/szkrabok-session.js`

The only file in `client/` that is szkrabok-specific. Implements four
functions consumed by the invoker:

- **`open(client, sessionName)`** — calls `session.open` with `{ sessionName }`
- **`close(client, sessionName)`** — calls `session.close` with `{ sessionName }`
- **`injectSession(args, sessionName)`** — returns `{ sessionName, ...args }`
- **`hasSession(tool)`** — returns true if `tool.inputSchema.properties.sessionName` exists

`sessionName` as a wire key is defined here and nowhere else. If a future
server uses a different session parameter name, only this file changes.

`hasSession` is used by the invoker and by `runSequence` to decide whether to
inject. Tools without a `sessionName` parameter in their schema (e.g. a global
health check) are called without injection.

---

## Codegen script: `generate-mcp-tools.mjs`

Run manually after any change to `src/tools/registry.js`. Idempotent —
writes only if content changed.

Steps:
1. `spawnClient()` — open one client for the entire codegen run
2. `client.listTools()` — fetch tools
3. `client.close()` — close
4. Compute `registryHash(tools)`
5. Group tools by namespace (see namespace rules below)
6. For each tool, derive JSDoc param types from `inputSchema.properties`
   — strip `sessionName` (injected by adapter), mark optional params with `?`
7. Render file via `render-tools.js` (pure, testable separately)
8. Diff against existing `mcp-tools.js` — skip write if identical, print `No changes.`
9. Write file, print `Generated N tools.`

### `package.json` registration

```json
"codegen:mcp": "node packages/mcp-client/codegen/generate-mcp-tools.mjs"
```

Run anytime the registry changes, then commit the updated `mcp-tools.js`.
IDE autocomplete works permanently from the static committed file — no build
step, no dynamic generation at test runtime.

### Header comment in `mcp-tools.js`

```js
// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: 2026-02-24T10:00:00Z
// Tools: 34  Hash: a3f9c1d82e4b
```

The hash is also emitted as a JS constant immediately after the imports:

```js
const REGISTRY_HASH = 'a3f9c1d82e4b';
```

---

## Namespace splitting

Tool names are split on the first `.`. Everything after the first dot is the
method key — preserving nested dots:

```
session.open      → ns: "session", method: "open"
browser.run_test  → ns: "browser", method: "run_test"
browser.run_file  → ns: "browser", method: "run_file"
workflow.scrape   → ns: "workflow", method: "scrape"
```

Tools with no dot (e.g. `health`) are placed under a `_root` namespace:

```
health            → ns: "_root",   method: "health"
```

`handle._root.health(args)` is the call form. This is explicit and
unambiguous — the alternative (collapsing to `handle['']`) is a silent
footgun.

Codegen documents `_root` in the `@typedef` block. Test authors are
expected to use `_root` only for genuinely global tools.

---

## Type derivation: `schema-to-jsdoc.js`

Pure function, no IO. Input: one JSON Schema property object. Output: JSDoc
type string.

```
{ type: 'string' }                         -> 'string'
{ type: 'string', enum: ['a','b'] }        -> "'a'|'b'"
{ type: 'boolean' }                        -> 'boolean'
{ type: 'number' }                         -> 'number'
{ type: 'integer' }                        -> 'number'
{ type: 'object' }                         -> 'object'
{ type: 'array', items: { type: 'string'}} -> 'string[]'
(unknown/missing)                          -> 'any'
```

`integer` maps to `number` (JSDoc has no integer type). Kept as a separate
module so it can be unit-tested without spawning anything.

---

## Log format: `runtime/logger.js`

Every call produces two JSONL lines.

**Intent line** (emitted before the wire call):

```json
{"name":"workflow.scrape","arguments":{"sessionName":"my-session","selectors":{"title":"h1"}},"_phase":"before","_seq":3}
```

**Result line** (emitted after):

```json
{"name":"workflow.scrape","arguments":{"sessionName":"my-session","selectors":{"title":"h1"}},"_phase":"after","_ok":true,"_ms":312,"_seq":3}
```

**Failure**:

```json
{"name":"workflow.scrape","arguments":{"sessionName":"my-session","selectors":{"title":"h1"}},"_phase":"after","_ok":false,"_ms":18,"_error":"net::ERR_NAME_NOT_RESOLVED","_seq":3}
```

`_phase` makes replay unambiguous: filter `_phase === "before"`, strip
`_`-prefixed fields. There is no ambiguity about which lines to replay and
which to skip, even when piping raw log output.

`name` and `arguments` stay prominent at the start — the line reads as a
tool call first, observability metadata second.

### Replay

```js
for (const line of jsonlLines) {
  const entry = JSON.parse(line);
  if (entry._phase !== 'before') continue;
  const { _phase, _seq, ...call } = entry;
  await client.callTool(call);
}
```

The structure encodes the rule — no implicit knowledge required of the
implementer.

### Result logging — two-tier by size

MCP responses can be large (`browser.snapshot` returns a full accessibility
tree; screenshots are base64). Logging them inline destroys the readability
of the JSONL stream.

**Small result** (under ~200 chars after JSON serialisation) — inlined as
`_result`, JSON-parsed if the text content is itself JSON:

```json
{"name":"session.open","arguments":{"sessionName":"my-session"},"_phase":"after","_result":{"opened":true},"_ok":true,"_ms":84,"_seq":1}
```

**Large result** — summary inline, full content written to a sidecar file
named by sequence number and tool name:

```json
{"name":"browser.run_code","arguments":{"sessionName":"my-session","code":"async (page) => page.content()"},"_phase":"after","_result":"[text 3847 chars → .mcp-log/4-browser.run_code.txt]","_ok":true,"_ms":201,"_seq":4}
```

The sidecar path includes `_seq` so call line and result file are
unambiguously linked. An LLM that needs the full snapshot reads the file.
The JSONL stream stays scannable.

Sidecar writing is opt-in (disabled by default). The size threshold and
output directory are configurable in `runtime/logger.js`.

---

## Session lifecycle in tests

```js
import { mcpConnect } from '@szkrabok/mcp-client';

const mcp = await mcpConnect('my-session');
try {
  await mcp.workflow.scrape({ selectors: { title: 'h1' } });
  await mcp.browser.run_test({ files: ['tests/playwright/e2e/my-task.spec.js'] });
} finally {
  await mcp.close();
}
```

`mcp.close()` delegates to `adapter.close` then calls `client.close()` (with
`try/finally` so the transport is always cleaned up). The outer `finally`
block ensures Chrome is not leaked on test failure.

Playwright `test` fixture wrapper (optional, used in the spec):

```js
const mcpTest = base.extend({
  mcp: async ({}, use) => {
    const mcp = await mcpConnect('my-session');
    await use(mcp);
    await mcp.close();
  },
});

mcpTest('my test via MCP', async ({ mcp }) => {
  const result = await mcp.browser.run_test({ files: ['tests/playwright/e2e/my-task.spec.js'] });
  expect(result.passed).toBe(1);
});
```

---

## Sequences (optional)

Stored JSONL files in `packages/mcp-client/sequences/` represent reusable call sequences
without a session parameter (injected at runtime by the adapter).

```jsonl
{"name":"workflow.scrape","arguments":{"selectors":{"title":"h1"}}}
{"name":"browser.run_code","arguments":{"code":"async (page) => page.url()"}}
```

A `runSequence(mcp, filePath)` helper reads the file, calls
`adapter.hasSession(tool)` to decide whether to inject, calls each line,
returns results. Tools that have no session parameter in their schema are
called without injection.

Sequences are not required for the core library — they are an optional
higher-level convenience.

---

## What is NOT in scope

- HTTP transport (szkrabok is stdio-only)
- Argument schema validation at call time (JSON Schema is descriptive, not enforced)
- Parallel session management
- Result caching or call recording
- TypeScript compilation (JSDoc is sufficient for IDE autocomplete without a build step)
