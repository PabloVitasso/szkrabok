#!/bin/bash
# Simple upstream merge
set -e

BRANCH="sync-$(date +%Y%m%d)"
ROOT=$(git rev-parse --show-toplevel)
PATCHES="$ROOT/patches"
SRC="$ROOT/szkrabok.playwright.mcp.stealth/src"

# Save patches to temp
TMP=$(mktemp -d)
cp -r "$PATCHES" "$TMP/"
cp -r "$SRC" "$TMP/"

echo "→ Fetch upstream"
git fetch upstream --tags

echo "→ Create $BRANCH from upstream/main"
git checkout -b "$BRANCH" upstream/main

echo "→ Apply patches"
git apply "$TMP/patches/szkrabok-core.patch" && git add -A && git commit -m "szkrabok: core"
git apply "$TMP/patches/szkrabok-tools.patch" && git add -A && git commit -m "szkrabok: tools"
git apply "$TMP/patches/szkrabok-registry.patch" && git add -A && git commit -m "szkrabok: registry"

echo "→ Copy files"
mkdir -p packages/playwright-mcp/src
cp "$TMP/src"/{index,server,cli,config}.js packages/playwright-mcp/
cp -r "$TMP/src/utils" packages/playwright-mcp/src/
git add -A && git commit -m "szkrabok: add entry points"

rm -rf "$TMP"

echo "→ Test"
cd "$ROOT/szkrabok.playwright.mcp.stealth" && npm test

echo ""
echo "✓ Done! Merge: git checkout main && git merge $BRANCH && git push origin main"
