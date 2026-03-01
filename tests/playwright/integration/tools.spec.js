/**
 * Szkrabok Workflow Tools Tests
 */

import { test, expect } from './fixtures.js';
import { randomUUID } from 'crypto';

test.describe('Workflow Tools', () => {
  test('workflow.scrape extracts structured data', async ({ client, openSession }) => {
    const sessionId = `scrape-${randomUUID()}`;

    await openSession(client, sessionId, { url: 'https://example.com' });

    const response = await client.callTool({
      name: 'workflow.scrape',
      arguments: {
        sessionName: sessionId,
        selectors: {
          title: 'h1',
          paragraph: 'p',
        },
      },
    });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('Example Domain');

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: { sessionName: sessionId },
    });
  });
});
