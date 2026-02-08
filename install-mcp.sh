#!/bin/bash
# Szkrabok MCP Installation Helper
# This script helps configure szkrabok for your MCP client

set -e

SZKRABOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE=""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║           📦 SZKRABOK MCP INSTALLER                         ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Detect MCP client
echo "Detecting MCP client..."

if [ -f "$HOME/.config/Claude/claude_desktop_config.json" ]; then
    CONFIG_FILE="$HOME/.config/Claude/claude_desktop_config.json"
    echo "✓ Found Claude Desktop config"
elif command -v claude &> /dev/null; then
    echo "✓ Found Claude Code CLI"
    echo ""
    echo "Run this command to install:"
    echo "  claude mcp add szkrabok node $SZKRABOK_DIR/index.js --headless"
    exit 0
else
    echo "⚠ No MCP client detected"
    echo ""
    echo "Supported clients:"
    echo "  - Claude Desktop (~/.config/Claude/claude_desktop_config.json)"
    echo "  - Claude Code CLI (claude command)"
    echo "  - VS Code with MCP extension"
    echo ""
    echo "Manual configuration saved to: szkrabok-mcp-config.json"
    cat > szkrabok-mcp-config.json <<EOC
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "$SZKRABOK_DIR/index.js",
        "--headless"
      ]
    }
  }
}
EOC
    exit 1
fi

# Backup existing config
if [ -f "$CONFIG_FILE" ]; then
    BACKUP_FILE="${CONFIG_FILE}.backup.$(date +%Y%m%d-%H%M%S)"
    echo "Creating backup: $BACKUP_FILE"
    cp "$CONFIG_FILE" "$BACKUP_FILE"
fi

# Check if szkrabok already configured
if grep -q '"szkrabok"' "$CONFIG_FILE" 2>/dev/null; then
    echo "⚠ 'szkrabok' already exists in config"
    echo ""
    read -p "Replace existing configuration? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Add szkrabok to config
echo "Adding szkrabok to $CONFIG_FILE"

python3 << PYTHON
import json
import sys

config_file = "$CONFIG_FILE"

try:
    with open(config_file, 'r') as f:
        config = json.load(f)
except:
    config = {}

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['szkrabok'] = {
    "command": "node",
    "args": [
        "$SZKRABOK_DIR/index.js",
        "--headless"
    ]
}

with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)

print("✓ Configuration updated")
PYTHON

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║                  ✅ INSTALLATION COMPLETE                    ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Restart your MCP client (Claude Desktop, VS Code, etc.)"
echo "  2. The 'szkrabok' server should appear in available tools"
echo "  3. Try: session.list(), session.open(), etc."
echo ""
echo "Configuration:"
echo "  Location: $CONFIG_FILE"
echo "  Backup: $BACKUP_FILE"
echo "  Mode: Headless (auto-detects display)"
echo ""
echo "Testing:"
echo "  Manual test: npm start"
echo "  Inspector: npx @modelcontextprotocol/inspector szkrabok"
echo ""
echo "Documentation:"
echo "  README.md - Usage guide"
echo "  QUICK_REFERENCE.md - Commands"
echo "  FINAL_SUMMARY.md - Features overview"
echo ""
