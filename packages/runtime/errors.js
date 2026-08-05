// @szkrabok/runtime — structured errors

import { join } from 'node:path';
import { statSync } from 'node:fs';

const isoSec = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
export const isoNow = () => isoSec(new Date());

export class SessionNotFoundError extends Error {
  constructor (id, customMessage = null) {
    super(customMessage || `session not found: ${id}`);
    this.name = 'SessionNotFoundError';
    this.code = 'SESSION_NOT_FOUND';
    this.sessionId = id;
    this.hint = 'reopen the session with session_manage open';
  }
}

export class ConfigNotInitializedError extends Error {
  constructor () {
    super('config not initialized');
    this.name = 'ConfigNotInitializedError';
    this.code = 'CONFIG_NOT_INITIALIZED';
    this.hint = 'restart MCP server';
  }
}

export class ConfigNotFinalError extends Error {
  constructor () {
    super('config not finalized');
    this.name = 'ConfigNotFinalError';
    this.code = 'CONFIG_NOT_FINAL';
    this.hint = 'retry the call';
  }
}

const SOURCE_KEY = {
  env: 'CHROMIUM_PATH',
  config: 'executablePath',
  system: 'system',
  playwright: 'playwrightBundled',
};

const USER_SOURCES = new Set(['env', 'config']);

const HINT_DOCTOR_INSTALL = 'run szkrabok doctor install to install a bundled browser';

const HINT = {
  CHROMIUM_PATH: 'unset or correct CHROMIUM_PATH env var in your MCP client config; restart MCP server',
  executablePath: 'run szkrabok doctor detect --write-config to correct the configured path; restart MCP server',
  system: HINT_DOCTOR_INSTALL,
  playwrightBundled: HINT_DOCTOR_INSTALL,
};

const fileMtimeIso = (path) => {
  try {
    return isoSec(statSync(path).mtime);
  } catch {
    return null;
  }
};

const resolveConfigFilePath = (source) => {
  if (!source || source.startsWith('none')) return null;
  const m = source.match(/\(([^)]+)\)$/);
  if (!m) return null;
  const p = m[1];
  if (source.startsWith('explicit') || source.startsWith('env:SZKRABOK_CONFIG')) {
    return p;
  }
  if (source.startsWith('xdg')) {
    return join(p, 'config.local.toml');
  }
  return join(p, 'szkrabok.config.local.toml');
};

export class EngineNotSupportedError extends Error {
  constructor (operation, engine, reason) {
    super(`${operation} requires Chromium (current engine: ${engine}). ${reason}`);
    this.name = 'EngineNotSupportedError';
    this.code = 'ENGINE_NOT_SUPPORTED';
    this.operation = operation;
    this.engine = engine;
  }
}

const BROWSER_NOT_FOUND_MESSAGE = 'browser executable not found';

export class BrowserNotFoundError extends Error {
  constructor ({ candidates = [], configSource = null, configMeta = null } = {}) {
    super(BROWSER_NOT_FOUND_MESSAGE);
    this.name = 'BrowserNotFoundError';
    this.code = 'BROWSER_NOT_FOUND';
    this.candidates = candidates;
    this.configSource = configSource;
    this.configMeta = configMeta;
  }

  toJSON () {
    const attempted = {
      CHROMIUM_PATH: 'not set',
      executablePath: 'not set',
      system: 'not found',
      playwrightBundled: 'not found',
    };
    let failureSource = null;

    for (const c of this.candidates) {
      const key = SOURCE_KEY[c.source] ?? c.source;
      let value;
      if (c.ok) {
        value = 'resolved';
      } else if (!c.path) {
        value = USER_SOURCES.has(c.source) ? 'not set' : 'not found';
      } else {
        value = USER_SOURCES.has(c.source) ? 'set_invalid' : 'not found';
      }
      attempted[key] = value;
      if (!failureSource && USER_SOURCES.has(c.source) && value === 'set_invalid') {
        failureSource = key;
      }
    }

    if (!failureSource) {
      failureSource = 'executablePath';
    }

    const meta = this.configMeta;
    const loadedAt = meta?.loadedAt ?? null;
    const configFilePath = resolveConfigFilePath(meta?.source ?? this.configSource);
    const fileModifiedAt = configFilePath ? fileMtimeIso(configFilePath) : null;

    const restartNeeded = !!(
      loadedAt && fileModifiedAt && fileModifiedAt > loadedAt &&
      (attempted.CHROMIUM_PATH !== 'resolved' || attempted.executablePath !== 'resolved')
    );

    return {
      code: this.code,
      message: BROWSER_NOT_FOUND_MESSAGE,
      hint: HINT[failureSource] ?? HINT.playwrightBundled,
      ...(restartNeeded && { restartNeeded: true }),
      context: {
        config: {
          source: meta?.source ?? this.configSource ?? 'none',
          ...(loadedAt && { loadedAt }),
          ...(fileModifiedAt && { fileModifiedAt }),
        },
        failureSource,
        attempted,
      },
    };
  }
}
