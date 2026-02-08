# Szkrabok Upstream Sync Strategy

## Executive Summary

**Problem**: Szkrabok forked playwright-mcp (now at v0.0.66) and added session management, stealth, and CSS selector tools. The upstream has undergone a major architectural change, moving to a monorepo structure with Playwright's built-in MCP support.

**Recommendation**: **Transplant approach** - Apply szkrabok features as an enhancement layer on top of upstream's latest version rather than attempting a traditional merge.

**Why not merge?**: The upstream has fundamentally changed from a custom MCP implementation to a thin wrapper around Playwright's built-in MCP (`playwright/lib/mcp/index`). A merge would require resolving conflicts in code that no longer exists in upstream.

---

## Upstream Architectural Changes

### Old Structure (what szkrabok forked from)
```
szkrabok/
├── index.js          # Custom MCP server
├── server.js         # MCP stdio transport
├── config.js         # Configuration
├── tools/            # Custom tool implementations
└── core/             # Browser management
```

### New Upstream Structure (v0.0.66)
```
playwright-mcp/
├── packages/
│   ├── playwright-mcp/       # Main MCP package
│   │   ├── index.js          # Thin wrapper: require('playwright/lib/mcp/index')
│   │   ├── cli.js            # CLI entry point
│   │   └── tests/            # Playwright test suite
│   ├── extension/            # Browser extension
│   └── playwright-cli-stub/  # CLI stub
├── roll.js                   # Dependency updater
└── README.md                 # Installation guide
```

**Key Change**: Upstream now delegates to Playwright's built-in MCP implementation instead of maintaining a custom server.

---

## Szkrabok Feature Inventory

### Core Session Management
- **core/pool.js** (31 lines) - In-memory session tracking
- **core/storage.js** (61 lines) - Persistent session state (./sessions/{id}/)
- **tools/session.js** (104 lines) - MCP tools: open/close/list/delete

**Value Proposition**: Sessions survive server restarts. Cookies, localStorage, sessionStorage persisted to disk.

### Stealth Capabilities
- **core/stealth.js** (41 lines) - playwright-extra + puppeteer-extra-plugin-stealth
- **upstream/wrapper.js** (86 lines) - Browser singleton with stealth integration

**Value Proposition**: Bypass bot detection via fingerprint evasion.

### CSS Selector Tools
- **tools/interact.js** (23 lines) - click/type/select via CSS selectors
- **tools/navigate.js** (27 lines) - goto/back/forward
- **tools/extract.js** (35 lines) - text/html/screenshot/evaluate
- **tools/wait.js** (29 lines) - waitForClose/waitForSelector/waitForTimeout

**Value Proposition**: Simpler than accessibility tree refs for common use cases.

### High-Level Workflows
- **tools/workflow.js** (66 lines) - login/fillForm/scrape abstractions

**Value Proposition**: Common automation patterns as single tool calls.

### Tool Registry
- **tools/registry.js** (782 lines) - Unified registry with alias system
- **tools/playwright_mcp.js** (586 lines) - Wrapped upstream tools

**Value Proposition**: Combines szkrabok tools + upstream tools with 3 alias formats (dot, underscore, concatenated).

### Configuration & CLI
- **config.js** (57 lines) - Environment-based configuration
- **cli.js** (123 lines) - Session management CLI (list/inspect/delete/cleanup)
- **index.js** (27 lines) - Entry point with CLI arg parsing
- **server.js** (40 lines) - MCP server setup

### Utilities
- **utils/errors.js** (36 lines) - Custom error classes
- **utils/logger.js** (46 lines) - Structured logging

### Tests
- **test/basic.test.js** - Pool and storage unit tests
- **test/schema.test.js** - JSON schema validation for all tools
- **test/playwright_mcp.test.js** - Integration test with upstream tools
- **test/scrap.test.js** - Stealth validation (bot.sannysoft.com)

---

## Migration Strategy: The Transplant Approach

### Phase 1: Understand Upstream's Built-in MCP

**Action**: Study Playwright's built-in MCP implementation

```bash
# Clone latest Playwright to examine /lib/mcp/
git clone https://github.com/microsoft/playwright.git /tmp/playwright
cd /tmp/playwright
git checkout v1.59.0-alpha-1770400094000
find packages/playwright-core/src/server/mcp -name "*.ts"
```

**Key Questions**:
- Does Playwright's built-in MCP support custom tools?
- Can we extend `createConnection()` with additional tools?
- How does Playwright manage browser contexts internally?

### Phase 2: Choose Integration Point

**Option A: Wrap Playwright's MCP Connection**
```javascript
// szkrabok-index.js
const { createConnection } = require('playwright/lib/mcp/index')
const szkrabokTools = require('./tools/registry')

const connection = createConnection()
// Extend connection with szkrabok tools
szkrabokTools.register(connection)
```

**Option B: Standalone MCP Server** (current approach)
```javascript
// Keep szkrabok as separate MCP server
// Use both: @playwright/mcp + szkrabok-playwright-mcp
```

