# Szkrabok Development Guide

This document captures the architectural decisions and transplant recipe for szkrabok's custom additions to upstream [playwright-mcp](https://github.com/microsoft/playwright-mcp).

## Overview

Szkrabok is a fork of playwright-mcp that adds:

1. **Persistent session management** - Sessions survive server restarts
2. **Stealth capabilities** - Browser fingerprinting evasion
3. **CSS selector tools** - Alternative to accessibility tree refs
4. **High-level workflows** - Login, form filling, scraping abstractions
5. **CLI session management** - Command-line tools for session inspection

---

## Session Management

### core/pool.js (31 lines)

In-memory session pool tracking active browser contexts.

```javascript
// Key exports
add(id, context, page)     // Register active session
get(id)                    // Retrieve session (throws if not found)
has(id)                    // Check session exists
remove(id)                 // Unregister session
list()                     // List all active sessions with timestamps
closeAllSessions()         // Cleanup on server shutdown
```

### core/storage.js (61 lines)

Persistent session state on disk (`./sessions/{id}/`).

```javascript
// Files stored per session
// - state.json   → Playwright storageState (cookies, localStorage, sessionStorage)
// - meta.json    → Session metadata (timestamps, config, lastUrl)

// Key exports
loadState(id) / saveState(id, state)
loadMeta(id) / saveMeta(id, meta) / updateMeta(id, updates)
sessionExists(id)
deleteSession(id)
listSessions()
ensureSessionsDir()
```

### tools/session.js (104 lines)

MCP tools for session lifecycle.

```javascript
// session.open({ id, url?, config? })
//   - Creates new or resumes existing session
//   - Config options: stealth, headless, viewport, locale, timezone
//   - Loads persisted storageState if exists
//   - Injects iframe stealth init script

// session.close({ id, save? })
//   - Saves storageState if save=true (default)
//   - Updates lastUsed timestamp
//   - Closes context, removes from pool

// session.list()
//   - Returns active + stored sessions with metadata

// session.delete({ id })
//   - Removes from pool if active
//   - Deletes from disk
```

### Session Lifecycle

```
session.open(id)
    ↓
[Check pool for duplicate] → error if exists
[Load state from ./sessions/{id}/state.json]
[Create browser context with storageState]
[Add init script for iframe stealth]
[Create page, add to pool]
[Save metadata to ./sessions/{id}/meta.json]
[Navigate if URL provided]
    ↓
session operations...
    ↓
session.close(id, save=true)
    ↓
[Save storageState to disk]
[Update lastUsed timestamp]
[Close context, remove from pool]
```

---

## Stealth Capabilities

### core/stealth.js (41 lines)

Browser fingerprinting evasion using `playwright-extra`.

```javascript
// Dependencies
import { addExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

// Enabled evasions
- chrome.app, chrome.csi, chrome.loadTimes, chrome.runtime
- iframe.contentWindow, media.codecs
- navigator.hardwareConcurrency, navigator.languages
- navigator.permissions, navigator.plugins
- navigator.vendor, navigator.webdriver
- window.outerdimensions

// Disabled (conflicts with session persistence)
- user-data-dir

// Fallback: Returns vanilla Playwright if stealth plugin fails
```

### upstream/wrapper.js (86 lines)

Browser singleton with stealth integration.

```javascript
// getBrowser(options = { stealth: true, headless? })
//   - Lazy singleton pattern (browser only created on first use)
//   - Applies stealth plugin if enabled
//   - Auto-detects headless mode via DISPLAY env
//   - Uses findChromiumPath() for cached browser

// Exports for tool handlers
navigate(page, url, options)
click(page, selector, options)
type(page, selector, text, options)
select(page, selector, value, options)
getText(page, selector?)
getHtml(page, selector?)
screenshot(page, options)
evaluate(page, code, args)
back(page), forward(page)
```

---

## CSS Selector-Based Tools

Alternative tools using CSS selectors instead of accessibility tree refs.

### tools/interact.js (23 lines)

```javascript
interact.click({ id, selector })
interact.type({ id, selector, text })
interact.select({ id, selector, value })
```

### tools/navigate.js (27 lines)

```javascript
nav.goto({ id, url, wait? })
nav.back({ id })
nav.forward({ id })
```

### tools/extract.js (35 lines)

```javascript
extract.text({ id, selector? })
extract.html({ id, selector? })
extract.screenshot({ id, path?, fullPage? })
extract.evaluate({ id, code, args? })
```

### tools/wait.js (29 lines)

```javascript
wait.forClose({ id })
wait.forSelector({ id, selector, timeout? })
wait.forTimeout({ id, ms })
```

---

## High-Level Workflow Tools

### tools/workflow.js (66 lines)

```javascript
// workflow.login({ id, username, password,
//                 usernameSelector?, passwordSelector?, submitSelector? })
//   - Generic login automation with sensible defaults
//   - Default selectors for common login forms
//   - Default: input[type="email"], input[name="username"], input[name="email"]
//   - Default: input[type="password"], input[name="password"]
//   - Default: button[type="submit"], input[type="submit"]

// workflow.fillForm({ id, fields: { selector: value } })
//   - Bulk form filling
//   - Handles select vs input elements

// workflow.scrape({ id, selectors: { key: selector } })
//   - Extract structured data using multiple selectors
//   - Returns array of textContent for each selector
```

---

## Tool Registry Architecture

### tools/registry.js (782 lines)

