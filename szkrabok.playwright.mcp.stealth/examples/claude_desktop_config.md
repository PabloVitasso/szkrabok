# Claude Desktop Configuration Examples

Configuration file location: `~/.config/Claude/claude_desktop_config.json`

## Recommended: Single MCP Server

A single "szkrabok" MCP server handles both headless and visible browser modes. The mode is controlled per-session using the `config.headless` parameter in `session.open()`.

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js"
      ]
    }
  }
}
```

**Usage:**
```javascript
// Headless mode (automated tasks)
session.open({ id: 'my-session', url: 'https://example.com', config: { headless: true, stealth: true }})

// Visible mode (manual login, debugging, element inspection)
session.open({ id: 'my-session', url: 'https://example.com', config: { headless: false, stealth: true }})
```

**Note:** Browser launches lazily (only when `session.open` is called), so MCP server initialization doesn't show empty browser window. This matches playwright-mcp behavior.

## Basic Configuration (Auto-detect)

Auto-detects headless mode based on DISPLAY environment:
- With DISPLAY: Visible browser by default
- Without DISPLAY: Headless browser by default

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js"
      ]
    }
  }
}
```

## Alternative: Force Headless at MCP Server Level

You can force all sessions to run in headless mode by default at the MCP server level (sessions can still override with `config.headless`):

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js",
        "--headless"
      ]
    }
  }
}
```

## Alternative: Force Visible at MCP Server Level

Force all sessions to run in visible mode by default (requires X server):

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js",
        "--no-headless"
      ],
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

**Note:** Requires X server running on DISPLAY :0

## Using xvfb (Virtual Display)

For servers or containers without X display, use xvfb to create a virtual framebuffer:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "xvfb-run",
      "args": [
        "-a",
        "node",
        "/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js"
      ]
    }
  }
}
```

**xvfb-run flags:**
- `-a` - Auto-select available display number
- Creates virtual framebuffer for headful browser without physical display

## Custom Timeout

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js"
      ],
      "env": {
        "TIMEOUT": "60000"
      }
    }
  }
}
```

## Session Persistence Workflow

With a single MCP server, you can switch between visible and headless modes per session without reconfiguring the server.

### Phase 1: Manual Login (Visible Browser)

Use visible mode for one-time manual login:

**MCP Workflow:**
1. Call `session.open({ id: 'myapp', url: 'https://app.example.com/login', config: { headless: false, stealth: true }})`
2. Browser opens visibly (requires X server/DISPLAY)
3. Log in manually
4. Call `session.close({ id: 'myapp', save: true })` - saves cookies/state
5. Session persisted to `szkrabok.playwright.mcp.stealth/sessions/myapp/`

### Phase 2: Automated Access (Headless)

After manual login, reuse the same session in headless mode:

**MCP Workflow:**
1. Call `session.open({ id: 'myapp', url: 'https://app.example.com/dashboard', config: { headless: true, stealth: true }})`
2. Session automatically restores cookies/state from Phase 1
3. Already logged in, no user interaction needed
4. Automate tasks in headless mode
5. Call `session.close({ id: 'myapp', save: true })` to update session state

## Path Placeholders

Replace absolute paths with your actual installation:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/path/to/your/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js"
      ]
    }
  }
}
```

**Common locations:**
- Development: `/home/username/projects/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js`
- Global npm: `$(npm root -g)/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js`
- npx: Use `"command": "npx"` with `"args": ["szkrabok", "--headless"]` (if published to npm)

## Troubleshooting

### "Error: Failed to launch browser"

**Cause:** No DISPLAY and trying to run headed mode

**Solutions:**
1. Use `--headless` flag (recommended)
2. Add xvfb-run wrapper
3. Set DISPLAY environment variable

### "Browser crashes immediately"

**Cause:** Missing system dependencies

**Solution:**
```bash
# Install Playwright browsers
npx playwright install chromium --with-deps
```

### "Session not persisting"

**Cause:** `save: false` or session directory permissions

**Check:**
```bash
ls -la ~/.szkrabok/sessions/
chmod -R u+w ~/.szkrabok/sessions/
```

## Advanced: Multiple MCP Instances (Optional)

**Note:** You typically don't need multiple MCP servers since a single server can handle both headless and visible modes per session. However, you might want separate instances for completely isolated browser profiles or different session storage locations.

```json
{
  "mcpServers": {
    "szkrabok-personal": {
      "command": "node",
      "args": [
        "/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js"
      ]
    },
    "szkrabok-work": {
      "command": "node",
      "args": [
        "/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js"
      ]
    }
  }
}
```

Each server maintains separate session storage and browser instances. Within each server, you can still control headless/visible mode per session using `config.headless`.
