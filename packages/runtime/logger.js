import { getConfig } from './config.js';
import { createWriteStream } from 'fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const levels = { error: 0, warn: 1, info: 2, debug: 3 };

const getLogLevel = () => {
  try { return getConfig().logLevel; } catch { return 'info'; }
};

const shouldLog = level => levels[level] <= levels[getLogLevel()];

// Lazy file stream — set up on first error log.
let _fileStream = null;
const getFileStream = () => {
  if (!_fileStream) {
    const ts = new Date();
    const pad = n => String(n).padStart(2, '0');
    const logFile = join(tmpdir(), `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}${pad(ts.getHours())}${pad(ts.getMinutes())}szkrabok-runtime.log`);
    _fileStream = createWriteStream(logFile, { flags: 'a' });
    const _origConsoleError = console.error.bind(console);
    console.error = (...args) => {
      const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      _origConsoleError(...args);
      _fileStream.write(line + '\n');
    };
  }
  return _fileStream;
};

const format = (level, msg, meta) => {
  const timestamp = new Date().toISOString();
  const base = { timestamp, level, msg };
  return JSON.stringify(meta ? { ...base, ...meta } : base);
};

export const log = (msg, meta) => {
  if (shouldLog('info')) { getFileStream(); console.error(format('info', msg, meta)); }
};

export const logError = (msg, err, meta) => {
  if (shouldLog('error'))
    console.error(format('error', msg, { error: err?.message || String(err), stack: err?.stack, ...meta }));
};

export const logDebug = (msg, meta) => {
  if (shouldLog('debug')) { getFileStream(); console.error(format('debug', msg, meta)); }
};

export const logWarn = (msg, meta) => {
  if (shouldLog('warn')) { getFileStream(); console.error(format('warn', msg, meta)); }
};
