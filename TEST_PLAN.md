# Szkrabok Migration Test Plan

## Overview

This document outlines the comprehensive testing strategy for verifying the szkrabok upstream migration.

---

## Pre-Migration Tests (Baseline)

Run these tests on the current `main` branch to establish a baseline:

### Unit Tests
```bash
npm test test/basic.test.js      # Pool and storage
npm test test/schema.test.js     # JSON schema validation
```

### Integration Tests
```bash
npm test test/playwright_mcp.test.js  # Upstream tool integration
npm test test/scrap.test.js           # Stealth validation
```

### Manual Tests
```bash
# Session persistence
node cli.js session open baseline --url https://example.com
node cli.js session list
node cli.js session inspect baseline
# Restart server
npm start  # In another terminal
node cli.js session list  # Should show 'baseline' session

# Stealth validation
node cli.js session open stealth-test --url https://bot.sannysoft.com/
# Wait 20 seconds for all tests to complete
# Take screenshot and verify low bot detection score
```

**Record Results**:
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Session persists across server restarts
- [ ] Stealth evades bot detection (sannysoft.com shows mostly green/low scores)

---

## Post-Migration Tests (Validation)

Run these tests on the migration branch to verify features still work:

### 1. Installation & Startup

```bash
npm install
npm start
# Should start without errors
# Should display MCP server name and version
```

**Expected**: Server starts successfully, no dependency errors

- [ ] Dependencies install cleanly
- [ ] Server starts without errors
- [ ] No deprecation warnings for szkrabok dependencies

### 2. Unit Tests

```bash
npm test test/basic.test.js
```

**Expected**: All pool and storage tests pass

**Test Coverage**:
- [ ] `pool.add()` registers session
- [ ] `pool.get()` retrieves session
- [ ] `pool.has()` checks existence
- [ ] `pool.remove()` unregisters session
- [ ] `pool.list()` returns all sessions
- [ ] `pool.get()` throws on missing session
- [ ] `storage.sessionExists()` checks disk state

### 3. Schema Validation Tests

```bash
npm test test/schema.test.js
```

**Expected**: All tool schemas are valid JSON Schema

**Test Coverage**:
- [ ] All szkrabok tools have valid schemas
- [ ] All upstream tools have valid schemas (if still wrapped)
- [ ] Array properties have `items` defined
- [ ] No strict mode violations

### 4. Playwright-MCP Integration Tests

```bash
npm test test/playwright_mcp.test.js
```

**Expected**: Upstream tool integration works

**Test Coverage**:
- [ ] `session.open()` creates session
- [ ] `playwrightMcp.snapshot()` returns accessibility tree
- [ ] `playwrightMcp.click()` clicks refs
- [ ] `playwrightMcp.navigate()` navigates to URL
- [ ] `session.close()` cleans up session

**Troubleshooting**:
- If snapshot format changed, update `LINK_REGEX` in test
- If tool names changed, update imports

### 5. Stealth Tests

```bash
npm test test/scrap.test.js
```

**Expected**: Stealth evasions work, bot detection avoided

**Test Coverage**:
- [ ] Session opens with stealth enabled
- [ ] Page loads fully (networkidle)
- [ ] JavaScript tests complete (15s wait)
- [ ] HTML content extracted
- [ ] Visual state saved
- [ ] Content contains expected keywords

**Manual Validation**:
1. Open generated `YYYYMMDD-HHMM-visual.html` in browser
2. Check for green/low scores in bot detection results
3. Verify `navigator.webdriver` is `false` or `undefined`

### 6. Session Management Tests

#### 6a. Session Persistence
```bash
# Terminal 1: Start server
npm start

# Terminal 2: Create persistent session
node cli.js session open persist-test --url https://httpbin.org/cookies/set/test/value123
node cli.js session list
# Note the session ID and timestamp

# Terminal 2: Stop server (Ctrl+C in Terminal 1)
# Terminal 1: Restart server
npm start

# Terminal 2: Check session persisted
node cli.js session list
# Should show persist-test with original timestamp

# Terminal 2: Resume session (cookies should be preserved)
node cli.js session open persist-test --url https://httpbin.org/cookies
# Extract page to verify cookies
```

**Expected**:
- [ ] Session listed after restart
- [ ] Cookies preserved
- [ ] `lastUsed` timestamp updated on resume

#### 6b. Session Cleanup
```bash
# Create multiple sessions
node cli.js session open old-session-1
node cli.js session open old-session-2
node cli.js session open recent-session

# List all sessions
node cli.js session list

# Delete old sessions (adjust --days as needed)
node cli.js cleanup --days 0

# Verify cleanup
node cli.js session list
# Should show only active or recent sessions
```

