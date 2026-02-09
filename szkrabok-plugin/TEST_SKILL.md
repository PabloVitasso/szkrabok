# Testing the Google Search Skill

Quick test to verify the skill works.

## Manual Test via Claude Code

Just ask Claude:

\`\`\`
Search Google for "unicorn" and save screenshot as test-unicorn.png
\`\`\`

Claude should:
1. Open a browser session
2. Navigate to Google
3. Type "unicorn" in search box
4. Press Enter
5. Take screenshot
6. Close browser

## Direct MCP Tool Test

Test the underlying tools directly:

\`\`\`javascript
// 1. Open session
await mcp__szkrabok__session_open({
  id: 'test',
  url: 'https://google.com',
  config: { headless: true, stealth: true }
})

// 2. Type query
await mcp__szkrabok__interact_type({
  id: 'test',
  selector: 'textarea[name="q"]',
  text: 'unicorn'
})

// 3. Submit
await mcp__szkrabok__browserpress_key({
  id: 'test',
  key: 'Enter'
})

// 4. Screenshot
await mcp__szkrabok__extract_screenshot({
  id: 'test',
  path: 'test-results.png'
})

// 5. Close
await mcp__szkrabok__session_close({
  id: 'test',
  save: true
})
\`\`\`

## Expected Results

- ✅ Browser opens (headless mode)
- ✅ Google loads
- ✅ Search executes
- ✅ Screenshot created
- ✅ Browser closes cleanly
- ✅ No errors in console

## Common Issues

**"SessionNotFoundError"**
- Session was closed prematurely
- Check browser didn't crash

**"Element not found"**
- Google's HTML changed
- Try alternate selector: \`input[name="q"]\`

**Screenshot is blank**
- Page didn't load
- Add wait time or check URL

## Success Criteria

- [ ] Skill documentation loads in Claude
- [ ] Google search executes successfully
- [ ] Screenshot file is created
- [ ] Screenshot shows search results
- [ ] Browser closes properly
- [ ] Session cleanup works
