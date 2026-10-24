import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools, handleToolCall } from './tools/registry.js';
import {
  closeAllSessions,
  initConfigProvisional,
  finalizeConfig,
  getConfigSource,
  getConfigMeta,
} from '#runtime';
import { log } from './utils/logger.js';
import { getFlags } from './flags.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

export const createServer = ({ explicitConfigPath = null } = {}) => {
  // Provisional init immediately — finalized after the MCP handshake.
  // MCP roots and cwd are trusted config sources only with
  // --trust-project-config (hardening D8).
  const skipProjectConfig = !getFlags().trustProjectConfig;
  initConfigProvisional({ explicitConfigPath, skipProjectConfig });

  const server = new Server(
    {
      name: 'szkrabok',
      version,
    },
    {
      capabilities: {
        tools: {},
        roots: { listChanged: true },
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registerTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request =>
    handleToolCall(request.params.name, request.params.arguments)
  );

  // Finalize config with MCP roots. Always called, even when roots are empty
  // or the client does not support roots — ensures phase transitions to 'final'.
  server.oninitialized = async () => {
    let rootPaths = [];
    try {
      const { roots } = await server.listRoots();
      rootPaths = (roots ?? []).map(r => r.uri.replace(/^file:\/\//, ''));
    } catch {
      // Client does not support roots — finalize with provisional discovery results.
    }
    finalizeConfig(rootPaths, { explicitConfigPath, skipProjectConfig });
    log('Config source', { source: getConfigSource() });
    const ignored = getConfigMeta()?.ignored ?? [];
    if (ignored.length > 0) {
      log(
        '[WARN] project szkrabok.config.toml ignored — start the server with --trust-project-config to load it, or set SZKRABOK_ROOT',
        { ignored }
      );
    }
  };

  return {
    async connect() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      log('Server connected via stdio');
    },
    async close() {
      await closeAllSessions();
      log('Server closed');
    },
  };
};
