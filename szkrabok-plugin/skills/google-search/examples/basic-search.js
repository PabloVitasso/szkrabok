/**
 * Basic Google Search Example
 *
 * Demonstrates how to perform a simple Google search
 * using the szkrabok MCP server tools.
 */

// Configuration
const config = {
  sessionId: 'google-search-example',
  query: 'unicorn',
  googleDomain: 'google.com',
  headless: true,
  screenshotPath: 'basic-search-results.png'
}

async function performGoogleSearch() {
  console.log(`Searching Google for: "${config.query}"`)

  try {
    // Step 1: Open browser session
    console.log('Opening browser session...')
    await mcp__szkrabok__session_open({
      id: config.sessionId,
      url: `https://${config.googleDomain}`,
      config: {
        headless: config.headless,
        stealth: true
      }
    })
    console.log('✓ Session opened')

    // Step 2: Type search query
    console.log('Typing search query...')
    await mcp__szkrabok__interact_type({
      id: config.sessionId,
      selector: 'textarea[name="q"]',
      text: config.query
    })
    console.log('✓ Query entered')

    // Step 3: Submit search
    console.log('Submitting search...')
    await mcp__szkrabok__browserpress_key({
      id: config.sessionId,
      key: 'Enter'
    })
    console.log('✓ Search submitted')

    // Step 4: Capture screenshot
    console.log('Capturing screenshot...')
    await mcp__szkrabok__extract_screenshot({
      id: config.sessionId,
      fullPage: false,
      path: config.screenshotPath
    })
    console.log(`✓ Screenshot saved: ${config.screenshotPath}`)

    // Step 5: Get current URL to confirm
    const result = await mcp__szkrabok__browserevaluate({
      id: config.sessionId,
      function: '() => window.location.href'
    })
    console.log(`Current URL: ${result.url}`)

    console.log('\n✓ Search completed successfully!')

  } catch (error) {
    console.error('Error during search:', error)
    throw error
  } finally {
    // Always close session
    console.log('Closing session...')
    await mcp__szkrabok__session_close({
      id: config.sessionId,
      save: true
    })
    console.log('✓ Session closed')
  }
}

// Execute
performGoogleSearch()
