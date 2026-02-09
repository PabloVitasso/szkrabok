# Google Search Skill

Automated Google search skill using the szkrabok MCP server's browser automation capabilities.

## Quick Start

This skill demonstrates how to:
1. Open a browser session with stealth mode
2. Navigate to Google
3. Perform searches
4. Capture screenshots
5. Extract structured data

## Files

```
google-search/
├── SKILL.md              # Main skill documentation
├── README.md             # This file
├── examples/             # Example implementations
│   ├── basic-search.js
│   ├── multiple-searches.js
│   └── extract-results.js
├── references/           # Reference documentation
│   └── selectors.md      # Google DOM selectors guide
└── scripts/              # Helper scripts
    └── run-example.sh
```

## Installation

This skill requires the szkrabok MCP server to be configured in your Claude Code settings.

**Add to `.claude/settings.local.json`:**

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": ["/path/to/szkrabok/index.js"],
      "env": {
        "HEADLESS": "true"
      }
    }
  }
}
```

## Usage

### From Claude Code

Simply ask Claude to search Google:

```
Search Google for "unicorn" and take a screenshot
```

Claude will automatically use the szkrabok MCP tools to perform the search.

### Running Examples

**Basic search:**
```bash
cd skills/google-search
./scripts/run-example.sh basic
```

**Multiple searches:**
```bash
./scripts/run-example.sh multiple
```

**Extract results:**
```bash
./scripts/run-example.sh extract
```

## Key Concepts

### Session Persistence

Sessions are saved to disk and can be reused:

```javascript
// First time - creates new session
await session_open({ id: 'my-google', url: 'https://google.com' })
await session_close({ id: 'my-google', save: true })

// Later - reuses same session with cookies
await session_open({ id: 'my-google', url: 'https://google.com' })
```

### Stealth Mode

Always enable stealth mode to avoid bot detection:

```javascript
config: { stealth: true }
```

### Headless vs Visible

**Headless** (recommended for automation):
```javascript
config: { headless: true }
```

**Visible** (useful for debugging):
```javascript
config: { headless: false }
```

## API Reference

### Core Tools Used

**session.open** - Open browser session
- `id` - Unique session identifier
- `url` - URL to navigate to
- `config` - Browser configuration

**interact.type** - Type text into element
- `id` - Session ID
- `selector` - CSS selector
- `text` - Text to type

**browser.press_key** - Press keyboard key
- `id` - Session ID
- `key` - Key to press (e.g., 'Enter')

**extract.screenshot** - Capture screenshot
- `id` - Session ID
- `path` - Output filename
- `fullPage` - Capture full page (optional)

**session.close** - Close session
- `id` - Session ID
- `save` - Save session state (default: true)

## Examples

### Basic Search

```javascript
await session_open({
  id: 'google',
  url: 'https://google.com',
  config: { headless: true, stealth: true }
})

await interact_type({
  id: 'google',
  selector: 'textarea[name="q"]',
  text: 'unicorn'
})

await browserpress_key({
  id: 'google',
  key: 'Enter'
})

await extract_screenshot({
  id: 'google',
  path: 'results.png'
})

await session_close({ id: 'google' })
```

### Extract Results

```javascript
const results = await browserevaluate({
  id: 'google',
  function: `() => {
    return Array.from(document.querySelectorAll('div.g')).map(el => ({
      title: el.querySelector('h3')?.textContent,
      url: el.querySelector('a')?.href,
      snippet: el.querySelector('.VwiC3b')?.textContent
    }))
  }`
})
```

## Troubleshooting

**"SessionNotFoundError"**
- Session was closed or doesn't exist
- Solution: Open session before using it

**"Element not found: textarea[name='q']"**
- Google's page structure changed
- Solution: Check references/selectors.md for alternatives

**"Target page has been closed"**
- Browser window closed unexpectedly
- Solution: Use headless mode to prevent manual closing

**CAPTCHA challenges**
- Google detected automation
- Solution: Use stealth mode, add delays, rotate IPs

## Best Practices

1. ✅ Always use stealth mode
2. ✅ Close sessions properly
3. ✅ Use try/finally for cleanup
4. ✅ Handle errors gracefully
5. ✅ Reuse sessions when possible
6. ❌ Don't make rapid repeated searches
7. ❌ Don't ignore CAPTCHAs (solve or retry)

## Advanced Topics

- **Session Management** - See CLAUDE.md for persistence details
- **Selector Strategies** - See references/selectors.md for robust selectors
- **Anti-Bot Evasion** - Stealth mode configuration in core/stealth.js
- **Error Handling** - Custom errors in utils/errors.js

## Contributing

To extend this skill:

1. Add new examples to `examples/`
2. Document new selectors in `references/selectors.md`
3. Add utility scripts to `scripts/`
4. Update SKILL.md with new workflows

## License

Part of the szkrabok MCP server project.

## Related Skills

- Web scraping skill (if available)
- Screenshot skill (if available)
- Form automation skill (if available)