**Expected**:
- [ ] Old sessions deleted from disk
- [ ] Active sessions preserved
- [ ] No errors during cleanup

#### 6c. Session Inspection
```bash
node cli.js session open inspect-test --url https://example.com
node cli.js session inspect inspect-test

# Should display:
# - Session ID
# - Created/lastUsed timestamps
# - Cookies
# - localStorage entries
# - sessionStorage entries
```

**Expected**:
- [ ] Metadata displayed correctly
- [ ] Cookies listed (if any)
- [ ] Storage entries shown (if any)

### 7. CSS Selector Tool Tests

Create a simple test HTML file for manual testing:

```bash
# Create test page
cat > /tmp/test-page.html <<'EOF'
<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <h1 id="header">Test Header</h1>
  <input id="username" type="text" placeholder="Username">
  <input id="password" type="password" placeholder="Password">
  <select id="country">
    <option value="us">United States</option>
    <option value="uk">United Kingdom</option>
  </select>
  <button id="submit">Submit</button>
  <div id="result"></div>
  <script>
    document.getElementById('submit').onclick = function() {
      const user = document.getElementById('username').value;
      const country = document.getElementById('country').value;
      document.getElementById('result').textContent = `User: ${user}, Country: ${country}`;
    };
  </script>
</body>
</html>
EOF

# Serve it
python3 -m http.server 8888 --directory /tmp &
SERVER_PID=$!
```

Test szkrabok CSS selector tools:

```javascript
// test-css-tools.js
const session = require('./tools/session')
const interact = require('./tools/interact')
const extract = require('./tools/extract')
const navigate = require('./tools/navigate')

(async () => {
  const id = 'css-test'

  // Open session
  await session.open({ id, url: 'http://localhost:8888/test-page.html' })

  // Test interact.type
  await interact.type({ id, selector: '#username', text: 'testuser' })
  await interact.type({ id, selector: '#password', text: 'testpass' })

  // Test interact.select
  await interact.select({ id, selector: '#country', value: 'uk' })

  // Test interact.click
  await interact.click({ id, selector: '#submit' })

  // Wait a bit for JS to execute
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Test extract.text
  const result = await extract.text({ id, selector: '#result' })
  console.log('Result text:', result)

  // Test extract.html
  const html = await extract.html({ id })
  console.log('HTML length:', html.content.length)

  // Test extract.screenshot
  await extract.screenshot({ id, path: '/tmp/css-test.png', fullPage: true })

  // Test navigate.back
  await navigate.back({ id })
  await new Promise(resolve => setTimeout(resolve, 500))

  // Test navigate.forward
  await navigate.forward({ id })

  // Clean up
  await session.close({ id, save: false })

  console.log('✓ All CSS selector tests passed')
  process.exit(0)
})().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
```

```bash
node test-css-tools.js
kill $SERVER_PID  # Stop test server
```

**Expected**:
- [ ] `interact.type()` fills input fields
- [ ] `interact.select()` selects dropdown options
- [ ] `interact.click()` clicks button
- [ ] `extract.text()` retrieves text content
- [ ] `extract.html()` retrieves HTML
- [ ] `extract.screenshot()` captures screenshot
- [ ] `navigate.back()` goes back
- [ ] `navigate.forward()` goes forward

### 8. Workflow Tool Tests

```javascript
// test-workflows.js
const session = require('./tools/session')
const workflow = require('./tools/workflow')

(async () => {
  const id = 'workflow-test'

  // Test workflow.fillForm
  await session.open({ id, url: 'http://localhost:8888/test-page.html' })
  await workflow.fillForm({
    id,
    fields: {
      '#username': 'alice',
      '#password': 'secret123',
      '#country': 'uk'
    }
  })
  console.log('✓ fillForm works')

  // Test workflow.scrape
  const data = await workflow.scrape({
    id,
    selectors: {
      title: 'h1',
      username_placeholder: '#username::placeholder',
      options: '#country option'
    }
  })
  console.log('Scraped data:', data)

  await session.close({ id, save: false })
  console.log('✓ All workflow tests passed')
})().catch(err => {
  console.error('Workflow test failed:', err)
  process.exit(1)
})
```

**Expected**:
- [ ] `workflow.fillForm()` fills multiple fields
- [ ] `workflow.scrape()` extracts structured data

### 9. MCP Inspector Test

```bash
npx @modelcontextprotocol/inspector szkrabok-playwright-mcp
```

