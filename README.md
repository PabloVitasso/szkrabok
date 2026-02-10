# Szkrabok - Stealth Browser Automation

## Index
- [Quick Start](#quick-start)
- [Installation](#installation)
- [MCP Configuration](#mcp-configuration)
- [Testing](#testing)
- [Available Tools](#available-tools)
- [Troubleshooting](#troubleshooting)
- [Repository Structure](#repository-structure)
- [Development](#development)

## Quick Start

### Install & Connect
```bash
cd szkrabok.playwright.mcp.stealth
npm install
cd ..
./install-mcp.sh
```

### Claude Code CLI
```bash
claude mcp add szkrabok -- node /absolute/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js --headless
```

### Claude Desktop
Edit `~/.config/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": ["/absolute/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js", "--headless"]
    }
  }
}
```

### Test Commands
```
"List all szkrabok sessions"
"Open session 'test' and navigate to https://example.com"
"Extract h1 text from session 'test'"
"Take screenshot of session 'test' and save as screenshot.png"
"Close session 'test' and save state"
```

## Installation

### Prerequisites
- Node.js >=18.0.0
- Python >=3.10 (for Crawl4AI server, optional)

### Install Steps
```bash
# 1. Navigate to repository root
cd /path/to/szkrabok

# 2. Install Playwright MCP dependencies
cd szkrabok.playwright.mcp.stealth
npm install
cd ..

# 3. Run installation script (auto-detects Claude Desktop/Code)
./install-mcp.sh
```

### Verify Installation
```bash
cd szkrabok.playwright.mcp.stealth
node src/index.js --headless          # Test server starts
npm ls @modelcontextprotocol/sdk      # Check dependencies
node src/cli.js session list          # Test CLI
```

### Manual Configuration

**Claude Code:**
```bash
claude mcp add szkrabok -- node /home/user/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js --headless
```

**Claude Desktop** (`~/.config/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": ["/absolute/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js", "--headless"],
      "env": {"HEADLESS": "true"}
    }
  }
}
```

## MCP Configuration

### Headless Mode
```bash
node src/index.js --headless        # Force headless
node src/index.js --no-headless     # Force visible
HEADLESS=true node src/index.js     # Via env var
```

Auto-detects based on `$DISPLAY` if not specified.

### Environment Options
```bash
TIMEOUT=60000 node src/index.js
VIEWPORT_WIDTH=1920 VIEWPORT_HEIGHT=1080 node src/index.js
```

## Testing

### Manual Testing
```bash
cd szkrabok.playwright.mcp.stealth
node src/index.js --headless        # Should see "Server connected via stdio"
node src/cli.js session list
node src/cli.js session inspect <id>
```

### MCP Inspector
```bash
cd szkrabok.playwright.mcp.stealth
npx @modelcontextprotocol/inspector szkrabok-playwright-mcp
```

## Available Tools

**67 tools total**

### Session (4)
session.open, session.close, session.list, session.delete

### Navigation (3)
nav.goto, nav.back, nav.forward

### Interaction (3)
interact.click, interact.type, interact.select

### Extraction (4)
extract.text, extract.html, extract.screenshot, extract.evaluate

### Workflows (3)
workflow.login, workflow.fillForm, workflow.scrape

### Wait (3)
wait.forClose, wait.forSelector, wait.forTimeout

### Playwright MCP (33+)
browser.snapshot, browser.navigate, browser.click, mouse_click_xy, mouse_move_xy, verify_*, generate_locator

All tools support 3 formats: `session.open`, `session_open`, `sessionopen`

## Troubleshooting

### "Failed to reconnect to szkrabok"
```bash
cd szkrabok.playwright.mcp.stealth
npm install
cat ~/.claude.json  # Verify path
./install-mcp.sh    # Reconfigure
```

### "Cannot find module '@modelcontextprotocol/sdk'"
```bash
cd szkrabok.playwright.mcp.stealth
npm install
```

### Puppeteer browser download fails
```bash
rm -rf ~/.cache/puppeteer
cd szkrabok.playwright.mcp.stealth
npm install
```

### Browser won't launch
```bash
node src/index.js --headless              # Option 1: headless
xvfb-run node src/index.js                # Option 2: Xvfb
export DISPLAY=:0 && node src/index.js    # Option 3: Set display
```

### Session errors
```bash
cd szkrabok.playwright.mcp.stealth
node src/cli.js session list
node src/cli.js session delete <id>
```

## Repository Structure

```
szkrabok/
├── szkrabok.playwright.mcp.stealth/    # Node.js Playwright MCP (67 tools)
│   ├── src/index.js                    # MCP server entry point
│   ├── src/cli.js                      # CLI tool
│   ├── sessions/                       # Persistent sessions
│   └── package.json
├── szkrabok.crawl4ai.mcp.stealth/     # Python Crawl4AI MCP (coming soon)
├── skills/                             # Claude skills (google-search, etc)
├── szkrabok-plugin/                    # Claude plugin definitions
├── contracts/                          # Shared MCP contracts
├── scripts/                            # Repository-level scripts
├── install-mcp.sh                      # Installation helper
└── szkrabok-mcp-config.json           # Example config
```

### File Locations
| What | Path |
|------|------|
| MCP Server | `szkrabok.playwright.mcp.stealth/src/index.js` |
| CLI Tool | `szkrabok.playwright.mcp.stealth/src/cli.js` |
| Sessions | `szkrabok.playwright.mcp.stealth/sessions/` |
| Config | `szkrabok-mcp-config.json` |

## Development

### Lint All Servers
```bash
./scripts/lint-all.sh
```

### Test All Servers
```bash
./scripts/test-all.sh
```

### Validate Contracts
```bash
./scripts/check-contracts.sh
```

### Run Playwright MCP Tests
```bash
cd szkrabok.playwright.mcp.stealth
npm test                    # All tests (17 total)
npm run test:node           # Node tests (8)
npm run test:playwright     # Playwright tests (9)
```

## Servers

### szkrabok.playwright.mcp.stealth (Node.js)
Production-grade Playwright-based browser automation with 67 tools.

**Features:**
- Persistent sessions (cookies, localStorage)
- Stealth mode (playwright-extra + puppeteer-extra-plugin-stealth)
- CSS selectors + accessibility tree interactions
- Session pooling and lifecycle management

**[View Documentation](./szkrabok.playwright.mcp.stealth/README.md)**

### szkrabok.crawl4ai.mcp.stealth (Python)
*Coming Soon* - Crawl4AI-powered intelligent scraping with LLM extraction.

**[View Documentation](./szkrabok.crawl4ai.mcp.stealth/README.md)**

## Sessions

Each server has its own sessions directory:
- Playwright: `szkrabok.playwright.mcp.stealth/sessions/`
- Crawl4AI: `szkrabok.crawl4ai.mcp.stealth/sessions/`

Sessions are server-specific and cannot be shared.

## Updating

```bash
cd szkrabok.playwright.mcp.stealth
npm install  # If package.json changed
# Restart MCP client
```

## Uninstalling

**Claude Code:**
```bash
claude mcp remove szkrabok
```

**Claude Desktop:** Remove `szkrabok` entry from config file.

**Files:**
```bash
rm -rf szkrabok.playwright.mcp.stealth/node_modules
rm -rf szkrabok.playwright.mcp.stealth/sessions
```

## Contributing
See [CONTRIBUTING.md](./CONTRIBUTING.md)

## License
MIT - See [LICENSE](./LICENSE)

## Security
See [SECURITY.md](./SECURITY.md)
