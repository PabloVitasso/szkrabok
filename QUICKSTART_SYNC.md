# Quick Start: Syncing with Upstream

This guide provides a fast-track overview for syncing szkrabok with the latest upstream playwright-mcp.

## TL;DR

```bash
# 1. Backup current state
git tag v1.1-pre-sync
git checkout -b backup-main

# 2. Run migration
git checkout main
./migrate.sh

# 3. Test
npm install
npm test

# 4. Manual validation
npm start &
node cli.js session open test --url https://bot.sannysoft.com/
# Wait 20 seconds, take screenshot, verify stealth works

# 5. Merge if successful
git checkout main
git merge sync-upstream-$(date +%Y%m%d)
git tag v1.2-upstream-sync
```

## Prerequisites

- [x] Git repository with `upstream` remote configured
- [x] Clean working tree (no uncommitted changes)
- [x] Node.js 18+ installed
- [x] Patches generated (in `patches/` directory)

## Step-by-Step

### 1. Understand What Changed

Read the key documents:
- **SYNC_STRATEGY.md** - Overall migration strategy and reasoning
- **DEVELOPMENT.md** - Szkrabok feature inventory
- **TEST_PLAN.md** - Comprehensive test plan

Quick summary:
- Upstream moved to monorepo structure
- Upstream now uses Playwright's built-in MCP (`playwright/lib/mcp/index`)
- Szkrabok features are being transplanted onto new upstream base

### 2. Backup Current State

```bash
# Tag current state
git tag v1.1-pre-sync

# Create backup branch
git checkout -b backup-main
git checkout main
```

### 3. Run Migration Script

```bash
# Dry run first (no changes made)
./migrate.sh --dry-run

# If dry run looks good, run for real
./migrate.sh
```

**What the script does**:
1. Fetches latest upstream
2. Creates migration branch from upstream/main
3. Applies szkrabok patches
4. Copies additional files
5. Prompts for package.json merge
6. Runs tests

### 4. Manual Steps (if migration script fails)

If automated migration fails, follow manual approach:

```bash
# Create migration branch
git checkout -b sync-upstream-manual upstream/main

# Apply patches
git apply patches/szkrabok-core.patch
git apply patches/szkrabok-tools.patch
git apply patches/szkrabok-registry.patch

# Copy additional files
cp -r backup-main/index.js .
cp -r backup-main/server.js .
cp -r backup-main/cli.js .
cp -r backup-main/config.js .
cp -r backup-main/test .
cp -r backup-main/utils .

# Merge package.json manually
# Open both package.json files and combine:
#   - Upstream: base dependencies
#   - Szkrabok: add playwright-extra, stealth plugin, commander, ajv

npm install
npm test
```

### 5. Resolve Conflicts

Common conflicts and solutions:

#### package.json
```json
{
  "name": "szkrabok-playwright-mcp",
  "version": "1.2.0",
  "dependencies": {
    "@playwright/mcp": "^0.0.66",              // From upstream
    "playwright": "1.59.0-alpha-1770400094000", // Match upstream
    "playwright-core": "1.59.0-alpha-1770400094000",
    "playwright-extra": "^4.3.6",              // Szkrabok
    "puppeteer": "^24.34.0",                   // Szkrabok (for stealth)
    "puppeteer-extra-plugin-stealth": "^2.11.2", // Szkrabok
    "commander": "^12.0.0",                    // Szkrabok (CLI)
    "ajv": "^8.17.1",                          // Szkrabok (tests)
    "ajv-formats": "^3.0.1"                    // Szkrabok (tests)
  },
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "test": "node --test test/*.test.js",
    "lint": "eslint .",
    "format": "prettier --write ."
  }
}
```

#### tools/playwright_mcp.js
If upstream @playwright/mcp API changed:
1. Check new API: `npm info @playwright/mcp`
2. Update wrapper to match new interface
3. Test with `npm test test/playwright_mcp.test.js`

