# Szkrabok Patches

This directory contains patch files for applying szkrabok's custom features on top of upstream playwright-mcp.

## Patch Files

### 1. szkrabok-core.patch (142 lines)
Core session management and stealth capabilities:
- `core/pool.js` - In-memory session pool
- `core/storage.js` - Persistent session storage
- `core/stealth.js` - Browser fingerprinting evasion

### 2. szkrabok-tools.patch (298 lines)
CSS selector-based tools and workflows:
- `tools/session.js` - Session lifecycle tools (open/close/list/delete)
- `tools/navigate.js` - Navigation tools (goto/back/forward)
- `tools/interact.js` - Interaction tools (click/type/select)
- `tools/extract.js` - Data extraction tools (text/html/screenshot/evaluate)
- `tools/wait.js` - Wait conditions (forClose/forSelector/forTimeout)
- `tools/workflow.js` - High-level workflows (login/fillForm/scrape)

### 3. szkrabok-registry.patch (783 lines)
Unified tool registry with alias system:
- `tools/registry.js` - Registers all tools with 3 alias formats
  - Dot notation: `session.open`
  - Underscore: `session_open`
  - Concatenated: `sessionopen`

## Applying Patches

### Automated (Recommended)
```bash
./migrate.sh
```

### Manual
```bash
# Start from upstream
git checkout upstream/main
git checkout -b szkrabok-enhanced

# Apply patches in order
git apply patches/szkrabok-core.patch
git add core/
git commit -m "Add core session management and stealth"

git apply patches/szkrabok-tools.patch
git add tools/
git commit -m "Add szkrabok tools"

git apply patches/szkrabok-registry.patch
git add tools/registry.js
git commit -m "Add unified tool registry"

# Copy additional files not in patches
cp ../index.js ../server.js ../cli.js ../config.js .
cp -r ../test ../utils .
git add -A
git commit -m "Add entry points, tests, and utilities"

# Update package.json
# Manually merge dependencies:
#   - playwright-extra
#   - puppeteer-extra-plugin-stealth
#   - commander, ajv, etc.

npm install
npm test
```

### Verification
After applying patches, verify:
```bash
# Check file structure
ls -la core/ tools/ utils/

# Verify imports work
node -e "require('./core/pool.js')"
node -e "require('./tools/session.js')"

# Run tests
npm test
```

## Patch Generation

These patches were generated from szkrabok v1.1 using:

```bash
# Core files
git diff --no-index /dev/null core/pool.js 2>&1 | tail -n +5 > /tmp/pool.patch
git diff --no-index /dev/null core/storage.js 2>&1 | tail -n +5 > /tmp/storage.patch
git diff --no-index /dev/null core/stealth.js 2>&1 | tail -n +5 > /tmp/stealth.patch
cat /tmp/pool.patch /tmp/storage.patch /tmp/stealth.patch > szkrabok-core.patch

# Tool files
for file in tools/*.js; do
  git diff --no-index /dev/null "$file" 2>&1 | tail -n +5 > "/tmp/$(basename "$file").patch"
done
cat /tmp/session.js.patch /tmp/navigate.js.patch /tmp/interact.js.patch \
    /tmp/extract.js.patch /tmp/wait.js.patch /tmp/workflow.js.patch > szkrabok-tools.patch

# Registry
cat /tmp/registry.js.patch > szkrabok-registry.patch
```

## Updating Patches

If szkrabok features are enhanced, regenerate patches:

```bash
# From szkrabok repository root
cd /path/to/szkrabok

# Regenerate patches
rm -rf patches/*.patch
# Run patch generation commands above

# Verify patches
git apply --check patches/szkrabok-core.patch
```

## Troubleshooting

### Patch fails to apply
```bash
# Check what's failing
git apply --check patches/szkrabok-core.patch

# Try with 3-way merge
git apply --3way patches/szkrabok-core.patch

# Or apply manually
less patches/szkrabok-core.patch
# Create files manually based on patch content
```

### Files already exist
```bash
# If upstream now has files that conflict:
# 1. Review upstream's implementation
# 2. Decide if szkrabok's version should override
# 3. Apply patch manually, resolving conflicts
```

### Dependency conflicts
```bash
# If upstream dependencies conflict with szkrabok:
# 1. Check upstream package.json
# 2. Update szkrabok's package.json to match upstream versions
# 3. Test that stealth still works with new playwright version
```

## Files NOT in Patches

These files need to be copied manually or created:

- `index.js` - Entry point
- `server.js` - MCP server setup
- `cli.js` - CLI session management
- `config.js` - Configuration
- `test/` - Test suite
- `utils/` - Utility functions
- `upstream/wrapper.js` - Browser wrapper (may conflict with upstream)

See `migrate.sh` for automated handling of these files.

---

**Generated**: 2026-02-08
**Source**: szkrabok v1.1
**Target**: playwright-mcp v0.0.66+