**Recommendation**: Start with **Option B** (standalone) for backward compatibility, then explore **Option A** once Playwright's extension points are understood.

### Phase 3: Update Dependencies

**package.json changes**:
```json
{
  "dependencies": {
    "@playwright/mcp": "^0.0.66",              // NEW: Use upstream as dependency
    "playwright": "1.59.0-alpha-1770400094000", // Match upstream version
    "playwright-extra": "^4.3.6",              // Keep for stealth
    "puppeteer-extra-plugin-stealth": "^2.11.2", // Keep for stealth
    "ajv": "^8.17.1",                          // Keep for tests
    "commander": "^..."                         // Keep for CLI
  }
}
```

### Phase 4: Update tools/playwright_mcp.js

**Current**: Imports tools from old @playwright/mcp package
**New**: Import from updated @playwright/mcp or re-implement wrapper

```javascript
// tools/playwright_mcp.js - Updated approach
const { createConnection } = require('@playwright/mcp')
const pool = require('../core/pool')

// Wrap upstream tools to use szkrabok session pool
// ... (adapt to new API)
```

### Phase 5: Test Migration

Update tests to work with new upstream:

1. **test/basic.test.js** - No changes needed (tests pool/storage only)
2. **test/schema.test.js** - May need updates if tool schema format changed
3. **test/playwright_mcp.test.js** - Update imports, verify ref system still works
4. **test/scrap.test.js** - No changes needed (tests stealth)

### Phase 6: Documentation Updates

- Update README.md with new installation instructions
- Update CLAUDE.md with new architecture
- Keep DEVELOPMENT.md as transplant recipe
- Archive old upstream docs to docs/archive/

---

## Step-by-Step Migration Plan

### Step 1: Create Migration Branch
```bash
git checkout -b sync-upstream-v0.0.66
git fetch upstream
```

### Step 2: Apply Patches Incrementally

**Patch files created** (in `/patches/`):
- `szkrabok-core.patch` - pool.js, storage.js, stealth.js
- `szkrabok-tools.patch` - session.js, navigate.js, interact.js, extract.js, wait.js, workflow.js
- `szkrabok-registry.patch` - registry.js

**Application strategy**:
```bash
# Start with clean upstream
git checkout upstream/main
git checkout -b szkrabok-enhanced

# Apply patches in order
git apply patches/szkrabok-core.patch
git apply patches/szkrabok-tools.patch
git apply patches/szkrabok-registry.patch

# Manually integrate entry points
# (index.js, server.js, cli.js, config.js)
```

### Step 3: Resolve Integration Points

**File conflicts to resolve manually**:

1. **package.json** - Merge dependencies, scripts, metadata
2. **index.js** - Decide between Playwright's CLI vs szkrabok's CLI
3. **.gitignore** - Merge ignore patterns
4. **README.md** - Document szkrabok features on top of upstream

**New files to create**:
- `szkrabok-wrapper.js` - Integration layer if using Option A
- `MIGRATION.md` - Document this specific migration for future reference

### Step 4: Update Tests

```bash
# Run existing tests
npm test

# Fix any broken imports or API changes
# Update test/playwright_mcp.test.js if upstream tool signatures changed
```

### Step 5: Validate Stealth

```bash
# Critical: Ensure stealth still works
npm test -- test/scrap.test.js

# Manual verification
node cli.js session open stealth-test --url https://bot.sannysoft.com/
# Inspect screenshot.png for detection results
```

### Step 6: Update CI/CD

If upstream has GitHub Actions:
```bash
# Review upstream's .github/workflows/ci.yml
git show upstream/main:.github/workflows/ci.yml

# Adapt for szkrabok tests
```

---

## Rollback Plan

If migration fails or introduces regressions:

1. **Keep current main branch** as `szkrabok-v1-stable`
2. **Tag current state**: `git tag v1.1-pre-sync`
3. **Document issues** in GitHub issues for future attempts
4. **Continue maintaining v1.x** until upstream stabilizes

---

## Long-Term Maintenance Strategy

### Option 1: Periodic Manual Transplants
- Every N upstream releases, re-apply szkrabok patches
- Maintain DEVELOPMENT.md as living transplant recipe
- Update patches when szkrabok features evolve

### Option 2: Contribute Upstream
- Propose session management to microsoft/playwright-mcp
- Submit stealth as optional plugin
- Upstream accepts or rejects szkrabok features

### Option 3: Diverge Permanently
- Rename to avoid confusion (szkrabok-mcp vs playwright-mcp)
- Maintain as independent project
- Cherry-pick upstream fixes as needed

**Recommendation**: Start with **Option 1** for next 2-3 upstream releases. If transplants become painful, switch to **Option 3**.

---

## Testing Checklist

After migration, verify:

- [ ] Session persistence works (open → close → server restart → resume)
- [ ] Stealth evades bot detection (bot.sannysoft.com test)
- [ ] CSS selector tools work (interact.click, extract.text, etc.)
- [ ] Workflow tools work (workflow.login on example site)
- [ ] Playwright-MCP ref system still works (browser.snapshot, ref clicking)
- [ ] CLI session management works (list/inspect/delete/cleanup)
- [ ] All tests pass (`npm test`)
- [ ] MCP Inspector works (`npx @modelcontextprotocol/inspector szkrabok-playwright-mcp`)

