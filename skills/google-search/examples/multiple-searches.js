/**
 * Multiple Google Searches Example
 *
 * Demonstrates how to perform multiple searches
 * in the same browser session to save time and
 * maintain cookies/session state.
 */

const searches = [
  { query: 'unicorn', filename: 'search-unicorn.png' },
  { query: 'dachshund', filename: 'search-dachshund.png' },
  { query: 'platypus', filename: 'search-platypus.png' }
]

async function performMultipleSearches() {
  const sessionId = 'google-multi-search'

  try {
    // Open session once
    console.log('Opening browser session...')
    await mcp__szkrabok__session_open({
      id: sessionId,
      url: 'https://google.com',
      config: { headless: true, stealth: true }
    })

    // Perform each search
    for (const search of searches) {
      console.log(`\nSearching for: "${search.query}"`)

      // Type query (clear existing first by selecting all)
      await mcp__szkrabok__interact_click({
        id: sessionId,
        selector: 'textarea[name="q"]'
      })

      await mcp__szkrabok__browserpress_key({
        id: sessionId,
        key: 'Control+a'
      })

      await mcp__szkrabok__interact_type({
        id: sessionId,
        selector: 'textarea[name="q"]',
        text: search.query
      })

      // Submit
      await mcp__szkrabok__browserpress_key({
        id: sessionId,
        key: 'Enter'
      })

      // Screenshot
      await mcp__szkrabok__extract_screenshot({
        id: sessionId,
        path: search.filename
      })

      console.log(`✓ Saved to ${search.filename}`)
    }

    console.log('\n✓ All searches completed!')

  } catch (error) {
    console.error('Error:', error)
    throw error
  } finally {
    await mcp__szkrabok__session_close({
      id: sessionId,
      save: true
    })
  }
}

performMultipleSearches()
