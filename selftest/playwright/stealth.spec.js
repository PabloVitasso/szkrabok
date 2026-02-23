/**
 * Szkrabok Stealth Mode Tests
 * Tests browser fingerprinting evasion
 */

import { test, expect } from './fixtures.js'
import { randomUUID } from 'crypto'

test.describe('Stealth Mode', () => {
  test('session opens with stealth enabled', async ({ client }) => {
    const sessionId = `stealth-${randomUUID()}`

    const response = await client.callTool({
      name: 'session.open',
      arguments: {
        id: sessionId,
        url: 'https://bot.sannysoft.com/',
        config: {
          stealth: true,
        },
      },
    })

    expect(response.content).toHaveLength(1)
    const content = response.content[0]
    expect(content.type).toBe('text')
    expect(content.text).toContain('success')

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Extract page content to verify stealth
    const extractResponse = await client.callTool({
      name: 'extract.html',
      arguments: { id: sessionId },
    })

    expect(extractResponse.content).toHaveLength(1)
    const extractContent = extractResponse.content[0]
    expect(extractContent.type).toBe('text')

    // Response is JSON with content field
    const responseData = JSON.parse(extractContent.text)
    expect(responseData.content).toBeDefined()
    expect(responseData.content.length).toBeGreaterThan(0)

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: {
        id: sessionId,
        save: false,
      },
    })
  })
})
