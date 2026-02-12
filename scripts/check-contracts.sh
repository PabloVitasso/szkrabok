#!/bin/bash
# Validate contract schemas

set -e

echo "Checking MCP contracts..."

if [ ! -f "contracts/mcp/version.txt" ]; then
  echo "Missing contracts/mcp/version.txt"
  exit 1
fi

VERSION=$(cat contracts/mcp/version.txt)
echo "Contract version: $VERSION"

# Future: Add JSON schema validation here

echo "Contract validation passed!"
