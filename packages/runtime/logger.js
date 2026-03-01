import { LOG_LEVEL } from './config.js';
import { createWriteStream } from 'fs';

const levels = { error: 0, warn: 1, info: 2, debug: 3 };

const shouldLog = level => levels[level] <= levels[LOG_LEVEL];

if (shouldLog('error')) {
  const _ts = new Date();
  const _pad = n => String(n).padStart(2, '0');
  const _logFile = `/tmp/${_ts.getFullYear()}${_pad(_ts.getMonth() + 1)}${_pad(_ts.getDate())}${_pad(_ts.getHours())}${_pad(_ts.getMinutes())}szkrabok-runtime.log`;
  const _fileStream = createWriteStream(_logFile, { flags: 'a' });
  const _origConsoleError = console.error.bind(console);
  console.error = (...args) => {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    _origConsoleError(...args);
    _fileStream.write(line + '\n');
  };
}

const format = (level, msg, meta) => {
  const timestamp = new Date().toISOString();
  const base = { timestamp, level, msg };
  return JSON.stringify(meta ? { ...base, ...meta } : base);
};

export const log = (msg, meta) => {
  if (shouldLog('info')) console.error(format('info', msg, meta));
};

export const logError = (msg, err, meta) => {
  if (shouldLog('error'))
    console.error(format('error', msg, { error: err?.message || String(err), stack: err?.stack, ...meta }));
};

export const logDebug = (msg, meta) => {
  if (shouldLog('debug')) console.error(format('debug', msg, meta));
};

export const logWarn = (msg, meta) => {
  if (shouldLog('warn')) console.error(format('warn', msg, meta));
};
