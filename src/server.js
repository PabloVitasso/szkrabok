import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools, handleToolCall } from './tools/registry.js';
import { closeAllSessions, initConfigProvisional, finalizeConfig } from '#runtime';
import { log } from './utils/logger.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

export const createServer = ({ explicitConfigPath = null } = {}) => {
  // Provisional init immediately — roots will finalize after MCP handshake.
  initConfigProvisional({ explicitConfigPath });

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
    finalizeConfig(rootPaths, { explicitConfigPath });
    if (rootPaths.length > 0) {
      log('Config finalized with MCP roots', { roots: rootPaths });
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
