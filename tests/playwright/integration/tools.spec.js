/**
 * Szkrabok Workflow Tools Tests
 */

import { test, expect } from './fixtures.js';
import { randomUUID } from 'crypto';

test.describe('Workflow Tools', () => {
  test('browser_scrape extracts structured data', async ({ client, openSession }) => {
    const sessionId = `scrape-${randomUUID()}`;

    await openSession(client, sessionId, { url: 'https://intoli.com' });

    const response = await client.callTool({
      name: 'browser_scrape',
      arguments: { sessionName: sessionId },
    });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('Intoli');

    // Cleanup
    await client.callTool({
      name: 'session_manage',
      arguments: { action: 'close', sessionName: sessionId },
    });
  });
});
