# MCP Usage

Using szkrabok as an MCP server via Claude Desktop or other MCP clients.

## CLI Options

Szkrabok MCP server supports command-line arguments like playwright-mcp:

```bash
# Default: Auto-detect headless based on DISPLAY environment
node index.js

# Force headless mode (invisible browser)
node index.js --headless

# Force headed mode (visible browser) - requires X server or xvfb
node index.js --no-headless
```

**Auto-detection logic:**
- If `--headless` or `--no-headless` specified: Use explicit setting
- If no flag: Enable headless automatically if no DISPLAY environment variable
- With DISPLAY=:0: Browser runs in visible mode (default)
- Without DISPLAY: Browser runs in headless mode (default)

## 1. Simple Navigation

```javascript
// Open session
session.open({ id: 'demo', url: 'https://example.com' })

// Navigate
nav.goto({ id: 'demo', url: 'https://example.com/about' })

// Extract content
extract.text({ id: 'demo', selector: 'h1' })

// Close
session.close({ id: 'demo' })
```

## 2. Login Workflow

```javascript
// Open on login page
session.open({ id: 'app', url: 'https://app.example.com/login' })

// Auto-login
workflow.login({ id: 'app', username: 'user@example.com', password: 'secret123' })

// Verify logged in
extract.text({ id: 'app', selector: '.user-name' })

// Session persists cookies
session.close({ id: 'app' })

// Later: resume without login
session.open({ id: 'app', url: 'https://app.example.com/dashboard' })
```

## 3. Form Filling

```javascript
session.open({ id: 'form', url: 'https://example.com/contact' })

workflow.fillForm({
  id: 'form',
  fields: {
    '#name': 'John Doe',
    '#email': 'john@example.com',
    '#message': 'Hello world',
    '#country': 'US'
  }
})

interact.click({ id: 'form', selector: 'button[type="submit"]' })

session.close({ id: 'form' })
```

## 4. Data Extraction

```javascript
session.open({ id: 'scrape', url: 'https://news.example.com' })

workflow.scrape({
  id: 'scrape',
  selectors: {
    titles: 'h2.article-title',
    authors: '.author-name',
    dates: 'time.published'
  }
})

// Returns:
// {
//   data: {
//     titles: ['Title 1', 'Title 2'],
//     authors: ['Author 1', 'Author 2'],
//     dates: ['2025-01-01', '2025-01-02']
//   }
// }

session.close({ id: 'scrape' })
```

## 5. Custom JavaScript

```javascript
session.open({ id: 'custom', url: 'https://example.com' })

extract.evaluate({
  id: 'custom',
  code: `
    () => {
      return {
        title: document.title,
        links: Array.from(document.querySelectorAll('a')).length,
        images: Array.from(document.querySelectorAll('img')).length
      }
    }
  `
})

session.close({ id: 'custom' })
```

## 6. Session Management

```javascript
// List all sessions
session.list()

// Returns:
// {
//   sessions: [
//     { id: 'demo', active: false },
//     { id: 'app', active: true, createdAt: 1704110400000 }
//   ]
// }

// Delete old session
session.delete({ id: 'old-session' })
```

## 7. Screenshot

```javascript
session.open({ id: 'screenshot', url: 'https://example.com' })

// Save to file
extract.screenshot({ id: 'screenshot', path: './screenshot.png', fullPage: true })

// Get base64
extract.screenshot({ id: 'screenshot' })

session.close({ id: 'screenshot' })
```

## 8. Advanced Config

```javascript
session.open({
  id: 'custom-config',
  url: 'https://example.com',
  config: {
    stealth: true,
    headless: true,
    viewport: { width: 1366, height: 768 },
    locale: 'pl-PL',
    timezone: 'Europe/Warsaw'
  }
})

session.close({ id: 'custom-config' })
```

## 9. Session Persistence with Manual Login

**Scenario:** Log in once to claude.ai, reuse session without re-authenticating

### Claude Desktop Configuration (Recommended)

When using szkrabok through Claude Desktop, configure with `--no-headless` for manual login:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--no-headless"
      ],
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

**For servers without X display (headless servers):**

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "xvfb-run",
      "args": [
        "-a",
        "node",
        "/home/jones2/mega/research/szkrabok/index.js",
        "--no-headless"
      ]
    }
  }
}
```

### MCP Tool Workflow

```javascript
// FIRST TIME: Open visible browser for manual login
// (CLI must be started with --no-headless flag)
session.open({
  id: 'claude-ai',
  url: 'https://claude.ai',
  config: { stealth: true }  // headless determined by CLI flag
})

// Wait for user to close browser window (no timeout)
wait.forClose({ id: 'claude-ai' })

// Save state when window closed
session.close({ id: 'claude-ai', save: true })
// → Persisted to ~/.szkrabok/sessions/claude-ai/

// LATER: Reuse session (auto-logged in)
// Switch CLI to --headless flag for automation
session.open({
  id: 'claude-ai',  // Same ID = auto-restore
  url: 'https://claude.ai',
  config: { stealth: true }
})
// → Already logged in, no user interaction

extract.text({ id: 'claude-ai', selector: 'title' })
session.close({ id: 'claude-ai' })
```

**Workflow:**
1. Start MCP server with `--no-headless` flag
2. `session.open` → visible browser (controlled by CLI flag)
3. User logs in manually (unlimited time)
4. User closes browser window when done
5. `wait.forClose` detects close and returns
6. `session.close` with `save: true` persists state
7. Restart MCP server with `--headless` flag (or default auto-detect)
8. Reopen with same `id` → auto-logged in

**MCP Tools Used:**
- `session.open` - Opens browser session
- `wait.forClose` - Waits for window close (no timeout)
- `session.close` - Saves session state
- `extract.text` - Verifies logged in

**Storage:** `~/.szkrabok/sessions/{id}/state.json` + `meta.json`

**Note:** For one-time manual login, you can also override in config:
```javascript
session.open({
  id: 'claude-ai',
  url: 'https://claude.ai',
  config: { stealth: true, headless: false }  // Override CLI flag
})
```
This requires DISPLAY environment or xvfb-run wrapper.

## Available MCP Tools

### Session Management
- `session.open` - Open/resume browser session
- `session.close` - Close and save session
- `session.list` - List all sessions
- `session.delete` - Delete session permanently

### Navigation
- `nav.goto` - Navigate to URL
- `nav.back` - Go back
- `nav.forward` - Go forward

### Interaction
- `interact.click` - Click element
- `interact.type` - Type text into element
- `interact.select` - Select dropdown option

### Extraction
- `extract.text` - Extract text content
- `extract.html` - Extract HTML
- `extract.screenshot` - Take screenshot
- `extract.evaluate` - Execute JavaScript

### Workflows
- `workflow.login` - Automated login
- `workflow.fillForm` - Fill form fields
- `workflow.scrape` - Extract structured data

### Wait Operations
- `wait.forClose` - Wait for window close (no timeout)
- `wait.forSelector` - Wait for element to appear
- `wait.forTimeout` - Wait for milliseconds
