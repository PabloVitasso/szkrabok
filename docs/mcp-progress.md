# MCP Client Library Implementation Progress

## Overview
Implementation of `@docs/mcp-client-library.md` — a reusable library for calling szkrabok MCP tools from Playwright tests.

## Breaking Schema Changes Completed

### 1. Rename `id` → `sessionName` in all tool schemas ✓
All szkrabok tools now use `sessionName` instead of `id`

### 2. Rename `config` → `launchOptions` in `session.open` ✓
Expanded sub-properties for IDE autocomplete

---

## Task List

### Phase 1: Schema Changes ✓ COMPLETE

- [x] 1.1 Rename `id` → `sessionName` in all szkrabok tool schemas
- [x] 1.2 Rename `config` → `launchOptions` in `session.open`, expand sub-properties

### Phase 2: Tool Implementation Updates ✓ COMPLETE

- [x] 2.1 Update `src/tools/szkrabok_session.js` - use `sessionName`
- [x] 2.2 Update `src/tools/navigate.js` - use `sessionName`
- [x] 2.3 Update `src/tools/interact.js` - use `sessionName`
- [x] 2.4 Update `src/tools/extract.js` - use `sessionName`
- [x] 2.5 Update `src/tools/workflow.js` - use `sessionName`
- [x] 2.6 Update `src/tools/playwright_mcp.js` - use `sessionName`
- [x] 2.7 Update `src/tools/szkrabok_browser.js` - use `sessionName`

### Phase 3: Client Library Files ✓ COMPLETE

- [x] 3.1 Create `client/runtime/transport.js` - spawnClient()
- [x] 3.2 Create `client/runtime/invoker.js` - createCallInvoker()
- [x] 3.3 Create `client/runtime/logger.js` - createLogger()
- [x] 3.4 Create `client/adapters/szkrabok-session.js` - session adapter
- [x] 3.5 Create `client/codegen/schema-to-jsdoc.js` - type derivation
- [x] 3.6 Create `client/codegen/render-tools.js` - file renderer
- [x] 3.7 Create `client/codegen/generate-mcp-tools.mjs` - codegen entry
- [x] 3.8 Run codegen to generate `client/mcp-tools.js` ✓

### Phase 4: Testing ✓ COMPLETE

- [x] 4.1 Test registry changes with MCP server
  - `session.open { sessionName, launchOptions }` ✓
  - `nav.goto { sessionName, url }` ✓
  - `session.close { sessionName, save }` ✓

---

## Files Changed

### Modified (Schema & Implementation)
- `src/tools/registry.js` - `id` → `sessionName`, `config` → `launchOptions`
- `src/tools/szkrabok_session.js` - sessionName + launchOptions
- `src/tools/navigate.js` - sessionName
- `src/tools/interact.js` - sessionName
- `src/tools/extract.js` - sessionName
- `src/tools/workflow.js` - sessionName
- `src/tools/playwright_mcp.js` - sessionName
- `src/tools/szkrabok_browser.js` - sessionName
- `src/tools/wait.js` - sessionName

### New (Client Library)
- `client/runtime/transport.js`
- `client/runtime/invoker.js`
- `client/runtime/logger.js`
- `client/adapters/szkrabok-session.js`
- `client/codegen/schema-to-jsdoc.js`
- `client/codegen/render-tools.js`
- `client/codegen/generate-mcp-tools.mjs`
- `client/mcp-tools.js` (generated)

### Config
- `package.json` - Added `codegen:mcp` script

---

## Usage

After schema changes, existing MCP callers need to update:
- `id` → `sessionName`
- `config` → `launchOptions`

Example:
```json
// Before
{ "id": "my-session", "config": { "headless": true } }

// After
{ "sessionName": "my-session", "launchOptions": { "headless": true } }
```