#### upstream/wrapper.js vs Playwright's browser management
If conflict:
1. Check if Playwright's built-in MCP manages browser lifecycle
2. If yes, adapt szkrabok to use Playwright's browser
3. If no, keep szkrabok's wrapper.js

### 6. Testing

Run comprehensive tests:

```bash
# Unit tests
npm test test/basic.test.js      # Pool and storage
npm test test/schema.test.js     # Schema validation

# Integration tests
npm test test/playwright_mcp.test.js  # Upstream tools
npm test test/scrap.test.js           # Stealth

# Manual tests
npm start &
SERVER_PID=$!

node cli.js session list
node cli.js session open manual-test --url https://example.com
node cli.js session inspect manual-test
node cli.js session delete manual-test

# Stealth validation
node cli.js session open stealth --url https://bot.sannysoft.com/
# Wait 20 seconds, screenshot, check results
node cli.js session delete stealth

kill $SERVER_PID
```

### 7. Validation Checklist

Before merging:

- [ ] All tests pass (`npm test`)
- [ ] Server starts without errors (`npm start`)
- [ ] Session persistence works (survives server restart)
- [ ] Stealth evades bot detection (sannysoft.com)
- [ ] CSS selector tools work (interact.click, extract.text, etc.)
- [ ] Workflow tools work (workflow.login, workflow.scrape)
- [ ] Upstream tools work (if still exposed)
- [ ] CLI works (session list/inspect/delete/cleanup)
- [ ] MCP Inspector connects (`npx @modelcontextprotocol/inspector szkrabok-playwright-mcp`)

### 8. Merge & Tag

If all tests pass:

```bash
# Merge migration branch
git checkout main
git merge sync-upstream-$(date +%Y%m%d)

# Tag release
git tag v1.2-upstream-sync

# Push (if using remote)
git push origin main
git push origin v1.2-upstream-sync

# Clean up migration branch (optional)
git branch -d sync-upstream-$(date +%Y%m%d)
```

### 9. Update Documentation

After successful merge:

```bash
# Update README.md with any new installation steps
# Update CLAUDE.md with architecture changes
# Update CHANGELOG.md with migration notes

git add README.md CLAUDE.md CHANGELOG.md
git commit -m "docs: update for upstream sync v1.2"
```

## Rollback

If migration fails or introduces regressions:

```bash
# Return to pre-sync state
git checkout main
git reset --hard v1.1-pre-sync

# Or use backup branch
git checkout backup-main
git branch -D main
git checkout -b main
```

## Troubleshooting

### Tests fail after migration

1. Check which test failed
2. Review test output for error details
3. Common issues:
   - Import paths changed (update requires/imports)
   - Tool signatures changed (update tool calls)
   - Schema format changed (update schemas in registry.js)

### Stealth broken

1. Check puppeteer-extra-plugin-stealth version compatibility
2. Verify playwright-extra works with new Playwright version
3. Test manually: `npm test test/scrap.test.js`
4. If broken, pin to known-good Playwright version

### Performance regression

1. Profile with `node --prof index.js`
2. Check if upstream added heavy operations
3. Consider lazy initialization for expensive resources

### Upstream tools not working

1. Verify @playwright/mcp version in package.json
2. Check if API changed: `npm info @playwright/mcp`
3. Update tools/playwright_mcp.js wrapper
4. Test with: `npm test test/playwright_mcp.test.js`

## Next Steps

After successful sync:

1. Monitor for issues in production use
2. Document any quirks in CLAUDE.md
3. Plan next sync (recommend every 5-10 upstream releases)
4. Consider contributing szkrabok features upstream

## Getting Help

- **SYNC_STRATEGY.md** - Detailed migration strategy
- **DEVELOPMENT.md** - Szkrabok feature documentation
- **TEST_PLAN.md** - Comprehensive testing guide
- **GitHub Issues** - Report bugs or ask questions

---

**Last Updated**: 2026-02-08
**Upstream Target**: v0.0.66
**Szkrabok Version**: v1.2 (post-sync)
