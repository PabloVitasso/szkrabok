# Upstream Merge Guide

## Quick Merge

```bash
./merge-upstream.sh
git checkout main
git merge sync-$(date +%Y%m%d)
git push origin main --tags
```

## What It Does

1. Fetches upstream/main from microsoft/playwright-mcp
2. Creates branch from upstream
3. Applies 3 szkrabok patches:
   - core.patch (session management + stealth)
   - tools.patch (CSS selector tools)
   - registry.patch (unified tool registry)
4. Copies szkrabok entry points

## Manual Merge

```bash
git fetch upstream --tags
git checkout -b merge-upstream upstream/main
git apply patches/*.patch
git checkout main && git merge merge-upstream
```

## Conflicts

If patches fail:
```bash
git apply --3way patches/szkrabok-core.patch
# Resolve conflicts manually
git add -A && git commit
```

## Update Patches

After changing core/ or tools/:
```bash
./scripts/regenerate-patches.sh
```

## Structure

- `core/` - Szkrabok session/stealth (root level)
- `tools/` - Szkrabok tools (root level)
- `packages/playwright-mcp/` - Upstream MCP wrapper
- `patches/` - Git patches for merge automation
