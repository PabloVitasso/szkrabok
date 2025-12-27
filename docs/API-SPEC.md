# API SPECIFICATION

## Tools Overview

### Session Management
- `session.open` - Open a browser session
- `session.close` - Close and persist session
- `session.list` - List active/persisted sessions
- `session.delete` - Delete persisted session

### Navigation
- `nav.goto` - Navigate to URL
- `nav.back` - Go back in history
- `nav.forward` - Go forward in history

### Interaction
- `interact.click` - Click element
- `interact.type` - Type text
- `interact.select` - Select dropdown option

### Extraction
- `extract.text` - Extract text
- `extract.html` - Extract HTML
- `extract.screenshot` - Take screenshot
- `extract.evaluate` - Execute JavaScript

### Workflows
- `workflow.login` - Automated login
- `workflow.fillForm` - Fill form fields
- `workflow.scrape` - Extract structured data

## Detailed Specifications

### session.open
**Description:** Open a new or existing browser session

**Parameters:**
```json
{
  "id": "string (required)",
  "url": "string (optional)",
  "config": {
    "stealth": "boolean (default: true)",
    "viewport": {"width": 1280, "height": 800},
    "userAgent": "string",
    "locale": "string (default: en-US)",
    "timezone": "string (default: America/New_York)"
  }
}
```

**Returns:**
```json
{
  "success": true,
  "id": "string",
  "url": "string"
}
```

### nav.goto
**Description:** Navigate to a URL

**Parameters:**
```json
{
  "id": "string (required)",
  "url": "string (required)",
  "wait": "load|domcontentloaded|networkidle (default: domcontentloaded)"
}
```

**Returns:**
```json
{
  "success": true,
  "url": "string"
}
```

### extract.text
**Description:** Extract text from page or element

**Parameters:**
```json
{
  "id": "string (required)",
  "selector": "string (optional)"
}
```

**Returns:**
```json
{
  "content": "string"
}
```

### workflow.login
**Description:** Automated login workflow

**Parameters:**
```json
{
  "id": "string (required)",
  "username": "string (required)",
  "password": "string (required)",
  "usernameSelector": "string (optional)",
  "passwordSelector": "string (optional)",
  "submitSelector": "string (optional)"
}
```

**Returns:**
```json
{
  "success": true
}
```

## Error Responses
All tools return errors in this format:
```json
{
  "content": [{
    "type": "text",
    "text": "Error: Error message here"
  }],
  "isError": true
}
```

## Session Persistence
Sessions are automatically saved in `sessions/{id}/`:
- `state.json` - Playwright storage state (cookies, localStorage)
- `meta.json` - Session metadata (timestamps, config, stats)