---

## Dependencies Analysis

### Added by Szkrabok (keep)
```json
{
  "playwright-extra": "^4.3.6",
  "puppeteer": "^24.34.0",
  "puppeteer-extra-plugin-stealth": "^2.11.2",
  "commander": "^...",
  "ajv": "^8.17.1",
  "ajv-formats": "^3.0.1"
}
```

### Upstream (update to match)
```json
{
  "playwright": "1.59.0-alpha-1770400094000",
  "playwright-core": "1.59.0-alpha-1770400094000"
}
```

### No longer needed (remove)
```json
{
  "@modelcontextprotocol/sdk": "...",  // If upstream handles this
  // Check upstream package.json for full list
}
```

---

## File-by-File Migration Guide

| Szkrabok File | Action | Notes |
|---------------|--------|-------|
| `core/pool.js` | **KEEP** | No upstream equivalent, core to session management |
| `core/storage.js` | **KEEP** | No upstream equivalent, disk persistence |
| `core/stealth.js` | **KEEP** | No upstream equivalent, stealth feature |
| `tools/session.js` | **KEEP** | No upstream equivalent, session lifecycle tools |
| `tools/interact.js` | **KEEP** | CSS selector alternative to upstream refs |
| `tools/navigate.js` | **KEEP** | CSS selector alternative to upstream refs |
| `tools/extract.js` | **KEEP** | CSS selector alternative to upstream refs |
| `tools/wait.js` | **KEEP** | Additional wait conditions |
| `tools/workflow.js` | **KEEP** | High-level abstractions |
| `tools/registry.js` | **ADAPT** | Update to register new upstream tools + szkrabok tools |
| `tools/playwright_mcp.js` | **REPLACE** | Rewrite to wrap new @playwright/mcp@0.0.66 |
| `upstream/wrapper.js` | **REVIEW** | May conflict with Playwright's built-in browser management |
| `config.js` | **MERGE** | Upstream may have JSON config, merge approaches |
| `cli.js` | **KEEP** | Szkrabok-specific session CLI |
| `index.js` | **ADAPT** | Entry point needs to use new upstream connection |
| `server.js` | **ADAPT** | May need to delegate to Playwright's MCP server |
| `utils/errors.js` | **KEEP** | Szkrabok-specific error handling |
| `utils/logger.js` | **KEEP** | Szkrabok-specific logging |
| `test/*.js` | **UPDATE** | Fix imports, adapt to new API signatures |

---

## Questions to Research Before Migration

1. **Does Playwright's built-in MCP support custom tools?**
   - If yes, use Extension API
   - If no, run as separate MCP server

2. **How does upstream manage browser contexts?**
   - If using persistent user-data-dir, conflicts with szkrabok storage
   - If using in-memory only, szkrabok adds value

3. **What tools does upstream v0.0.66 provide?**
   - List all tools from @playwright/mcp@latest
   - Compare with szkrabok's tools/playwright_mcp.js
   - Identify overlaps and gaps

4. **Has upstream's ref system changed?**
   - Test playwright_mcp.test.js against new upstream
   - Update if snapshot format changed

5. **Does upstream now have session management?**
   - Check if `user-data-dir` persistence is built-in
   - If yes, szkrabok needs to integrate or override

---

## Success Criteria

Migration is successful when:

1. All szkrabok features work on top of latest upstream
2. Upstream bugs/improvements flow into szkrabok automatically (via dependency updates)
3. Tests pass (100% coverage maintained)
4. Documentation accurately reflects new architecture
5. Users can upgrade without breaking changes (backward compatibility)

---

## Appendix: Patch Files

Generated patches are in `/patches/`:

1. **szkrabok-core.patch** (4.2K)
   - core/pool.js
   - core/storage.js
   - core/stealth.js

2. **szkrabok-tools.patch** (8.0K)
   - tools/session.js
   - tools/navigate.js
   - tools/interact.js
   - tools/extract.js
   - tools/wait.js
   - tools/workflow.js

3. **szkrabok-registry.patch** (20K)
   - tools/registry.js

**Usage**:
```bash
git apply patches/szkrabok-core.patch
# Review, test, commit
git apply patches/szkrabok-tools.patch
# Review, test, commit
git apply patches/szkrabok-registry.patch
# Review, test, commit
```

---

## References

- **Upstream Repository**: https://github.com/microsoft/playwright-mcp
- **Upstream v0.0.66**: [Release Notes](https://github.com/microsoft/playwright-mcp/releases/tag/v0.0.66)
- **Playwright MCP Docs**: https://playwright.dev (check for /mcp section)
- **Szkrabok DEVELOPMENT.md**: Transplant recipe and feature inventory
- **Szkrabok README.md**: User-facing documentation

---

**Last Updated**: 2026-02-08
**Upstream Version**: v0.0.66
**Szkrabok Version**: v1.1 (pre-sync)
