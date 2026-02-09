# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm start              # Start MCP server (auto-detects headless mode)
npm run dev            # Start with auto-reload on file changes
node index.js --headless        # Force headless mode
node index.js --no-headless     # Force visible mode (requires X server)
```

### Testing
```bash
npm test               # Run all tests
npm run test:watch     # Run tests in watch mode
node --test test/basic.test.js    # Run single test file
```

### Code Quality
```bash
npm run lint           # Check for linting errors
npm run lint:fix       # Auto-fix linting errors
npm run format         # Format code with Prettier
npm run format:check   # Check code formatting
```

### Session Management (CLI)
```bash
node cli.js session list                    # List all sessions
node cli.js session inspect <id>            # Inspect session details
node cli.js session delete <id>             # Delete specific session
node cli.js cleanup --days 30               # Delete sessions older than 30 days
```

### MCP Inspector
```bash
npx @modelcontextprotocol/inspector szkrabok-playwright-mcp
```

## Architecture

### Core Components

**Entry Point Flow**
- `index.js` → `server.js` → MCP SDK stdio transport
- CLI args parsed in `index.js` (--headless, --no-headless)
- Graceful shutdown handled with SIGINT

**MCP Server** (`server.js`)
- Creates MCP server using `@modelcontextprotocol/sdk`
- Registers tools via `tools/registry.js`
- Routes tool calls to handlers
- Closes all sessions on shutdown

**Session Pool** (`core/pool.js`)
- In-memory Map of active sessions (id → {context, page, createdAt})
- Sessions persist across tool calls until explicitly closed
- Pool does NOT persist on server restart

**Storage Layer** (`core/storage.js`)
- Persists session state to `./sessions/{id}/`
- `state.json` - Playwright storageState (cookies, localStorage, sessionStorage)
- `meta.json` - Session metadata (timestamps, config, lastUrl)
- Sessions can be resumed after server restart

**Stealth** (`core/stealth.js`)
- Wraps Playwright with `playwright-extra` + `puppeteer-extra-plugin-stealth`
- Disabled evasions: `user-data-dir` (conflicts with session persistence)
- Enabled evasions: webdriver detection, navigator properties, chrome runtime, etc.
- Falls back to vanilla Playwright if stealth fails

**Browser Initialization** (`upstream/wrapper.js`)
- Lazy initialization: browser only launches when first session opens
- Singleton pattern: all sessions share one browser instance
- Stealth applied based on session config (default: enabled)
- Headless mode: auto-detected or forced via CLI/env

### Tool Architecture

**Two Tool Categories**
1. **Szkrabok Tools** (`tools/session.js`, `navigate.js`, `interact.js`, `extract.js`, `workflow.js`)
   - CSS selector-based interaction
   - High-level workflows (login, fillForm, scrape)
   - Session management (open, close, list, delete)

2. **Playwright-MCP Tools** (`tools/playwright_mcp.js`)
   - Accessibility tree snapshot-based (ref system)
   - 33 imported tools from `@playwright/mcp`
   - Coordinate-based vision tools (mouse_click_xy, mouse_move_xy, mouse_drag_xy)
   - Testing/verification tools

**Tool Registry** (`tools/registry.js`)
- Combines both tool sets
- Generates 3 aliases per tool: `session.open`, `session_open`, `sessionopen`
- Dispatches calls to correct handler
- Wraps errors with standardized format

**Tool Naming Convention**
- Dot notation (canonical): `session.open`, `browser.snapshot`
- Underscore: `session_open`, `browser_snapshot`
- Concatenated: `sessionopen`, `browsersnapshot`

### Configuration

**Auto-detection** (`config.js`)
- Headless mode: `HEADLESS` env → CLI flags → auto-detect (!DISPLAY)
- Timeout: `TIMEOUT` env (default: 30000ms)
- Viewport: `VIEWPORT_WIDTH`/`HEIGHT` env (default: 1280x800)
- User agent, locale, timezone configurable via env

**Precedence**
1. CLI flags (`--headless`, `--no-headless`)
2. Environment variables
3. Auto-detection (headless if no DISPLAY)

### Error Handling

**Custom Errors** (`utils/errors.js`)
- `SessionNotFoundError` - Session ID not in pool
- `SessionExistsError` - Attempting to open duplicate session
- `wrapError()` - Normalizes all errors to JSON-serializable format

**Error Flow**
- Handler throws → `handleToolCall()` catches → `wrapError()` → JSON response with `isError: true`

### Session Lifecycle

**Opening a Session**
1. Check pool for duplicate
2. Load state from `./sessions/{id}/state.json` (if exists)
3. Create browser context with state + config
4. Add init scripts (iframe stealth)
5. Create new page
6. Add to pool
7. Save metadata
8. Navigate to URL (if provided)

**Closing a Session**
1. Retrieve from pool
2. Save storageState to disk (if `save: true`)
3. Update metadata (lastUsed timestamp)
4. Close context
5. Remove from pool

**Session Persistence**
- Cookies, localStorage, sessionStorage saved in `state.json`
- Sessions survive server restarts
- Resume by calling `session.open` with same `id`

### Test Structure

- Tests use Node.js built-in test runner (`node:test`)
- No external test framework dependencies
- Tests located in `test/` directory
- Mock objects used for unit tests
- Integration tests validate session persistence with AJV schema validation

## Important Notes

**Stealth Limitations**
- Best-effort evasion, not foolproof
- Some sites may still detect automation
- Disabled `user-data-dir` evasion to support session persistence

**Browser Lifecycle**
- Browser instance is shared across all sessions
- Browser only closes when server shuts down
- Sessions close independently, browser stays alive

**Session IDs**
- Must be filesystem-safe (used as directory names)
- No validation on session ID format (trust the LLM)

**Headless Mode**
- Required for servers without X display
- Use `xvfb-run` wrapper for servers that need visible mode without X
- Visible mode useful for manual login, debugging, element inspection
