# Google Search Selectors Reference

This document provides CSS selectors and DOM structure information for automating Google Search.

## Primary Selectors

### Search Input Box

```css
textarea[name="q"]
```

The main search input field on Google's homepage and search results page. This is a textarea element, not an input.

**Alternative selectors:**
- `input[name="q"]` - Used on older Google pages
- `#APjFqb` - Specific ID (may change)
- `.gLFyf` - Class name (may change)

**Best practice:** Use `textarea[name="q"]` as it's the most stable selector.

### Search Button

```css
input[name="btnK"]
```

The "Google Search" button. However, pressing Enter in the search box is more reliable.

### Search Results Container

```css
#search
```

Container for all search results.

```css
div.g
```

Individual search result item.

### Result Components

**Result title (h3):**
```css
div.g h3
```

**Result link:**
```css
div.g a
```

**Result snippet:**
```css
div.g .VwiC3b
div.g .yXK7lf
```

**Result URL display:**
```css
div.g cite
```

## Advanced Selectors

### Knowledge Panel

```css
div[data-attrid="kc:/location/location:address"]
```

Knowledge panel on the right side of results.

### Featured Snippet

```css
.xpdopen
.kp-blk
```

Featured snippets that appear at the top of results.

### Image Results

```css
div[data-ri]
```

Image results in the main search or image search page.

### "People Also Ask" Box

```css
.related-question-pair
```

Expandable questions related to the search.

### Search Tools

```css
#hdtb-tls
```

Tools dropdown (date filters, etc.)

### Safe Search / Filter Options

```css
#hdtb-more-mn
```

More options menu.

## Navigation Patterns

### Next Page

```css
a#pnnext
```

"Next" button at bottom of results.

### Previous Page

```css
a#pnprev
```

"Previous" button.

### Page Numbers

```css
td.cur
```

Current page number.

```css
a.fl
```

Other page number links.

## Regional Variations

Google's DOM structure can vary by:
- Country/region (google.com vs google.co.uk vs google.pl)
- Language settings
- Logged in vs logged out
- Desktop vs mobile viewport

**Common differences:**

| Region | Search Box | Notes |
|--------|-----------|-------|
| google.com | `textarea[name="q"]` | Standard |
| google.pl | `textarea[name="q"]` | Standard |
| google.co.uk | `textarea[name="q"]` | Standard |
| Mobile | `input[name="q"]` | Often input instead of textarea |

## Dynamic Content

Google uses JavaScript to load and modify content dynamically. Key considerations:

1. **Search suggestions** appear as you type
2. **Instant results** may load without page navigation
3. **Lazy loading** for images and lower results
4. **A/B testing** means different users see different structures

## Best Practices

### Selector Priority

1. Use `name` attributes (most stable)
2. Use semantic selectors (e.g., `h3` for titles)
3. Avoid IDs and classes (they change frequently)
4. Use data attributes as last resort

### Waiting Strategies

```javascript
// Bad: Fixed timeout
await sleep(2000)

// Good: Wait for specific element
await page.waitForSelector('div.g')

// Better: Wait for network idle
await page.waitForLoadState('networkidle')
```

### Handling Changes

Google frequently updates their HTML. To make your automation resilient:

```javascript
// Try multiple selectors
const selectors = [
  'textarea[name="q"]',
  'input[name="q"]',
  '#APjFqb'
]

for (const selector of selectors) {
  try {
    await page.click(selector)
    break
  } catch (e) {
    continue
  }
}
```

## Anti-Bot Detection

Google actively detects and blocks bots. Mitigation strategies:

1. **Use stealth mode** - Masks automation markers
2. **Human-like delays** - Add random delays between actions
3. **Proper User-Agent** - Use real browser UA strings
4. **Maintain sessions** - Reuse cookies and session state
5. **Rotate IPs** - Use proxies if doing high volume
6. **Solve CAPTCHAs** - May require manual intervention

## Example: Robust Search Function

```javascript
async function robustGoogleSearch(sessionId, query) {
  // Open with stealth
  await session_open({
    id: sessionId,
    url: 'https://google.com',
    config: { stealth: true, headless: true }
  })

  // Find and interact with search box
  const searchBoxSelectors = [
    'textarea[name="q"]',
    'input[name="q"]',
    '#APjFqb'
  ]

  let searchBoxFound = false
  for (const selector of searchBoxSelectors) {
    try {
      await interact_type({
        id: sessionId,
        selector: selector,
        text: query
      })
      searchBoxFound = true
      break
    } catch (e) {
      continue
    }
  }

  if (!searchBoxFound) {
    throw new Error('Could not find search box')
  }

  // Submit
  await browserpress_key({
    id: sessionId,
    key: 'Enter'
  })

  // Verify results loaded
  const currentUrl = await browserevaluate({
    id: sessionId,
    function: '() => window.location.href'
  })

  if (!currentUrl.includes('/search?q=')) {
    throw new Error('Search did not execute properly')
  }

  return currentUrl
}
```

## Common Errors

### "Element not found"
- Search box selector changed
- Page didn't load fully
- CAPTCHA blocking the page

**Solution:** Use multiple selector fallbacks, check for CAPTCHA

### "Navigation timeout"
- Network issue
- Google blocking your IP
- Page stuck loading

**Solution:** Add timeout handling, check network connectivity

### "Element not interactable"
- Element covered by another element (cookie banner, etc.)
- Element not yet visible

**Solution:** Wait for element to be visible, dismiss overlays first

## Cookie Banner Handling

Google shows cookie consent banners in some regions:

```javascript
// Dismiss cookie banner (EU)
try {
  await interact_click({
    id: sessionId,
    selector: 'button[aria-label="Accept all"]'
  })
} catch (e) {
  // Banner may not exist
}
```

## See Also

- [Playwright Selectors Documentation](https://playwright.dev/docs/selectors)
- [Google Search URL Parameters](https://moz.com/blog/the-ultimate-guide-to-the-google-search-parameters)
- [szkrabok Interaction Tools](../../../CLAUDE.md)
