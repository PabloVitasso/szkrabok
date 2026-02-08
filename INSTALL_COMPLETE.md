# Szkrabok MCP Installation - Complete Guide

## Quick Start (Choose One)

### 🚀 Automatic Installation (Easiest)
```bash
cd /home/jones2/mega/research/szkrabok
./install-mcp.sh
```

### 🎯 Manual Installation

**For Claude Desktop:**
```bash
# Edit config file
nano ~/.config/Claude/claude_desktop_config.json

# Add this section:
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--headless"
      ]
    }
  }
}

# Restart Claude Desktop
```

**For Claude Code CLI:**
```bash
claude mcp add szkrabok node /home/jones2/mega/research/szkrabok/index.js --headless
```

**For VS Code:**
```json
// settings.json
{
  "mcp.servers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--headless"
      ]
    }
  }
}
```

## Verification

After installation, restart your MCP client and test:

1. **Check server is loaded**
   - Claude Desktop: Look for "szkrabok" in tools
   - VS Code: Check MCP status bar

2. **Test basic command**
   ```
   Ask: "List all szkrabok sessions"
   Expected: Empty list or existing sessions
   ```

3. **Test session creation**
   ```
   Ask: "Open a szkrabok session called 'demo' and go to example.com"
   Expected: Session created, page loaded
   ```

## Configuration Saved

A configuration file has been created at:
- `szkrabok-mcp-config.json` (in this directory)

You can copy-paste this into your MCP client config.

## Features Available

### ✨ 67 Total Tools

**Session Management (4)**
- `session.open` - Create/resume sessions with persistence
- `session.close` - Save and close sessions
- `session.list` - View all active/stored sessions
- `session.delete` - Remove sessions permanently

**Browser Automation (40+)**
- CSS selector tools (interact, navigate, extract)
- Playwright-MCP tools (browser.*, ref-based)
- Vision tools (coordinate-based clicking)
- Testing tools (verify, assert)

**Workflows (3)**
- `workflow.login` - Automated login
- `workflow.fillForm` - Bulk form filling
- `workflow.scrape` - Data extraction

**Wait Conditions (3)**
- Smart waiting for elements and timeouts

### 🎭 Stealth Mode
- Browser fingerprinting evasion
- Persistent sessions across restarts
- Cookies & localStorage preservation

## Documentation

- **QUICK_REFERENCE.md** - Command cheat sheet
- **FINAL_SUMMARY.md** - Complete feature overview
- **README.md** - Full user guide
- **examples/** - Usage examples

## Troubleshooting

### Server doesn't start
```bash
# Test manually
npm start

# Check logs
tail -f logs/szkrabok.log
```

### Tools not appearing
1. Restart MCP client completely
2. Check config file syntax (valid JSON)
3. Verify node path: `which node`

### Permission errors
```bash
# Ensure execute permission
chmod +x index.js
```

## Support

- **Issues**: GitHub Issues
- **Docs**: See MIGRATION_INDEX.md
- **Tests**: Run `npm test`

---

**Installation Path**: `/home/jones2/mega/research/szkrabok`
**Node Version Required**: >=18.0.0
**Status**: ✅ Ready to use
