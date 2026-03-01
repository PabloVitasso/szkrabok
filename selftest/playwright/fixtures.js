/**
 * Szkrabok Test Fixtures
 * Provides MCP client setup for testing szkrabok features
 */

import { test as baseTest, expect as baseExpect } from 'playwright/test';
import { spawnClient } from '@szkrabok/mcp-client';

// Default config applied to every session.open call made through openSession().
// Tests must not rely on the server's TOML for these values — selftest must be
// self-contained and runnable in any environment (headless CI, no $DISPLAY, etc).
const SESSION_DEFAULTS = {
  headless: true,
};

export const test = baseTest.extend({
  startClient: async ({}, use) => {
    const clients = [];

    await use(async () => {
      const client = await spawnClient();
      clients.push(client);
      return { client };
    });

    // Cleanup
    for (const client of clients) {
      try {
        await client.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  },

  client: async ({ startClient }, use) => {
    const { client } = await startClient();
    await use(client);
  },

  // openSession(client, id, extraArgs) — wraps session.open with SESSION_DEFAULTS.
  // Use this in all selftests instead of calling session.open directly, so tests
  // are independent of the server's TOML config.
  openSession: async ({}, use) => {
    await use(async (client, sessionName, extraArgs = {}) => {
      return client.callTool({
        name: 'session.open',
        arguments: {
          sessionName,
          ...extraArgs,
          launchOptions: { ...SESSION_DEFAULTS, ...(extraArgs.launchOptions ?? {}) },
        },
      });
    });
  },
});

export { baseExpect as expect };

export function toHaveResponse(received, expected) {
  const pass = JSON.stringify(received).includes(JSON.stringify(expected));
  return {
    pass,
    message: () =>
      `Expected response to match ${JSON.stringify(expected)}, got ${JSON.stringify(received)}`,
  };
}
