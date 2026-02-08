# Szkrabok Quick Usage Guide

## 🚀 First Steps

### 1. List Sessions
```
"List all szkrabok sessions"
```

### 2. Open a Session
```
"Open a szkrabok session called 'work' and navigate to https://example.com"
```

### 3. Interact with Page
```
"Click the button with selector '#submit' in the work session"
"Type 'hello' into the input with selector '#search'"
"Extract text from selector 'h1'"
```

### 4. Close Session
```
"Close the work session and save its state"
```

## 🎯 Common Tasks

### Login Automation
```
"Use workflow.login in session 'work' with username 'user@example.com' and password 'password123'"
```

### Data Extraction
```
"Use workflow.scrape in session 'work' to extract:
- title from 'h1'
- content from '.main-content'
- links from 'a'"
```

### Form Filling
```
"Use workflow.fillForm in session 'work' with:
- '#name': 'John Doe'
- '#email': 'john@example.com'
- '#country': 'US'"
```

## 🛠️ Tool Categories

### Session Management
- `session.open` - Create/resume session
- `session.close` - Save and close
- `session.list` - View all sessions
- `session.delete` - Remove permanently

### Navigation
- `nav.goto` - Navigate to URL
- `nav.back` - Go back
- `nav.forward` - Go forward

### Interaction (CSS Selectors)
- `interact.click` - Click element
- `interact.type` - Type text
- `interact.select` - Select dropdown

### Extraction
- `extract.text` - Get text content
- `extract.html` - Get HTML
- `extract.screenshot` - Take screenshot
- `extract.evaluate` - Run JavaScript

### Workflows
- `workflow.login` - Auto-login
- `workflow.fillForm` - Fill forms
- `workflow.scrape` - Extract data

## 💡 Pro Tips

1. **Session Persistence**: Sessions survive server restarts
2. **Stealth Mode**: Enabled by default in config
3. **CSS Selectors**: Use browser DevTools to find selectors
4. **Error Handling**: Check ERROR_GUIDE.md for context7 usage

## 🆘 Need Help?

- **Commands**: See QUICK_REFERENCE.md
- **Errors**: See ERROR_GUIDE.md
- **Examples**: See examples/ directory
- **Full docs**: See README.md
