# Script Usage (Direct API)

Using szkrabok from Node.js scripts via direct imports.

## 1. Simple Navigation

```javascript
import * as session from '../tools/session.js'
import * as extract from '../tools/extract.js'

// Open session
await session.open({ id: 'demo', url: 'https://example.com' })

// Extract content
const { content } = await extract.text({ id: 'demo', selector: 'h1' })
console.log(content)

// Close
await session.close({ id: 'demo' })
```

## 2. Login Workflow

```javascript
import * as session from '../tools/session.js'
import * as workflow from '../tools/workflow.js'
import * as extract from '../tools/extract.js'

// Open on login page
await session.open({ id: 'app', url: 'https://app.example.com/login' })

// Auto-login
await workflow.login({ 
  id: 'app', 
  username: 'user@example.com', 
  password: 'secret123' 
})

// Verify logged in
const { content } = await extract.text({ id: 'app', selector: '.user-name' })
console.log('Logged in as:', content)

// Session persists cookies
await session.close({ id: 'app' })

// Later: resume without login
await session.open({ id: 'app', url: 'https://app.example.com/dashboard' })
```

## 3. Form Filling

```javascript
import * as session from '../tools/session.js'
import * as workflow from '../tools/workflow.js'
import * as interact from '../tools/interact.js'

await session.open({ id: 'form', url: 'https://example.com/contact' })

await workflow.fillForm({
  id: 'form',
  fields: {
    '#name': 'John Doe',
    '#email': 'john@example.com',
    '#message': 'Hello world',
    '#country': 'US'
  }
})

await interact.click({ id: 'form', selector: 'button[type="submit"]' })

await session.close({ id: 'form' })
```

## 4. Data Extraction

```javascript
import * as session from '../tools/session.js'
import * as workflow from '../tools/workflow.js'

await session.open({ id: 'scrape', url: 'https://news.example.com' })

const result = await workflow.scrape({
  id: 'scrape',
  selectors: {
    titles: 'h2.article-title',
    authors: '.author-name',
    dates: 'time.published'
  }
})

console.log(result.data)
// {
//   titles: ['Title 1', 'Title 2'],
//   authors: ['Author 1', 'Author 2'],
//   dates: ['2025-01-01', '2025-01-02']
// }

await session.close({ id: 'scrape' })
```

## 5. Custom JavaScript

```javascript
import * as session from '../tools/session.js'
import * as extract from '../tools/extract.js'

await session.open({ id: 'custom', url: 'https://example.com' })

const { result } = await extract.evaluate({
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

console.log(result)

await session.close({ id: 'custom' })
```

## 6. Session Management

```javascript
import * as session from '../tools/session.js'

// List all sessions
const { sessions } = await session.list()
console.log(sessions)
// [
//   { id: 'demo', active: false },
//   { id: 'app', active: true, createdAt: 1704110400000 }
// ]

// Delete old session
await session.deleteSession({ id: 'old-session' })
```

## 7. Screenshot

```javascript
import * as session from '../tools/session.js'
import * as extract from '../tools/extract.js'

await session.open({ id: 'screenshot', url: 'https://example.com' })

// Save to file
await extract.screenshot({ 
  id: 'screenshot', 
  path: './screenshot.png', 
  fullPage: true 
})

// Get base64
const { base64 } = await extract.screenshot({ id: 'screenshot' })
console.log(base64)

await session.close({ id: 'screenshot' })
```

## 8. Advanced Config

```javascript
import * as session from '../tools/session.js'

await session.open({
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

await session.close({ id: 'custom-config' })
```

## 9. Session Persistence with Manual Login

```javascript
import * as session from '../tools/session.js'
import * as extract from '../tools/extract.js'
import * as pool from '../core/pool.js'

// FIRST TIME: Open visible browser for manual login
await session.open({
  id: 'claude-ai',
  url: 'https://claude.ai',
  config: { stealth: true, headless: false }
})

// Wait for user to close browser window (no timeout)
const { page } = pool.get('claude-ai')
await page.waitForEvent('close', { timeout: 0 })

// Save state when window closed
await session.close({ id: 'claude-ai', save: true })
// → Persisted to ~/.szkrabok/sessions/claude-ai/

// LATER: Reuse session (auto-logged in, headless)
await session.open({
  id: 'claude-ai',  // Same ID = auto-restore
  url: 'https://claude.ai',
  config: { stealth: true, headless: true }
})
// → Already logged in, no user interaction

const { content } = await extract.text({ id: 'claude-ai', selector: 'title' })
console.log('Page:', content)

await session.close({ id: 'claude-ai' })
```

**Workflow:**
1. `session.open` with `headless: false` → visible browser
2. User logs in manually (unlimited time)
3. User closes browser window when done
4. `page.waitForEvent('close')` detects close and returns
5. `session.close` with `save: true` persists state
6. Reopen with same `id` → auto-logged in

**Test:** See [`test/claude-session.test.js`](../test/claude-session.test.js)  
**Storage:** `~/.szkrabok/sessions/{id}/state.json` + `meta.json`
