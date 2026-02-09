---
name: Google Search
description: Perform automated Google searches with screenshots using szkrabok browser automation
version: 1.0.0
---

# Google Search Skill

This skill performs automated Google searches using the szkrabok MCP server's browser automation capabilities. It opens a browser session, searches Google, and captures the results.

## When to Use This Skill

Use this skill when you need to:
- Perform automated Google searches and capture results
- Test search functionality or verify search results
- Gather visual evidence of search results
- Automate repetitive search tasks

## Prerequisites

The szkrabok MCP server must be configured and running. This skill uses the following MCP tools:
- `mcp__szkrabok__session_open` - Open browser session
- `mcp__szkrabok__interact_type` - Type into search box
- `mcp__szkrabok__browserpress_key` - Press Enter to search
- `mcp__szkrabok__extract_screenshot` - Capture screenshot
- `mcp__szkrabok__session_close` - Close browser session

## How to Use

**IMPORTANT: The correct workflow is to reuse an existing session, not create a new one each time!**

### Recommended Workflow

**Step 1: Create a persistent session once (manually solve CAPTCHA)**
```
Open a browser session called "my-google" at google.com in visible mode
```

**Step 2: Reuse that session for searches**
```
Using session "my-google", search Google for "pomeranian dog" and extract text
```

### Why This Matters

Creating new sessions each time will trigger Google's bot detection. By reusing a session:
- ✅ Cookies and state are preserved
- ✅ No CAPTCHA challenges after initial session
- ✅ Human verification persists
- ✅ Much more reliable automation

## Parameters

- `session-id` (required) - Existing session ID to reuse (e.g., "my-google")
- `query` (required) - The search query to execute
- `screenshot` (optional) - Filename for screenshot
- `extract-data` (optional) - Extract structured results (default: false)

## Workflow

### Initial Setup (One-Time)

1. **Create Session** - Open a visible browser session manually
2. **Solve CAPTCHA** - If Google shows a challenge, solve it manually
3. **Save Session** - Close the session to persist cookies and state

### Automated Searches (Reusing Session)

1. **Reopen Session** - Reuse the existing session by ID
2. **Enter Query** - Type the search query into the search box
3. **Submit Search** - Press Enter to execute the search
4. **Extract Results** - Capture screenshot or extract structured data
5. **Keep Session Open** - Leave session open for next search (optional)

## Implementation

### Initial Setup: Create Persistent Session

**First time only - create a session with visible browser:**

```javascript
// Create visible session to solve CAPTCHA manually
await mcp__szkrabok__session_open({
  id: 'my-google',  // Use a memorable ID
  url: 'https://google.com',
  config: {
    headless: false,  // Visible mode for CAPTCHA
    stealth: true
  }
})

// Manually solve CAPTCHA in the visible browser window

// Close and save the session
await mcp__szkrabok__session_close({
  id: 'my-google',
  save: true  // Persists cookies and state
})
```

### Step 1: Reuse Existing Session

**For automated searches, reopen the existing session:**

```javascript
// Reopen saved session (cookies preserved)
await mcp__szkrabok__session_open({
  id: 'my-google',  // Same ID as before
  url: 'https://google.com',
  config: {
    headless: true,  // Now can use headless
    stealth: true
  }
})
```

### Step 2: Type Search Query

Locate the search input and type the query:

```javascript
await mcp__szkrabok__interact_type({
  id: sessionId,
  selector: 'textarea[name="q"]',
  text: searchQuery
})
```

### Step 3: Submit Search

Press Enter to submit the search form:

```javascript
await mcp__szkrabok__browserpress_key({
  id: sessionId,
  key: 'Enter'
})
```

### Step 4: Capture Screenshot

Take a screenshot of the search results:

```javascript
await mcp__szkrabok__extract_screenshot({
  id: sessionId,
  fullPage: false,
  path: screenshotPath
})
```

### Step 5: Close Session

Close the browser session and save state:

```javascript
await mcp__szkrabok__session_close({
  id: sessionId,
  save: true
})
```

## Complete Example

### Example 1: Reusing Existing Session (Recommended)

