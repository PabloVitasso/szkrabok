#!/usr/bin/env node
import 'dotenv/config';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { szkrabokCacheDir } from './utils/platform.js';

const args = process.argv.slice(2);
const firstArg = args[0];

// --- CLI mode ---
// Route to CLI if the first arg is a subcommand name (not a '--' flag) or a help/version flag.
// Unknown subcommand names are handled by Commander with a proper error message.
// Server-mode flags (--no-headless, --headful, etc.) stay in server mode.
if (firstArg && (!firstArg.startsWith('--') || firstArg === '--help' || firstArg === '-h' || firstArg === '--version' || firstArg === '-V')) {
  const { runCli } = await import('./cli/index.js');
  const exitCode = await runCli();
  process.exit(exitCode ?? 0);
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
  // eslint-disable-next-line no-empty -- startup log; no logging facility available yet if this fails
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
  let errMsg;
  if (err !== null && err !== undefined && err.message !== null && err.message !== undefined) {
    errMsg = err.message;
  } else {
    errMsg = '';
  }
  let errStack;
  if (err !== null && err !== undefined && err.stack !== null && err.stack !== undefined) {
    errStack = err.stack;
  } else {
    errStack = '';
  }
  const msg = `uncaughtException: ${errMsg}\n${errStack}`;
  _writeStartupLog(msg);
  logError('Uncaught exception', err);
  process.exit(1);
});

server.connect().catch(err => {
  let errMsg;
  if (err !== null && err !== undefined && err.message !== null && err.message !== undefined) {
    errMsg = err.message;
  } else {
    errMsg = '';
  }
  let errStack;
  if (err !== null && err !== undefined && err.stack !== null && err.stack !== undefined) {
    errStack = err.stack;
  } else {
    errStack = '';
  }
  const msg = `Failed to start server: ${errMsg}\n${errStack}`;
  _writeStartupLog(msg);
  logError('Failed to start server', err);
  process.exit(1);
});
