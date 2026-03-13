#!/usr/bin/env node
import 'dotenv/config';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { szkrabokCacheDir } from './utils/platform.js';

const CLI_COMMANDS = new Set(['session', 'open', 'endpoint', 'detect-browser', 'install-browser', 'init', 'doctor']);
const args = process.argv.slice(2);
const firstArg = args[0];

// --- CLI mode ---
if (firstArg && (CLI_COMMANDS.has(firstArg) || firstArg === '--setup' || firstArg === '--help' || firstArg === '-h' || firstArg === '--version' || firstArg === '-V')) {
  const { runCli } = await import('./cli/index.js');
  await runCli();
  process.exit(0);
}

// --- MCP server mode ---
if (args.includes('--no-headless') || args.includes('--headful')) {
  process.env.HEADLESS = 'false';
}

// Always write fatal startup errors to a fixed log so they survive MCP client restarts.
const _logDir = szkrabokCacheDir();
const _logFile = join(_logDir, 'startup.log');
const _writeStartupLog = msg => {
  try {
    mkdirSync(_logDir, { recursive: true });
    appendFileSync(_logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
};

const { createServer } = await import('./server.js');
const { log, logError } = await import('./utils/logger.js');

_writeStartupLog(`starting szkrabok pid=${process.pid} source=${process.argv[1]}`);

const server = createServer();

process.on('SIGINT', async () => {
  log('Shutting down gracefully...');
  await server.close();
  process.exit(0);
});

process.on('uncaughtException', err => {
  const msg = `uncaughtException: ${err?.message}\n${err?.stack}`;
  _writeStartupLog(msg);
  logError('Uncaught exception', err);
  process.exit(1);
});

server.connect().catch(err => {
  const msg = `Failed to start server: ${err?.message}\n${err?.stack}`;
  _writeStartupLog(msg);
  logError('Failed to start server', err);
  process.exit(1);
});
