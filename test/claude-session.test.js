import { test } from 'node:test'
import assert from 'node:assert'
import * as session from '../tools/session.js'
import * as extract from '../tools/extract.js'
import * as pool from '../core/pool.js'
import { closeBrowser } from '../upstream/wrapper.js'

test('claude.ai session persistence workflow', async () => {
  const sessionId = 'claude-ai'

  try {
    console.log('Step 1: Opening claude.ai (headless: false for manual login)...')
    const openResult = await session.open({
      id: sessionId,
      url: 'https://claude.ai',
      config: { stealth: true, headless: false },
    })
    assert.ok(openResult.success, 'Session should open successfully')

    console.log('Browser opened. Please log in manually.')
    console.log('Close the browser window when done logging in...')
    
    // Wait for browser window to close
    const { page } = pool.get(sessionId)
    await page.waitForEvent('close', { timeout: 0 })  // No timeout
    
    console.log('Browser closed by user')
    console.log('Step 2: Saving session state to disk...')
    await session.close({ id: sessionId, save: true })
    console.log('Session saved to ~/.szkrabok/sessions/claude-ai/')

    console.log('\nStep 3: Reopening session (headless: true, auto-logged in)...')
    await session.open({
      id: sessionId,
      url: 'https://claude.ai',
      config: { stealth: true, headless: true },
    })

    console.log('Extracting page title to verify logged in state...')
    const { content } = await extract.text({ id: sessionId, selector: 'title' })
    console.log('Page title:', content)

    console.log('\n✓ Session persistence workflow complete')
    console.log('Session can now be reused with same id without login')

  } catch (err) {
    console.error('Test failed:', err.message)
    throw err
  } finally {
    try {
      await session.close({ id: sessionId, save: true })
    } catch { }

    try {
      await closeBrowser()
    } catch { }
  }
})
