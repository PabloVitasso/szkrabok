// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: 2026-03-20T14:09:05.879Z
// Tools: 5  Hash: b8859b7d8a08

import { createHash } from 'node:crypto';
import { spawnClient } from './runtime/transport.js';
import { createCallInvoker } from './runtime/invoker.js';
import { createLogger } from './runtime/logger.js';
import * as adapter from './adapters/szkrabok-session.js';

const REGISTRY_HASH = 'b8859b7d8a08';

/**
 * @typedef {Object} McpHandle
 *   _root: {
    session_manage({ action, url, launchOptions }): Promise<any>
    browser_scrape({ selectors }): Promise<any>
    scaffold_init({ dir, name, preset, install }): Promise<any>
    browser_run({ code, path, fn, args }): Promise<any>
    browser_run_test({ grep, params, config, project, files, keepOpen, reportFile }): Promise<any>
  }
 */

/**
 * Connect to MCP server and get a typed handle.
 * @param {string} sessionName - Session name for szkrabok
 * @param {object} [options] - Connection options
 * @param {object} [options.launchOptions] - Browser launch options forwarded to session.open
 * @param {boolean} [options.sidecarEnabled=false] - Enable sidecar file logging
 * @param {object} [options.adapter] - Custom adapter (defaults to szkrabok-session adapter)
 * @returns {Promise<McpHandle>}
 */
export async function mcpConnect(sessionName, options = {}) {
  const { launchOptions, sidecarEnabled, adapter: customAdapter = adapter } = options;
  const client = await spawnClient();

  // Validate registry hasn't drifted
  const liveTools = await client.listTools();
  const liveHash = registryHash(liveTools.tools);
  if (liveHash !== REGISTRY_HASH) {
    await client.close();
    throw new Error('MCP registry drift detected. Run npm run codegen:mcp');
  }

  const log = createLogger({ sidecarEnabled });
  const { invoke, close } = createCallInvoker({
    client,
    log,
    adapter: customAdapter,
    sessionName,
  });

  // Open session — forward launchOptions if provided
  await customAdapter.open(client, sessionName, launchOptions);

  return {
    close,
    _root: {
      /** @param {{ action: 'open'|'close'|'list'|'delete'|'endpoint', url?: string, launchOptions?: object }} [args] */
      session_manage: async (args = {}) => invoke('session_manage', args),
      /** @param {{ selectors?: string[] }} [args] */
      browser_scrape: async (args = {}) => invoke('browser_scrape', args),
      /** @param {{ dir?: string, name?: string, preset?: 'minimal'|'full', install?: boolean }} [args] */
      scaffold_init: async (args = {}) => invoke('scaffold_init', args),
      /** @param {{ code?: string, path?: string, fn?: string, args?: object }} [args] */
      browser_run: async (args = {}) => invoke('browser_run', args),
      /** @param {{ grep?: string, params?: object, config?: string, project?: string, files?: string[], keepOpen?: boolean, reportFile?: string }} [args] */
      browser_run_test: async (args = {}) => invoke('browser_run_test', args),
    },
  };
}

/**
 * Compute registry hash for drift detection.
 * @param {Array} tools
 * @returns {string}
 */
function registryHash(tools) {
  const canonical = tools
    .map(t => ({ name: t.name, inputSchema: t.inputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return createHash('sha1')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 12);
}