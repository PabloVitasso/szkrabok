# Basic Usage

This directory contains usage examples for szkrabok.

## Documentation

- **[Script Usage](usage_script.md)** - Using szkrabok from Node.js scripts via direct imports
- **[MCP Usage](usage_mcp.md)** - Using szkrabok as an MCP server via Claude Desktop or other MCP clients

## Quick Comparison

### Script (Direct API)
```javascript
import * as session from '../tools/session.js'

await session.open({ id: 'demo', url: 'https://example.com' })
```

### MCP (Tool Calls)
```javascript
session.open({ id: 'demo', url: 'https://example.com' })
```

## Key Differences

| Aspect | Script Usage | MCP Usage |
|--------|-------------|-----------|
| Import | `import * from '../tools/...'` | N/A (tools exposed via MCP) |
| Async | `await` required | Handled by MCP client |
| Access | Direct Node.js API | Tool calls via MCP protocol |
| Best For | Automated scripts, CI/CD | Interactive use, Claude Desktop |

## Examples Included

Both usage docs cover:

1. Simple Navigation
2. Login Workflow
3. Form Filling
4. Data Extraction
5. Custom JavaScript
6. Session Management
7. Screenshot
8. Advanced Config
9. **Session Persistence with Manual Login** (claude.ai example)

## Session Persistence Feature

The session persistence feature (#9) demonstrates:
- Opening browser with `headless: false` for manual login
- Waiting for user to close window (unlimited time)
- Saving session state to disk
- Reopening session later with auto-restored authentication

**MCP-specific:** Uses `wait.forClose` tool (added specifically for MCP workflows)  
**Script-specific:** Uses `page.waitForEvent('close')` from Playwright API

See respective docs for full examples.
