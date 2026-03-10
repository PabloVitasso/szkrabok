#!/usr/bin/env node
import 'dotenv/config';

const CLI_COMMANDS = new Set(['session', 'open', 'endpoint', 'detect-browser', 'install-browser', 'init']);
const args = process.argv.slice(2);
const firstArg = args[0];

// --- CLI mode ---
if (firstArg && (CLI_COMMANDS.has(firstArg) || firstArg === '--setup' || firstArg === '--help' || firstArg === '-h' || firstArg === '--version' || firstArg === '-V')) {
  const { runCli } = await import('./cli.js');
  await runCli();
  process.exit(0);
}

// --- MCP server mode ---
if (args.includes('--no-headless') || args.includes('--headful')) {
  process.env.HEADLESS = 'false';
}

const { createServer } = await import('./server.js');
const { log, logError } = await import('./utils/logger.js');

const server = createServer();

process.on('SIGINT', async () => {
  log('Shutting down gracefully...');
  await server.close();
  process.exit(0);
});

process.on('uncaughtException', err => {
  logError('Uncaught exception', err);
  process.exit(1);
});

server.connect().catch(err => {
  logError('Failed to start server', err);
  process.exit(1);
});