**Two tool categories:**

1. **Szkrabok Tools** (prefix `[szkrabok]`):
   - Session: `session.open`, `session.close`, `session.list`, `session.delete`
   - Navigate: `nav.goto`, `nav.back`, `nav.forward`
   - Interact: `interact.click`, `interact.type`, `interact.select`
   - Extract: `extract.text`, `extract.html`, `extract.screenshot`, `extract.evaluate`
   - Wait: `wait.forClose`, `wait.forSelector`, `wait.forTimeout`
   - Workflow: `workflow.login`, `workflow.fillForm`, `workflow.scrape`

2. **Playwright-MCP Tools** (prefix `[playwright-mcp]`):
   - Ref-based interaction via accessibility tree
   - Full import from `@playwright/mcp` package
   - Wrapped to use session pool

**Alias System:**

```javascript
// Each tool has 3 aliases
session.open     // dot notation - canonical
session_open     // underscore
sessionopen      // concatenated
```

**Error Handling:**

```javascript
// Custom errors
SessionNotFoundError
SessionExistsError
ValidationError

// wrapError normalizes all errors
wrapError(err) → { code, message, stack? }
```

---

## Configuration

### config.js (57 lines)

```bash
# Environment variables
TIMEOUT              # Action timeout (default: 30000ms)
HEADLESS             # Force headless mode
DISABLE_WEBGL        # Disable WebGL
VIEWPORT_WIDTH/HEIGHT # Browser viewport
USER_AGENT          # Custom UA string
LOCALE              # Browser locale
TIMEZONE            # Browser timezone

# Auto-detection
HEADLESS = true if no DISPLAY env (headless server)
Chromium path discovery from ~/.cache/ms-playwright
```

---

## CLI Tool

### cli.js (123 lines)

```bash
bebok session list     # Table of all sessions with metadata
bebok session open <id> [--url <url>]
bebok session inspect <id>  # Show cookies, localStorage
bebok session delete <id>
bebok cleanup [--days N]    # Delete sessions older than N days
```

---

## Testing

### test-install.sh (37 lines)

Installation script test suite that validates all installation workflows.

```bash
./test-install.sh

# Tests performed:
# 1. Clean install to local scope
# 2. Clean install to user scope
# 3. Install local with --clean-all when user scope exists
# 4. Verify final state
#
# Cleanup runs automatically on exit via trap
```

---

## Entry Points

### index.js (27 lines)

```javascript
// Parses --no-headless / --headful flags
// Creates server, handles SIGINT graceful shutdown
```

### server.js (40 lines)

```javascript
// MCP Server: 'szkrabok-playwright-mcp', version '2.0.0'
// Transport: StdioServerTransport
// Handlers: ListToolsRequestSchema, CallToolRequestSchema
// Shutdown: closeAllSessions()
```

---

## Dependencies Added

```json
{
  "playwright-extra": "^4.3.6",
  "puppeteer": "^24.34.0",
  "puppeteer-extra-plugin-stealth": "^2.11.2",
  "zod": "^3.24.1",
  "commander": "^...",
  "ajv": "^8.17.1",
  "ajv-formats": "^3.0.1"
}
```

---

## Transplant Checklist

When applying szkrabok changes to a new upstream version:

### 1. Session Layer

- [ ] Copy `core/pool.js` (likely unchanged)
- [ ] Copy `core/storage.js` (likely unchanged)
- [ ] Update `tools/session.js` to match new tool signature patterns

### 2. Stealth

- [ ] Copy `core/stealth.js` (likely unchanged)
- [ ] Update `upstream/wrapper.js` to integrate with new browser launcher

### 3. CSS Selector Tools

- [ ] Copy `tools/interact.js`, `navigate.js`, `extract.js`, `wait.js`
- [ ] May need refactoring if upstream tool signatures changed

### 4. Workflows

- [ ] Copy `tools/workflow.js` (mostly self-contained)
- [ ] Update imports if paths changed

### 5. Registry

- [ ] Copy `tools/registry.js`
- [ ] Update `playwrightMcpTools` section to match new upstream tools
- [ ] Register new aliases format

### 6. Config

- [ ] Copy `config.js` or merge with upstream JSON config

### 7. CLI

- [ ] Copy `cli.js` (mostly self-contained)

### 8. Errors/Logger

- [ ] Copy `utils/errors.js`, `utils/logger.js`

### 9. Dependencies

- [ ] Add `playwright-extra`, `puppeteer-extra-plugin-stealth`, `commander`

---

## File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `core/pool.js` | 31 | In-memory session tracking |
| `core/storage.js` | 61 | Disk persistence |
| `core/stealth.js` | 41 | Fingerprint evasion |
| `tools/session.js` | 104 | Session MCP tools |
| `tools/interact.js` | 23 | CSS selector actions |
| `tools/navigate.js` | 27 | Navigation tools |
| `tools/extract.js` | 35 | Data extraction |
| `tools/wait.js` | 29 | Wait conditions |
| `tools/workflow.js` | 66 | High-level workflows |
| `tools/registry.js` | 782 | Tool registration |
| `upstream/wrapper.js` | 86 | Browser singleton |
| `config.js` | 57 | Configuration |
| `cli.js` | 123 | CLI session management |
| `index.js` | 27 | Entry point |
| `server.js` | 40 | MCP server |
| `utils/errors.js` | 36 | Error classes |
| `utils/logger.js` | 46 | Structured logging |
