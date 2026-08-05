/**
 * Integration tests: Firefox engine guards at the MCP layer.
 *
 * Verifies that when the server is configured for Firefox:
 *   - session_manage open launches a Firefox session (browserEngine reported)
 *   - session_manage endpoint returns ENGINE_NOT_SUPPORTED
 *   - browser_run_test returns ENGINE_NOT_SUPPORTED
 *
 * Skipped when the invisible_playwright Firefox binary is absent.
 */

import { test, expect } from 'playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir, homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVER_PATH = join(REPO_ROOT, 'src/index.js');

const INV_FIREFOX = join(homedir(), '.cache/invisible-playwright/firefox-7/firefox');
const FIREFOX_AVAILABLE = existsSync(INV_FIREFOX);

const tmpDirs = [];

function makeTmp() {
  const d = mkdtempSync(join(tmpdir(), 'szkrabok-ff-'));
  tmpDirs.push(d);
  return d;
}

test.afterAll(() => {
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch (e) {
      console.warn('[cleanup] rmSync failed:', e.message);
    }
  }
});

async function spawnWithFirefox() {
  const dir = makeTmp();
  writeFileSync(
    join(dir, 'szkrabok.config.toml'),
    ['[browser]', 'engine = "firefox"', `executable_path = "${INV_FIREFOX}"`].join('\n') + '\n'
  );

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: {
      ...process.env,
      SZKRABOK_CONFIG: join(dir, 'szkrabok.config.toml'),
    },
  });

  const client = new Client(
    { name: 'firefox-engine-test', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  // Allow server's oninitialized -> finalizeConfig to complete before tool calls.
  await new Promise(r => setTimeout(r, 300));
  return client;
}

test.describe('Firefox engine — MCP guards', () => {
  test.describe.configure({ mode: 'serial' }); // each test launches a real Firefox process
  test.skip(!FIREFOX_AVAILABLE, 'invisible_playwright Firefox binary not found');

  test('session_manage open reports browserEngine: firefox', async () => {
    const client = await spawnWithFirefox();
    const sessionName = `ff-open-${randomUUID()}`;

    try {
      const res = await client.callTool({
        name: 'session_manage',
        arguments: { action: 'open', sessionName, launchOptions: { headless: true } },
      });
      expect(res.isError).toBeFalsy();
      const body = JSON.parse(res.content[0].text);
      expect(body.browserEngine).toBe('firefox');
    } finally {
      await client
        .callTool({ name: 'session_manage', arguments: { action: 'close', sessionName } })
        .catch(() => {});
      await client.close().catch(() => {});
    }
  });

  test('session_manage list shows browserEngine: firefox for active session', async () => {
    const client = await spawnWithFirefox();
    const sessionName = `ff-list-${randomUUID()}`;

    try {
      await client.callTool({
        name: 'session_manage',
        arguments: { action: 'open', sessionName, launchOptions: { headless: true } },
      });

      const listRes = await client.callTool({
        name: 'session_manage',
        arguments: { action: 'list' },
      });
      const { sessions } = JSON.parse(listRes.content[0].text);
      const entry = sessions.find(s => s.id === sessionName);
      expect(entry, 'session should appear in list').toBeDefined();
      expect(entry.browserEngine).toBe('firefox');
    } finally {
      await client
        .callTool({ name: 'session_manage', arguments: { action: 'close', sessionName } })
        .catch(() => {});
      await client.close().catch(() => {});
    }
  });

  test('session_manage endpoint returns ENGINE_NOT_SUPPORTED for Firefox', async () => {
    const client = await spawnWithFirefox();
    const sessionName = `ff-endpoint-${randomUUID()}`;

    try {
      await client.callTool({
        name: 'session_manage',
        arguments: { action: 'open', sessionName, launchOptions: { headless: true } },
      });

      const res = await client.callTool({
        name: 'session_manage',
        arguments: { action: 'endpoint', sessionName },
      });
      expect(res.isError).toBe(true);
      const body = JSON.parse(res.content[0].text);
      expect(body.code).toBe('ENGINE_NOT_SUPPORTED');
    } finally {
      await client
        .callTool({ name: 'session_manage', arguments: { action: 'close', sessionName } })
        .catch(() => {});
      await client.close().catch(() => {});
    }
  });

  test('browser_run_test returns ENGINE_NOT_SUPPORTED for Firefox session', async () => {
    const client = await spawnWithFirefox();
    const sessionName = `ff-runtest-${randomUUID()}`;

    try {
      await client.callTool({
        name: 'session_manage',
        arguments: { action: 'open', sessionName, launchOptions: { headless: true } },
      });

      const res = await client.callTool({
        name: 'browser_run_test',
        arguments: { sessionName, files: ['tests/playwright/e2e/noop.spec.js'], project: 'e2e' },
      });
      expect(res.isError).toBe(true);
      const body = JSON.parse(res.content[0].text);
      expect(body.code).toBe('ENGINE_NOT_SUPPORTED');
    } finally {
      await client
        .callTool({ name: 'session_manage', arguments: { action: 'close', sessionName } })
        .catch(() => {});
      await client.close().catch(() => {});
    }
  });
});
