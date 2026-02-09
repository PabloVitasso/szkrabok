/**
 * Reuse Existing Session Example
 *
 * Demonstrates the CORRECT way to use szkrabok for Google searches:
 * - Reuse an existing session that already passed CAPTCHA
 * - No need to create new sessions
 * - Much more reliable and faster
 */

// Configuration
const EXISTING_SESSION_ID = 'google-pl'  // Change to your session ID
const SEARCH_QUERY = 'pomeranian dog'

async function searchWithExistingSession() {
  console.log(`Using existing session: ${EXISTING_SESSION_ID}`)
  console.log(`Search query: "${SEARCH_QUERY}"\n`)

  try {
    // Step 1: Reopen the existing session
    console.log('Reopening session (cookies and state preserved)...')
    await mcp__szkrabok__session_open({
      id: EXISTING_SESSION_ID,
      url: 'https://google.com',
      config: {
        headless: true,  // Can use headless since CAPTCHA already solved
        stealth: true
      }
    })
    console.log('✓ Session opened\n')

    // Step 2: Type search query
    console.log('Typing search query...')
    await mcp__szkrabok__interact_type({
      id: EXISTING_SESSION_ID,
      selector: 'textarea[name="q"]',
      text: SEARCH_QUERY
    })
    console.log('✓ Query entered\n')

    // Step 3: Submit search
    console.log('Submitting search...')
    await mcp__szkrabok__browserpress_key({
      id: EXISTING_SESSION_ID,
      key: 'Enter'
    })
    console.log('✓ Search submitted\n')

    // Step 4: Extract results
    console.log('Extracting search results...')
    const results = await mcp__szkrabok__browserevaluate({
      id: EXISTING_SESSION_ID,
      function: `() => {
        const results = [];
        const elements = document.querySelectorAll('div.g');

        elements.forEach((el, index) => {
          const title = el.querySelector('h3')?.textContent;
          const url = el.querySelector('a')?.href;
          const snippet = el.querySelector('.VwiC3b, .yXK7lf, .s')?.textContent;

          if (title && url) {
            results.push({
              position: index + 1,
              title: title,
              url: url,
              snippet: snippet || ''
            });
          }
        });

        return {
          searchQuery: '${SEARCH_QUERY}',
          resultsCount: results.length,
          results: results.slice(0, 5)  // Top 5 results
        };
      }`
    })

    console.log('✓ Results extracted\n')
    console.log('Search Results:')
    console.log(JSON.stringify(results, null, 2))

    // Step 5: Take screenshot
    console.log('\nCapturing screenshot...')
    await mcp__szkrabok__extract_screenshot({
      id: EXISTING_SESSION_ID,
      path: `search-${SEARCH_QUERY.replace(/\s+/g, '-')}.png`
    })
    console.log('✓ Screenshot saved\n')

    console.log('✓ Search completed successfully!')

  } catch (error) {
    console.error('Error during search:', error.message)

    if (error.code === 'SESSION_NOT_FOUND') {
      console.error('\nSession not found! Please create it first:')
      console.error(`  node cli.js session open ${EXISTING_SESSION_ID} --url https://google.com`)
    }

    throw error
  } finally {
    // Close session and save state for next time
    console.log('\nClosing session (state will be saved)...')
    await mcp__szkrabok__session_close({
      id: EXISTING_SESSION_ID,
      save: true
    })
    console.log('✓ Session closed and saved for reuse\n')
  }
}

// Run the search
searchWithExistingSession()

/*
 * NOTES:
 *
 * 1. This assumes you already have a session called "google-pl"
 *    (or whatever EXISTING_SESSION_ID is set to)
 *
 * 2. If the session doesn't exist, create it first:
 *    - Open visible browser: node cli.js session open google-pl --url https://google.com
 *    - Solve any CAPTCHA manually
 *    - Close: node cli.js session close google-pl
 *
 * 3. After that, this script can run headless without CAPTCHA issues!
 *
 * 4. Check available sessions with: node cli.js session list
 */
