/**
 * Szkrabok Session Management Tests
 * Tests session lifecycle, persistence, and cleanup
 */

import { test, expect } from './fixtures.js';
import { randomUUID } from 'crypto';

test.describe('Session Management', () => {
  test('session.open creates a new session', async ({ client, openSession }) => {
    const sessionId = `test-${randomUUID()}`;

    const response = await openSession(client, sessionId, { url: 'https://example.com' });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('success');
    expect(content.text).toContain(sessionId);

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: { sessionName: sessionId },
    });
  });

  test('session.list returns active sessions', async ({ client, openSession }) => {
    const sessionId = `test-${randomUUID()}`;

    await openSession(client, sessionId, { url: 'https://example.com' });

    const response = await client.callTool({
      name: 'session.list',
      arguments: {},
    });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain(sessionId);

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: { sessionName: sessionId },
    });
  });

  test('session.close with save persists state', async ({ client, openSession }) => {
    const sessionId = `test-${randomUUID()}`;

    await openSession(client, sessionId, { url: 'https://example.com' });

    const response = await client.callTool({
      name: 'session.close',
      arguments: { sessionName: sessionId, save: true },
    });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('success');

    // Cleanup
    await client.callTool({
      name: 'session.delete',
      arguments: { sessionName: sessionId },
    });
  });

  test('session.delete removes session', async ({ client, openSession }) => {
    const sessionId = `test-${randomUUID()}`;

    await openSession(client, sessionId, { url: 'https://example.com' });

    await client.callTool({
      name: 'session.close',
      arguments: { sessionName: sessionId, save: true },
    });

    const response = await client.callTool({
      name: 'session.delete',
      arguments: { sessionName: sessionId },
    });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('success');
  });
});
