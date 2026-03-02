// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: 2026-03-02T00:48:41.563Z
// Tools: 11  Hash: c756bb8a2d11

import { createHash } from 'node:crypto';
import { spawnClient } from './runtime/transport.js';
import { createCallInvoker } from './runtime/invoker.js';
import { createLogger } from './runtime/logger.js';
import * as adapter from './adapters/szkrabok-session.js';

const REGISTRY_HASH = 'c756bb8a2d11';

/**
 * @typedef {Object} McpHandle
 *   session: {
    open({ url, launchOptions }): Promise<any>
    close({ save }): Promise<any>
    list({  }): Promise<any>
    delete({  }): Promise<any>
    endpoint({  }): Promise<any>
  }
 *   workflow: {
    login({ username, password }): Promise<any>
    fillForm({ fields }): Promise<any>
    scrape({ selectors }): Promise<any>
  }
 *   browser: {
    run_code({ code }): Promise<any>
    run_test({ grep, params, config, project, files, keepOpen }): Promise<any>
    run_file({ path, fn, args }): Promise<any>
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
    session: {
      /** @param {{ url?: string, launchOptions?: object }} [args] */
      open: async (args = {}) => invoke('session.open', args),
      /** @param {{ save?: boolean }} [args] */
      close: async (args = {}) => invoke('session.close', args),
      list: async () => invoke('session.list'),
      delete: async () => invoke('session.delete'),
      endpoint: async () => invoke('session.endpoint'),
    },
    workflow: {
      /** @param {{ username: string, password: string }} [args] */
      login: async (args = {}) => invoke('workflow.login', args),
      /** @param {{ fields: object }} [args] */
      fillForm: async (args = {}) => invoke('workflow.fillForm', args),
      /** @param {{ selectors: object }} [args] */
      scrape: async (args = {}) => invoke('workflow.scrape', args),
    },
    browser: {
      /** @param {{ code: string }} [args] */
      run_code: async (args = {}) => invoke('browser.run_code', args),
      /** @param {{ grep?: string, params?: object, config?: string, project?: string, files?: string[], keepOpen?: boolean }} [args] */
      run_test: async (args = {}) => invoke('browser.run_test', args),
      /** @param {{ path: string, fn?: string, args?: object }} [args] */
      run_file: async (args = {}) => invoke('browser.run_file', args),
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