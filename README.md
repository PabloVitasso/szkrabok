# Szkrabok - Extended Playwright-MCP with stealth and sessions

## Features

- Persistent sessions across restarts (cookies, localStorage saved)
- Stealth mode (playwright-extra + puppeteer-extra-plugin-stealth)
- Auto-detect headless/headed mode
- CSS selectors + Playwright refs
- Session CLI tools
  
## Install in Claude Code

```bash
./install.sh --scope user        # User-wide install for Claude Code
./install.sh --scope local       # Project install for Claude Code
```

## Quick Start

```
"List all szkrabok sessions"
"Open session 'work' and go to example.com"
"Extract h1 text"
"Close session 'work'"
```

## Tools (67 total)

### Session (4)
- session.open(id, url?, config?) - create/resume with persistence
- session.close(id, save?) - save and close
- session.list() - view all
- session.delete(id) - remove

### Navigation (3)
- nav.goto(id, url) - navigate
- nav.back(id), nav.forward(id)

### Interaction (3)
- interact.click(id, selector)
- interact.type(id, selector, text)
- interact.select(id, selector, value)

### Extract (4)
- extract.text(id, selector?)
- extract.html(id, selector?)
- extract.screenshot(id, path?, fullPage?)
- extract.evaluate(id, code, args?)

### Workflows (3)
- workflow.login(id, username, password, selectors?)
- workflow.fillForm(id, fields{})
- workflow.scrape(id, selectors{})

### Wait (3)
- wait.forClose(id)
- wait.forSelector(id, selector)
- wait.forTimeout(id, ms)

### Playwright-MCP (33+)
- browser.* tools (snapshot, navigate, click, type, etc)
- Vision tools (mouse_click_xy, mouse_move_xy)
- Testing tools (verify_*, generate_locator)

All tools support 3 formats: session.open, session_open, sessionopen

## Usage Examples

### Login automation
```
"Use workflow.login in 'work' with username 'user@example.com' password 'pass123'"
```

### Data extraction
```
"Use workflow.scrape in 'work' to extract:
- title from 'h1'
- content from '.main'
- links from 'a'"
```

### Form filling
```
"Use workflow.fillForm in 'work' with:
- '#name': 'John'
- '#email': 'john@example.com'"
```

## CLI

```bash
cd szkrabok.playwright.mcp.stealth
bebok session list
bebok session inspect <id>
bebok session delete <id>
bebok cleanup --days 30
```

## Configuration

**Environment variables:**
```bash
HEADLESS=true       # Force headless
TIMEOUT=30000       # Default timeout
DISPLAY=:0          # X server display
VIEWPORT_WIDTH=1920 VIEWPORT_HEIGHT=1080
```

**CLI flags override env:**
```bash
node index.js --headless
node index.js --no-headless
```

**Sessions stored in ./sessions/{id}/:**
- state.json - cookies, localStorage, sessionStorage
- meta.json - timestamps, config, lastUrl

## Architecture

```
LLM -> MCP Server -> Session Pool -> Playwright + Stealth
                      |
                 File Storage (./sessions/)
```

**Components:**
- core/ - Session management, stealth, storage
- tools/ - MCP tools (session, nav, interact, extract, workflow)
- upstream/ - Browser wrapper
- utils/ - Errors, logging
- tests/ - Playwright + Node tests

## Testing

```bash
cd szkrabok.playwright.mcp.stealth
npm test              # All tests (17 total)
npm run test:node    # Node tests (8)
npm run test:playwright  # Playwright tests (9)
```

## Troubleshooting

### Common issues

**Browser not launching:**
```bash
npx playwright install chromium
echo $DISPLAY  # Check display variable
```

**Stealth detection:**
```bash
npm test test/scrap.test.js
```

**Session not persisting:**
```bash
ls -la sessions/
cat sessions/[id]/meta.json
```

**Tools not appearing:**
- Restart MCP client
- Verify config syntax
- Test manually: npm start

### Debug commands
```bash
npm start                    # Test server
npx @modelcontextprotocol/inspector szkrabok
tail -f logs/szkrabok.log
npm list playwright
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
├── contracts/                           # Shared MCP contracts
├── scripts/                             # Repository-level scripts
├── install.sh                           # Installation helper
└── CONTRIBUTING.md, SECURITY.md, LICENSE
```

## See Also

- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [SECURITY.md](./SECURITY.md) - Security policy
