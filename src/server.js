import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools, handleToolCall } from './tools/registry.js';
import { closeAllSessions, initConfig } from '#runtime';
import { log } from './utils/logger.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

export const createServer = () => {
  // Initialize config with cwd fallback immediately — roots will re-init after handshake.
  initConfig([]);

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

  // Re-initialize config when MCP client sends roots.
  server.oninitialized = async () => {
    try {
      const { roots } = await server.listRoots();
      const rootPaths = (roots ?? []).map(r => r.uri.replace(/^file:\/\//, ''));
      if (rootPaths.length > 0) {
        initConfig(rootPaths);
        log('Config re-initialized with MCP roots', { roots: rootPaths });
      }
    } catch {
      // Client does not support roots — cwd-based config remains active.
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