```javascript
// Assumes you already have a session called "google-pl" that passed CAPTCHA
const sessionId = 'google-pl'  // Reuse existing session!
const searchQuery = 'pomeranian dog'

try {
  // Reopen the existing session
  await mcp__szkrabok__session_open({
    id: sessionId,
    url: 'https://google.com',
    config: { headless: true, stealth: true }
  })

  // Type search query
  await mcp__szkrabok__interact_type({
    id: sessionId,
    selector: 'textarea[name="q"]',
    text: searchQuery
  })

  // Submit search
  await mcp__szkrabok__browserpress_key({
    id: sessionId,
    key: 'Enter'
  })

  // Extract search results as structured data
  const results = await mcp__szkrabok__browserevaluate({
    id: sessionId,
    function: `() => {
      const results = [];
      document.querySelectorAll('div.g').forEach((el, i) => {
        const title = el.querySelector('h3')?.textContent;
        const url = el.querySelector('a')?.href;
        const snippet = el.querySelector('.VwiC3b, .yXK7lf')?.textContent;
        if (title && url) results.push({ position: i+1, title, url, snippet });
      });
      return results;
    }`
  })

  console.log('Search results:', results)

  // Optionally take screenshot
  await mcp__szkrabok__extract_screenshot({
    id: sessionId,
    path: 'search-results.png'
  })

} finally {
  // Close but keep session for next search
  await mcp__szkrabok__session_close({
    id: sessionId,
    save: true
  })
}
```

### Example 2: First-Time Setup (Creating New Session)

```javascript
// ONLY run this once to create a new persistent session
const sessionId = 'my-google'

// Step 1: Create visible session
await mcp__szkrabok__session_open({
  id: sessionId,
  url: 'https://google.com',
  config: { headless: false, stealth: true }  // Visible!
})

// Step 2: Manually solve CAPTCHA in the browser window if needed

// Step 3: Close and save
await mcp__szkrabok__session_close({
  id: sessionId,
  save: true
})

console.log('Session saved! Now you can reuse it with headless mode.')
```

## Error Handling

Common errors and solutions:

**SessionNotFoundError**
- Session was closed or doesn't exist
- Solution: Open a new session before performing actions

**Target page has been closed**
- Browser window was manually closed
- Solution: Check session exists before operations, handle gracefully

**Selector not found**
- Google's page structure changed or page didn't load
- Solution: Verify URL loaded correctly, check for CAPTCHA challenges

**Timeout errors**
- Page took too long to load
- Solution: Check network connectivity, increase timeout settings

## Best Practices

1. **ALWAYS reuse existing sessions** - Create once, reuse many times
2. **Solve CAPTCHA manually first** - Use visible mode for initial setup
3. **Save sessions properly** - Use `save: true` to persist state
4. **Use headless after setup** - Once CAPTCHA is solved, headless works fine
5. **Keep sessions alive** - Don't close between searches if doing multiple
6. **Handle errors gracefully** - Wrap operations in try/finally blocks
7. **Check session exists** - Use `session.list` to see available sessions

## Advanced Usage

### Session Management

**Check available sessions:**
```bash
node cli.js session list
```

**Inspect a session:**
```bash
node cli.js session inspect google-pl
```

**Delete old session:**
```bash
node cli.js session delete old-session-id
```

### Reusing Sessions (The Right Way)

**Key concept:** One session = One "Google identity"

```javascript
// Session "google-pl" already exists and passed CAPTCHA

// Search 1
await session_open({ id: 'google-pl', url: 'https://google.com' })
// ... search for "unicorn" ...
await session_close({ id: 'google-pl', save: true })

// Search 2 - Same session, no CAPTCHA!
await session_open({ id: 'google-pl', url: 'https://google.com' })
// ... search for "dachshund" ...
await session_close({ id: 'google-pl', save: true })

// Both searches use the same cookies/state
```

### Multiple Searches

Perform multiple searches in the same session:

```javascript
await mcp__szkrabok__session_open({ id: 'google', url: 'https://google.com' })

for (const query of ['unicorn', 'dachshund', 'platypus']) {
  await mcp__szkrabok__interact_type({ id: 'google', selector: 'textarea[name="q"]', text: query })
  await mcp__szkrabok__browserpress_key({ id: 'google', key: 'Enter' })
  await mcp__szkrabok__extract_screenshot({ id: 'google', path: `search-${query}.png` })

  // Navigate back or clear search box for next query
  await mcp__szkrabok__navback({ id: 'google' })
}

await mcp__szkrabok__session_close({ id: 'google' })
```

### Extracting Search Results

Capture result text along with screenshot:

```javascript
// After search completes
const results = await mcp__szkrabok__extract_text({
  id: sessionId,
  selector: '#search'
})

// Parse results as needed
console.log('Search results:', results)
```

## Troubleshooting

**Search not executing**
- Verify the search box selector: `textarea[name="q"]`
- Check if Google loaded properly (may redirect to country-specific domain)
- Look for CAPTCHA challenges that need manual solving

**Screenshot is blank**
- Page may not have finished loading
- Solution: Check current URL to verify navigation completed

**Session closes unexpectedly**
- User may have manually closed browser window
- Solution: Enable headless mode to prevent manual interaction

## See Also

- [szkrabok MCP Server Documentation](../../README.md)
- [Session Management](../../CLAUDE.md#session-management)
- [Browser Interaction Tools](../../docs/)
