/**
 * Szkrabok Stealth Mode Tests
 * Tests browser fingerprinting evasion
 */

import { test, expect } from './fixtures.js';
import { randomUUID } from 'crypto';

test.describe('Stealth Mode', () => {
  test('session opens with stealth enabled', async ({ client, openSession }) => {
    const sessionId = `stealth-${randomUUID()}`;

    const response = await openSession(client, sessionId, {
      url: 'https://bot.sannysoft.com/',
      launchOptions: { stealth: true },
    });

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe('text');
    expect(content.text).toContain('success');

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Extract page title to verify page loaded
    const extractResponse = await client.callTool({
      name: 'browser.run_code',
      arguments: {
        sessionName: sessionId,
        code: 'async (page) => page.title()',
      },
    });

    expect(extractResponse.content).toHaveLength(1);
    const extractContent = extractResponse.content[0];
    expect(extractContent.type).toBe('text');

    const responseData = JSON.parse(extractContent.text);
    expect(responseData.result).toBeDefined();
    expect(responseData.result.length).toBeGreaterThan(0);

    // Cleanup
    await client.callTool({
      name: 'session.close',
      arguments: { sessionName: sessionId, save: false },
    });
  });
});
