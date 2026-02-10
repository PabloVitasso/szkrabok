# MCP Usage

Using szkrabok as an MCP server via Claude Desktop or other MCP clients.

## Headless Mode Control

Szkrabok supports two ways to control headless/visible browser mode:

### 1. Per-Session Control (Recommended)

Control mode individually for each session using `config.headless`:

```javascript
// Visible browser (requires X server/DISPLAY)
session.open({ id: 'test', url: 'https://example.com', config: { headless: false }})

// Headless browser
session.open({ id: 'test', url: 'https://example.com', config: { headless: true }})
```

This approach allows mixing visible and headless sessions within the same MCP server instance.

### 2. CLI Flags (Global Default)

Set a default for all sessions using command-line arguments:

```bash
# Default: Auto-detect headless based on DISPLAY environment
node src/index.js

# Force headless mode (invisible browser)
node src/index.js --headless

# Force headed mode (visible browser) - requires X server or xvfb
node src/index.js --no-headless
```

**Auto-detection logic:**
- If `--headless` or `--no-headless` specified: Use as default for all sessions
- If no flag: Enable headless automatically if no DISPLAY environment variable
- Sessions can override the default using `config.headless`

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

### Recommended Approach: Per-Session Headless Control

A single MCP server can handle both visible and headless sessions. Control mode per-session using `config.headless`:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js"
      ],
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

**For servers without X display, use xvfb:**

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

### MCP Tool Workflow

```javascript
// FIRST TIME: Open visible browser for manual login
session.open({
  id: 'claude-ai',
  url: 'https://claude.ai',
  config: { headless: false, stealth: true }  // Visible mode
})

// User logs in manually (browser stays open)
// When done, close and save
session.close({ id: 'claude-ai', save: true })
// → Persisted to szkrabok.playwright.mcp.stealth/sessions/claude-ai/

// LATER: Reuse session in headless mode (auto-logged in)
session.open({
  id: 'claude-ai',  // Same ID = auto-restore cookies/state
  url: 'https://claude.ai',
  config: { headless: true, stealth: true }  // Headless mode
})
// → Already logged in, no user interaction needed

extract.text({ id: 'claude-ai', selector: 'title' })
session.close({ id: 'claude-ai', save: true })
```

**Workflow:**
1. `session.open` with `headless: false` → visible browser
2. User logs in manually
3. `session.close` with `save: true` → persists cookies/state
4. Later: `session.open` with `headless: true` and same `id` → auto-logged in
5. Automate tasks in headless mode

**MCP Tools Used:**
- `session.open` - Opens browser session (specify `config.headless` per session)
- `session.close` - Saves session state
- `extract.text` - Verifies logged in

**Storage:** `szkrabok.playwright.mcp.stealth/sessions/{id}/state.json` + `meta.json`

**Alternative:** You can also control headless mode at the MCP server level using CLI flags (`--headless` or `--no-headless`), but per-session control offers more flexibility.

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
