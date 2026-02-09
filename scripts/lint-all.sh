#!/bin/bash
# Lint all servers in the monorepo

set -e

echo "🔍 Linting Playwright server..."
cd szkrabok.playwright.mcp.stealth
npm run lint
cd ..

echo "✅ All linting checks passed!"
