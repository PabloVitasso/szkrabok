# Basic Usage Examples

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
    viewport: { width: 1366, height: 768 },
    locale: 'pl-PL',
    timezone: 'Europe/Warsaw'
  }
})

session.close({ id: 'custom-config' })
```