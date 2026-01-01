# SZKRABOK-PLAYWRIGHT-MCP

Production-grade MCP browser automation with persistent sessions and stealth.

## Install

```bash
npm install
npm run prepare
```

## Run

```bash
# Standalone (auto-detects headless based on DISPLAY)
npm start

# Force headless mode
node index.js --headless

# Force visible mode (requires X server)
node index.js --no-headless

# With MCP Inspector
npx @modelcontextprotocol/inspector szkrabok-playwright-mcp
```

## Claude Desktop Configuration

**Recommended: Dual configuration** for different use cases

Add to `~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/your-username/path/to/szkrabok/index.js",
        "--headless"
      ]
    },
    "szkrabok-visible": {
      "command": "node",
      "args": [
        "/home/your-username/path/to/szkrabok/index.js",
        "--no-headless"
      ],
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

**Usage:**
- **szkrabok**: Headless automation (default for all automated tasks)
- **szkrabok-visible**: Manual login, debugging, element inspection

**For servers without X display:**

```json
{
  "mcpServers": {
    "szkrabok-visible": {
      "command": "xvfb-run",
      "args": [
        "-a",
        "node",
        "/home/your-username/path/to/szkrabok/index.js",
        "--no-headless"
      ]
    }
  }
}
```

See [`examples/claude_desktop_config.md`](examples/claude_desktop_config.md) for more configurations.

## Tools

SZKRABOK exposes **two categories** of tools:

### 🔧 **Szkrabok Tools** - Session Management & Workflows
Custom tools built for persistent sessions and automation workflows:

**Session Management**
- `session.open` - create/resume session (id, url?, config?)
- `session.close` - close session (id, save?)
- `session.list` - list all sessions ()
- `session.delete` - delete permanently (id)

**Navigation (CSS selector-based)**
- `nav.goto` - navigate (id, url, wait?)
- `nav.back` - go back (id)
- `nav.forward` - go forward (id)

**Interaction (CSS selector-based)**
- `interact.click` - click element (id, selector)
- `interact.type` - type text (id, selector, text)
- `interact.select` - select dropdown (id, selector, value)

**Extraction**
- `extract.text` - get text (id, selector?)
- `extract.html` - get HTML (id, selector?)
- `extract.screenshot` - screenshot (id, path?, fullPage?)
- `extract.evaluate` - run JavaScript (id, code, args?)

**Workflows**
- `workflow.login` - auto-login (id, username, password)
- `workflow.fillForm` - fill form (id, fields)
- `workflow.scrape` - extract data (id, selectors)

### 🎭 **Playwright-MCP Tools** - Ref-based Interaction
Full playwright-mcp implementation with accessibility tree snapshots (**33 tools**):

**Core Automation** (ref-based from snapshots)
- `browser.snapshot` - capture accessibility tree with refs
- `browser.navigate` - navigate and return snapshot
- `browser.click` - click using ref from snapshot (id, ref, element)
- `browser.type` - type using ref (id, ref, text, element)
- `browser.drag`, `browser.hover`, `browser.evaluate`
- `browser.select_option`, `browser.fill_form`, `browser.press_key`
- `browser.wait_for`, `browser.resize`, `browser.tabs`
- `browser.console_messages`, `browser.network_requests`
- `browser.file_upload`, `browser.handle_dialog`, `browser.run_code`

**Vision Tools** (coordinate-based)
- `browser.mouse_click_xy`, `browser.mouse_move_xy`, `browser.mouse_drag_xy`

**Testing Tools**
- `browser.verify_element_visible`, `browser.verify_text_visible`
- `browser.verify_list_visible`, `browser.verify_value`
- `browser.generate_locator`

**Other**
- `browser.pdf_save`, `browser.take_screenshot`
- `browser.start_tracing`, `browser.stop_tracing`

**Tool Naming:** All tools support 3 formats:
- Dot notation: `session.open`, `browser.snapshot`
- Underscore: `session_open`, `browser_snapshot`
- Concatenated: `sessionopen`, `browsersnapshot`

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

## Environment Variables

```bash
# Logging
LOG_LEVEL=debug  # error, warn, info, debug

# Browser mode (auto-detected if not set)
HEADLESS=true   # Force headless mode
HEADLESS=false  # Force visible mode
# (Omit to auto-detect: headless if no DISPLAY, visible if DISPLAY exists)

# Timeouts
TIMEOUT=30000   # Default timeout in milliseconds

# Display (for visible mode)
DISPLAY=:0      # X server display
```

**CLI Flags Override Environment:**
- `node index.js --headless` → HEADLESS=true
- `node index.js --no-headless` → HEADLESS=false

## Features

✅ Persistent sessions across restarts
✅ Stealth plugin (best-effort)
✅ Auto-detect headless/headed mode (like playwright-mcp)
✅ CLI flags for explicit control (--headless, --no-headless)
✅ Lazy browser initialization (browser opens only when needed)
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