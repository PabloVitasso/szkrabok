/**
 * Interoperability tests: szkrabok + @playwright/mcp via CDP sharing
 *
 * PREREQUISITE: @playwright/mcp must be installed as a Claude Code MCP server.
 * If not yet done, run:
 *   claude mcp add playwright npx '@playwright/mcp@latest'
 *
 * Verifies that:
 * - szkrabok opens a session and exposes a CDP endpoint
 * - @playwright/mcp can attach to that endpoint via --cdp-endpoint
 * - playwright-mcp browser_navigate + browser_snapshot work on the shared browser
 * - Both clients see the same page URL after navigation
 */

import { test, expect } from './fixtures.js';
import { randomUUID } from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const PLAYWRIGHT_MCP_CLI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../node_modules/@playwright/mcp/cli.js'
);

async function spawnPlaywrightMcp(cdpEndpoint) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [PLAYWRIGHT_MCP_CLI, '--cdp-endpoint', cdpEndpoint],
    env: process.env,
  });

  const client = new Client({ name: 'interop-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

test.describe('CDP interoperability', () => {
  test('playwright-mcp attaches to szkrabok session via CDP', async ({ client, openSession }) => {
    const sessionId = `interop-${randomUUID()}`;
    let pwClient;

    try {
      // 1. Open a szkrabok session
      await openSession(client, sessionId, { url: 'about:blank' });

      // 2. Get CDP endpoint from szkrabok
      const endpointResponse = await client.callTool({
        name: 'session.endpoint',
        arguments: { sessionName: sessionId },
      });
      const { wsEndpoint } = JSON.parse(endpointResponse.content[0].text);
      expect(wsEndpoint).toMatch(/^ws:\/\//);

      // 3. Spawn playwright-mcp attached to the same browser via CDP
      pwClient = await spawnPlaywrightMcp(wsEndpoint);

      // 4. Use playwright-mcp to navigate
      const navResponse = await pwClient.callTool({
        name: 'browser_navigate',
        arguments: { url: 'https://example.com' },
      });
      expect(navResponse.isError).toBeFalsy();

      // 5. Use playwright-mcp snapshot to verify page loaded
      const snapResponse = await pwClient.callTool({ name: 'browser_snapshot', arguments: {} });
      const snapText = snapResponse.content[0].text;
      expect(snapText).toContain('example');

      // 6. Verify szkrabok also sees the updated URL via browser.run_code
      const urlResponse = await client.callTool({
        name: 'browser.run_code',
        arguments: {
          sessionName: sessionId,
          code: 'async (page) => page.url()',
        },
      });
      const { result } = JSON.parse(urlResponse.content[0].text);
      expect(result).toContain('example.com');
    } finally {
      if (pwClient) await pwClient.close().catch(() => {});
      await client.callTool({ name: 'session.close', arguments: { sessionName: sessionId, save: false } });
    }
  });

  test('szkrabok session.endpoint returns ws URL with active CDP port', async ({ client, openSession }) => {
    const sessionId = `endpoint-${randomUUID()}`;

    await openSession(client, sessionId);

    const response = await client.callTool({
      name: 'session.endpoint',
      arguments: { sessionName: sessionId },
    });

    expect(response.isError).toBeFalsy();
    const data = JSON.parse(response.content[0].text);
    expect(data.wsEndpoint).toMatch(/^ws:\/\/(127\.0\.0\.1|localhost):\d+/);

    await client.callTool({ name: 'session.close', arguments: { sessionName: sessionId, save: false } });
  });
});
