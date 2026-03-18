/**
 * Integration tests: config discovery via MCP roots and env vars.
 *
 * Verifies that the server picks up szkrabok.config.toml from project roots
 * sent during the MCP handshake, and from SZKRABOK_CONFIG env var.
 */

import { test, expect } from 'playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { initConfig, findChromiumPath } from '../../../packages/runtime/config.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVER_PATH = join(REPO_ROOT, 'src/index.js');

// Resolve the working browser path on this machine so isolated subprocesses can launch.
initConfig([]);
const EXECUTABLE_PATH = await findChromiumPath();
if (!EXECUTABLE_PATH) throw new Error('config-mcp-roots.spec.js: no browser found — run szkrabok install-browser');

const tmpDirs = [];

function makeTmp() {
  const d = mkdtempSync(join(tmpdir(), 'szkrabok-cfg-'));
  tmpDirs.push(d);
  return d;
}

function writeToml(dir, content) {
  mkdirSync(dir, { recursive: true });
  // Always include executablePath so isolated subprocesses can launch the browser.
  writeFileSync(join(dir, 'szkrabok.config.toml'), content + `\nexecutablePath = ${JSON.stringify(EXECUTABLE_PATH)}\n`);
}

test.afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch (e) { console.warn('[cleanup] rmSync failed:', e.message); }
  }
});

/**
 * Spawn the szkrabok MCP server with roots capability.
 * rootPaths: absolute paths to advertise as roots/list.
 * Returns connected client. Caller must call client.close().
 */
async function spawnWithRoots(rootPaths, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: {
      ...process.env,
      // Prevent cwd walk-up from finding repo config — isolate to rootPaths only.
      SZKRABOK_CONFIG: undefined,
      SZKRABOK_ROOT: undefined,
      ...extraEnv,
    },
  });

  const client = new Client(
    { name: 'config-roots-test', version: '1.0.0' },
    { capabilities: { roots: { listChanged: false } } }
  );

  // Handle roots/list requests from the server.
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: rootPaths.map(p => ({ uri: `file://${p}`, name: p })),
  }));

  await client.connect(transport);

  // Allow server's oninitialized → listRoots → initConfig to complete.
  await new Promise(r => setTimeout(r, 300));

  return client;
}

/** Open a session and return navigator.userAgent via browser_run. */
async function readUA(client, sessionName) {
  const openRes = await client.callTool({
    name: 'session_manage',
    arguments: {
      action: 'open',
      sessionName,
      launchOptions: { headless: true, stealth: false },
    },
  });
  expect(openRes.isError).toBeFalsy();

  const runRes = await client.callTool({
    name: 'browser_run',
    arguments: {
      sessionName,
      code: 'async (page) => page.evaluate(() => navigator.userAgent)',
    },
  });

  if (runRes.isError) {
    throw new Error(`browser_run failed: ${runRes.content[0]?.text}`);
  }

  const parsed = JSON.parse(runRes.content[0].text);
  if (parsed.error) throw new Error(`browser_run error: ${parsed.error}`);
  return parsed.result;
}

test('roots sent at init — UA in project toml is used', async () => {
  const root = makeTmp();
  const ua = `TestBot-roots/${randomUUID()}`;
  writeToml(root, `[default]\nuserAgent = "${ua}"\n`);

  const client = await spawnWithRoots([root]);
  const sessionName = `cfg-roots-${randomUUID()}`;

  try {
    const actual = await readUA(client, sessionName);
    expect(actual).toBe(ua);
  } finally {
    await client.callTool({ name: 'session_manage', arguments: { action: 'close', sessionName, save: false } }).catch(() => {});
    await client.close().catch(() => {});
  }
});

test('no roots, SZKRABOK_CONFIG set — env var config loaded', async () => {
  const dir = makeTmp();
  const ua = `EnvBot/${randomUUID()}`;
  const cfgPath = join(dir, 'custom.toml');
  writeFileSync(cfgPath, `[default]\nuserAgent = "${ua}"\nexecutablePath = ${JSON.stringify(EXECUTABLE_PATH)}\n`);

  const client = await spawnWithRoots([], { SZKRABOK_CONFIG: cfgPath });
  const sessionName = `cfg-env-${randomUUID()}`;

  try {
    const actual = await readUA(client, sessionName);
    expect(actual).toBe(ua);
  } finally {
    await client.callTool({ name: 'session_manage', arguments: { action: 'close', sessionName, save: false } }).catch(() => {});
    await client.close().catch(() => {});
  }
});
