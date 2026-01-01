import { test } from 'node:test'
import assert from 'node:assert'
import * as session from '../tools/session.js'
import * as pool from '../core/pool.js'

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
    console.log('Press Enter in this terminal when done logging in...')
    
    // Wait for user input
    await new Promise(resolve => {
      process.stdin.once('data', resolve)
    })
    
    console.log('Step 2: Saving session state to disk...')
    await session.close({ id: sessionId, save: true })
    console.log('Session saved to ./sessions/claude-ai/')

    console.log('\nStep 3: Reopening session (headless: true, auto-logged in)...')
    await session.open({
      id: sessionId,
      url: 'https://claude.ai',
      config: { stealth: true, headless: true },
    })

    console.log('Extracting page title to verify logged in state...')
    const sessionData = pool.get(sessionId)
    const title = await sessionData.page.title()
    console.log('Page title:', title)

    console.log('\n✓ Session persistence workflow complete')
    console.log('Session can now be reused with same id without login')

  } catch (err) {
    console.error('Test failed:', err.message)
    throw err
  } finally {
    try {
      await session.close({ id: sessionId, save: true })
    } catch { }

    await pool.closeAllSessions()
  }
})
