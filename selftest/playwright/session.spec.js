/**
 * Szkrabok Session Management Tests
 * Tests session lifecycle, persistence, and cleanup
 */

import { test, expect } from './fixtures.js'
import { randomUUID } from 'crypto'

test.describe('Session Management', () => {
  test('session.open creates a new session', async ({ client }) => {
    const sessionId = `test-${randomUUID()}`

    const response = await client.callTool({
      name: 'session.open',
      arguments: {
        id: sessionId,
        url: 'https://example.com',
      },
    })

    expect(response.content).toHaveLength(1)
    const content = response.content[0]
    expect(content.type).toBe('text')
    expect(content.text).toContain('success')
    expect(content.text).toContain(sessionId)

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: { id: sessionId },
    })
  })

  test('session.list returns active sessions', async ({ client }) => {
    const sessionId = `test-${randomUUID()}`

    // Open a session
    await client.callTool({
      name: 'session.open',
      arguments: {
        id: sessionId,
        url: 'https://example.com',
      },
    })

    // List sessions
    const response = await client.callTool({
      name: 'session.list',
      arguments: {},
    })

    expect(response.content).toHaveLength(1)
    const content = response.content[0]
    expect(content.type).toBe('text')
    expect(content.text).toContain(sessionId)

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: { id: sessionId },
    })
  })

  test('session.close with save persists state', async ({ client }) => {
    const sessionId = `test-${randomUUID()}`

    // Open session
    await client.callTool({
      name: 'session.open',
      arguments: {
        id: sessionId,
        url: 'https://example.com',
      },
    })

    // Close with save
    const response = await client.callTool({
      name: 'session.close',
      arguments: {
        id: sessionId,
        save: true,
      },
    })

    expect(response.content).toHaveLength(1)
    const content = response.content[0]
    expect(content.type).toBe('text')
    expect(content.text).toContain('success')

    // Cleanup
    await client.callTool({
      name: 'session.delete',
      arguments: { id: sessionId },
    })
  })

  test('session.delete removes session', async ({ client }) => {
    const sessionId = `test-${randomUUID()}`

    // Open and close session
    await client.callTool({
      name: 'session.open',
      arguments: {
        id: sessionId,
        url: 'https://example.com',
      },
    })

    await client.callTool({
      name: 'session.close',
      arguments: {
        id: sessionId,
        save: true,
      },
    })

    // Delete session
    const response = await client.callTool({
      name: 'session.delete',
      arguments: { id: sessionId },
    })

    expect(response.content).toHaveLength(1)
    const content = response.content[0]
    expect(content.type).toBe('text')
    expect(content.text).toContain('success')
  })
})
