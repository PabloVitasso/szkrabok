#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$SCRIPT_DIR"

cleanup() {
  echo "=== Cleanup: Removing from all scopes ==="
  claude mcp remove szkrabok --scope local 2>/dev/null || true
  claude mcp remove szkrabok --scope user 2>/dev/null || true
  echo "Cleanup complete"
  echo ""
}

trap cleanup EXIT

cleanup

echo "=== Test 1: Clean install to local scope ==="
./install-local.sh
echo ""

echo "=== Test 2: Clean install to user scope ==="
cleanup
./install-user.sh
echo ""

echo "=== Test 3: Install local with --clean-all when user exists ==="
./install.sh --scope local --clean-all
echo ""

echo "=== Test 4: Verify current state ==="
claude mcp get szkrabok 2>&1 | grep "Scope:"

echo ""
echo "=== All tests passed! ==="
