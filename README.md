# SZKRABOK-PLAYWRIGHT-MCP

Production-grade MCP browser automation with persistent sessions and stealth.

## Install

```bash
npm install
npm run prepare
```

## Run

```bash
# Standalone
npm start

# With MCP Inspector
npx @modelcontextprotocol/inspector szkrabok-playwright-mcp

# Configure in Claude Desktop
# Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": ["/path/to/szkrabok-playwright-mcp/index.js"]
    }
  }
}
```

## Tools

### Session Management
- `session.open` - create/resume session (id, url?, config?)
- `session.close` - close session (id, save?)
- `session.list` - list all sessions ()
- `session.delete` - delete permanently (id)

### Navigation
- `nav.goto` - navigate (id, url, wait?)
- `nav.back` - go back (id)
- `nav.forward` - go forward (id)

### Interaction
- `interact.click` - click element (id, selector)
- `interact.type` - type text (id, selector, text)
- `interact.select` - select dropdown (id, selector, value)

### Extraction
- `extract.text` - get text (id, selector?)
- `extract.html` - get HTML (id, selector?)
- `extract.screenshot` - screenshot (id, path?, fullPage?)
- `extract.evaluate` - run JavaScript (id, code, args?)

### Workflows
- `workflow.login` - auto-login (id, username, password, usernameSelector?, passwordSelector?, submitSelector?)
- `workflow.fillForm` - fill form (id, fields)
- `workflow.scrape` - extract data (id, selectors)

## Example

```javascript
// Open session with stealth
session.open({ id: 'work', url: 'https://example.com', config: { stealth: true } })

// Navigate and interact
nav.goto({ id: 'work', url: 'https://example.com/login' })
workflow.login({ id: 'work', username: 'user@example.com', password: 'password' })

// Extract data
extract.text({ id: 'work', selector: '.content' })

// Close and persist
session.close({ id: 'work' })

// Resume later
session.open({ id: 'work' }) // restores cookies, localStorage
```

## Sessions

Stored in `./sessions/{id}/`:
- `state.json` - Playwright storageState (cookies, localStorage)
- `meta.json` - timestamps, config, last URL

## Environment

```bash
LOG_LEVEL=debug  # error, warn, info, debug
```

## Features

✅ Persistent sessions across restarts
✅ Stealth plugin (best-effort)
✅ Headful mode (lower detection)
✅ Error normalization
✅ Timeout control
✅ Workflow abstractions

## Architecture

```
LLM → MCP Server → Session Pool → Playwright + Stealth
                       ↓
                  File Storage
```

## License

MIT