**Manual Checks**:
- [ ] Inspector connects successfully
- [ ] All tools listed (szkrabok + upstream)
- [ ] Tool schemas display correctly
- [ ] Can call `session.open` via inspector
- [ ] Can call `browser.snapshot` via inspector (if upstream tools exposed)
- [ ] Can call `session.close` via inspector

### 10. CLI Tests

```bash
# Test all CLI commands
node cli.js session list
node cli.js session open cli-test --url https://example.com
node cli.js session list
node cli.js session inspect cli-test
node cli.js session delete cli-test
node cli.js session list  # Should not show cli-test

# Test cleanup
node cli.js cleanup --days 30
node cli.js cleanup --help
```

**Expected**:
- [ ] `session list` shows all sessions
- [ ] `session open` creates new session
- [ ] `session inspect` shows details
- [ ] `session delete` removes session
- [ ] `cleanup` removes old sessions
- [ ] `--help` shows usage

---

## Regression Tests

### Upstream Tool Compatibility

If szkrabok wraps upstream tools, verify they still work:

```bash
# Test upstream tools still accessible
# (Depends on how tools/playwright_mcp.js was updated)
```

**Key upstream tools to test**:
- [ ] `browser.snapshot` - Returns accessibility tree
- [ ] `browser.click` - Clicks via ref
- [ ] `browser.navigate` - Navigates via ref
- [ ] `browser.fill` - Fills input via ref
- [ ] `browser.select` - Selects option via ref

---

## Performance Tests

### Session Startup Time

```bash
# Measure cold start (first session)
time node cli.js session open perf-test-1 --url https://example.com

# Measure warm start (second session)
time node cli.js session open perf-test-2 --url https://example.com

# Clean up
node cli.js session delete perf-test-1
node cli.js session delete perf-test-2
```

**Baseline** (pre-migration):
- Cold start: ~X seconds
- Warm start: ~Y seconds

**Target** (post-migration):
- Cold start: Should be within 10% of baseline
- Warm start: Should be within 10% of baseline

### Memory Usage

```bash
# Start server
npm start &
MCP_PID=$!

# Create multiple sessions
for i in {1..10}; do
  node cli.js session open "mem-test-$i" --url https://example.com
done

# Check memory
ps aux | grep node

# Clean up
kill $MCP_PID
```

**Expected**:
- Memory usage should be reasonable (~100-200MB per session)
- No memory leaks over time

---

## Edge Cases & Error Handling

### Duplicate Session ID
```bash
node cli.js session open duplicate
node cli.js session open duplicate  # Should fail gracefully
```

**Expected**:
- [ ] Second `open` returns clear error
- [ ] No server crash

### Missing Session
```bash
# Try to interact with non-existent session
node -e "require('./tools/interact').click({ id: 'nonexistent', selector: 'button' })"
```

**Expected**:
- [ ] Clear `SessionNotFoundError`
- [ ] Error message includes session ID

### Invalid Selector
```bash
node cli.js session open invalid-test --url https://example.com
node -e "require('./tools/interact').click({ id: 'invalid-test', selector: 'invalid>>selector' })"
```

**Expected**:
- [ ] Playwright error caught and wrapped
- [ ] Error message describes issue

### Network Timeout
```bash
node cli.js session open timeout-test --url https://httpstat.us/524?sleep=60000
```

**Expected**:
- [ ] Timeout occurs after configured limit
- [ ] Session can still be closed

---

## Acceptance Criteria

Migration is successful when:

- [ ] All pre-migration tests pass on `main` branch
- [ ] All post-migration tests pass on migration branch
- [ ] No regressions in functionality
- [ ] Performance within 10% of baseline
- [ ] Documentation updated to reflect changes
- [ ] DEVELOPMENT.md and SYNC_STRATEGY.md reviewed and accurate

---

## Rollback Triggers

Roll back migration if:

- Critical features broken (session persistence, stealth)
- Performance degradation > 20%
- Upstream compatibility issues cannot be resolved within 2 days
- More than 3 blocking bugs discovered

---

## Sign-Off Checklist

Before merging migration branch to `main`:

- [ ] All tests pass
- [ ] Manual testing completed
- [ ] Performance acceptable
- [ ] Documentation updated
- [ ] CHANGELOG.md entry added
- [ ] Git tag created (e.g., `v1.2-upstream-sync`)
- [ ] README.md installation instructions verified

---

**Test Plan Version**: 1.0
**Last Updated**: 2026-02-08
**Author**: Szkrabok Team
