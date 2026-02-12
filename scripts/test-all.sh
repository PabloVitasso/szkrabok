#!/bin/bash
# Test all servers in the monorepo

set -e

echo "Testing Playwright server..."
cd szkrabok.playwright.mcp.stealth
npm run test:node
cd ..

echo "All tests passed!"
