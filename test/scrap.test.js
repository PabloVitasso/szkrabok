import { test } from 'node:test'
import assert from 'node:assert'
import { writeFile } from 'fs/promises'
import * as session from '../tools/session.js'
import * as extract from '../tools/extract.js'
import * as pool from '../core/pool.js'
import { closeBrowser } from '../upstream/wrapper.js'

const formatTimestamp = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}`
}

test('scrape bot detection page', async () => {
  const sessionId = `test-${Date.now()}`
  const timestamp = formatTimestamp()
  const filename = `${timestamp}-index.html`

  try {
    // Open temporary session
    const openResult = await session.open({
      id: sessionId,
      url: 'https://bot.sannysoft.com/',
      config: { stealth: true },
    })
    assert.ok(openResult.success, 'Session should open successfully')

    // Get page reference for direct control
    const { page } = pool.get(sessionId)

    // Wait for network to be idle (all requests done)
    await page.waitForLoadState('networkidle', { timeout: 10000 })

    // Wait for JavaScript fingerprint tests to complete
    console.log('Waiting 5s for JS tests to complete...')
    await page.waitForTimeout(5000)

    // Wait for specific content that appears after JS execution
    await page.waitForSelector('body', { state: 'visible' })

    // Extract HTML after ALL JS has run
    const { content } = await extract.html({ id: sessionId })
    assert.ok(content, 'Should extract HTML content')
    assert.ok(content.length > 0, 'HTML should not be empty')

    // Save to file
    await writeFile(filename, content, 'utf-8')
    console.log(`Saved to ${filename}`)

    // Also save what user actually sees (outerHTML of entire page)
    const visualContent = await page.evaluate(() => document.documentElement.outerHTML)
    await writeFile(`${timestamp}-visual.html`, visualContent, 'utf-8')
    console.log(`Saved visual state to ${timestamp}-visual.html`)

    // Verify file contains expected content (lowercase check)
    const lowerContent = content.toLowerCase()
    assert.ok(
      lowerContent.includes('sannysoft') || lowerContent.includes('bot'),
      'Should contain bot detection content'
    )

    console.log('✓ Test passed')
  } catch (err) {
    console.error('Test failed:', err.message)
    throw err
  } finally {
    // Always cleanup - ensure browser closes even if test fails
    try {
      await session.close({ id: sessionId, save: false })
    } catch (err) {
      console.error('Error closing session:', err.message)
    }

    try {
      await session.deleteSession({ id: sessionId })
    } catch (err) {
      console.error('Error deleting session:', err.message)
    }

    try {
      await closeBrowser()
    } catch (err) {
      console.error('Error closing browser:', err.message)
    }
  }
}, { timeout: 30000 })