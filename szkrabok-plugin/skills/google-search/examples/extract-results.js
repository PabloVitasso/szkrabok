/**
 * Extract Search Results Example
 *
 * Demonstrates how to extract actual search result data
 * from Google, including titles, URLs, and snippets.
 */

async function extractSearchResults(sessionId, query) {
  console.log(`Searching for: "${query}"`)

  try {
    // Open and search
    await mcp__szkrabok__session_open({
      id: sessionId,
      url: 'https://google.com',
      config: { headless: true, stealth: true }
    })

    await mcp__szkrabok__interact_type({
      id: sessionId,
      selector: 'textarea[name="q"]',
      text: query
    })

    await mcp__szkrabok__browserpress_key({
      id: sessionId,
      key: 'Enter'
    })

    // Extract search results using JavaScript evaluation
    const results = await mcp__szkrabok__browserevaluate({
      id: sessionId,
      function: `() => {
        const results = []
        const resultElements = document.querySelectorAll('div.g')

        resultElements.forEach((el, index) => {
          const titleEl = el.querySelector('h3')
          const linkEl = el.querySelector('a')
          const snippetEl = el.querySelector('.VwiC3b, .yXK7lf')

          if (titleEl && linkEl) {
            results.push({
              position: index + 1,
              title: titleEl.textContent,
              url: linkEl.href,
              snippet: snippetEl ? snippetEl.textContent : ''
            })
          }
        })

        return results
      }`
    })

    console.log('\nSearch Results:')
    console.log(JSON.stringify(results, null, 2))

    // Also take a screenshot
    await mcp__szkrabok__extract_screenshot({
      id: sessionId,
      path: `results-${query.replace(/\s+/g, '-')}.png`
    })

    return results

  } finally {
    await mcp__szkrabok__session_close({
      id: sessionId,
      save: true
    })
  }
}

// Example usage
extractSearchResults('google-extract', 'web scraping best practices')
