import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');

// The library spawns a private stdio server for a trusted host-side caller
// (standalone Playwright runs, codegen, selftests), so it keeps the legacy
// capabilities. A sandbox-facing server is started by the operator with its
// own flags, never through this helper.
// --allow-private-net: standalone runs commonly target local dev servers.
const DEFAULT_ARGS = ['--allow-node-code', '--allow-private-net'];

/**
 * Spawns the MCP server and returns a connected client.
 * The caller owns the lifecycle - call client.close() when done.
 *
 * Server mode no longer discovers config from cwd (hardening D8). To keep the
 * caller's project config, SZKRABOK_ROOT defaults to the caller's cwd.
 *
 * @param {object} [options]
 * @param {string[]} [options.args] - szkrabok server flags. Default: ['--allow-node-code', '--allow-private-net']
 * @param {object} [options.env] - extra env for the server process
 * @returns {Promise<Client>} Connected MCP client
 */
export async function spawnClient({ args = DEFAULT_ARGS, env = {} } = {}) {
  const serverPath = resolve(REPO_ROOT, 'src/index.js');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath, ...args],
    env: {
      ...process.env,
      ...(process.env.SZKRABOK_CONFIG || process.env.SZKRABOK_ROOT
        ? {}
        : { SZKRABOK_ROOT: process.cwd() }),
      ...env,
    },
  });

  const client = new Client(
    {
      name: 'szkrabok-test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  return client;
}
