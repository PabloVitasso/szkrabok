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

if command -v claude &> /dev/null; then
    echo "✓ Found Claude Code CLI"
    echo ""

    # Check if szkrabok is already installed
    if claude mcp list 2>/dev/null | grep -q "szkrabok"; then
        echo "⚠ szkrabok MCP server already configured"
        echo ""
        read -p "Reinstall (removes and re-adds)? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "Removing existing szkrabok MCP server..."
            claude mcp remove szkrabok || true
            echo ""
        else
            echo "Installation aborted."
            exit 0
        fi
    fi

    echo "Installing szkrabok MCP server..."
    claude mcp add szkrabok -- node "$SZKRABOK_DIR/szkrabok.playwright.mcp.stealth/src/index.js" --headless

    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║                  ✅ INSTALLATION COMPLETE                    ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Configuration:"
    echo "  Config file: ~/.claude.json"
    echo "  Server name: szkrabok"
    echo "  Mode: Headless (auto-detects display)"
    echo ""
    echo "Verify installation:"
    echo "  claude mcp list"
    echo "  claude mcp get szkrabok"
    echo ""
    echo "Test szkrabok:"
    echo "  cd szkrabok.playwright.mcp.stealth"
    echo "  npm start"
    echo ""
    exit 0
elif [ -f "$HOME/.config/Claude/claude_desktop_config.json" ]; then
    CONFIG_FILE="$HOME/.config/Claude/claude_desktop_config.json"
    echo "✓ Found Claude Desktop config"
else
    echo "⚠ No MCP client detected"
    echo ""
    echo "Supported clients:"
    echo "  - Claude Code CLI (claude command)"
    echo "  - Claude Desktop (~/.config/Claude/claude_desktop_config.json)"
    echo "  - VS Code with MCP extension"
    echo ""
    echo "Manual configuration saved to: szkrabok-mcp-config.json"
    cat > szkrabok-mcp-config.json <<EOC
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "$SZKRABOK_DIR/szkrabok.playwright.mcp.stealth/src/index.js",
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
SZKRABOK_EXISTS=false
if grep -q '"szkrabok"' "$CONFIG_FILE" 2>/dev/null; then
    SZKRABOK_EXISTS=true
    echo "⚠ szkrabok MCP server already configured"
    echo ""
    read -p "Reinstall (replaces existing config)? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation aborted."
        exit 0
    fi
fi

# Add szkrabok to config
if [ "$SZKRABOK_EXISTS" = true ]; then
    echo "Updating szkrabok configuration in $CONFIG_FILE"
else
    echo "Adding szkrabok to $CONFIG_FILE"
fi

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

# Remove old szkrabok entries (including szkrabok-visible if it exists)
if 'szkrabok-visible' in config['mcpServers']:
    del config['mcpServers']['szkrabok-visible']
    print("✓ Removed deprecated 'szkrabok-visible' server")

# Add/update szkrabok server
config['mcpServers']['szkrabok'] = {
    "command": "node",
    "args": [
        "$SZKRABOK_DIR/szkrabok.playwright.mcp.stealth/src/index.js",
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
echo "  1. Restart Claude Desktop"
echo "  2. The 'szkrabok' MCP server should appear in available tools"
echo "  3. Try: 'List all szkrabok sessions' or 'Open session test'"
echo ""
echo "Configuration:"
echo "  Location: $CONFIG_FILE"
echo "  Backup: $BACKUP_FILE"
echo "  Server: szkrabok (single server handles both headless/visible modes)"
echo ""
echo "Testing:"
echo "  cd szkrabok.playwright.mcp.stealth"
echo "  npm start"
echo ""
echo "Documentation:"
echo "  README.md - Installation guide"
echo "  szkrabok.playwright.mcp.stealth/examples/usage_mcp.md - Usage examples"
echo ""
