import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerTools, handleToolCall } from './tools/registry.js';
import { closeAllSessions } from '@szkrabok/runtime';
import { log } from './utils/logger.js';

export const createServer = () => {
  const server = new Server(
    {
      name: 'szkrabok-playwright-mcp',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registerTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request =>
    handleToolCall(request.params.name, request.params.arguments)
  );

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
