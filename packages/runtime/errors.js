// @szkrabok/runtime — structured errors

import { homedir } from 'node:os';
import { join } from 'node:path';

export class ConfigNotInitializedError extends Error {
  constructor () {
    super('CONFIG_NOT_INITIALIZED');
    this.name = 'ConfigNotInitializedError';
    this.code = 'CONFIG_NOT_INITIALIZED';
  }
}

export class ConfigNotFinalError extends Error {
  constructor () {
    super('CONFIG_NOT_FINAL');
    this.name = 'ConfigNotFinalError';
    this.code = 'CONFIG_NOT_FINAL';
  }
}

const userConfigDir = () =>
  process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'szkrabok')
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'szkrabok');

/**
 * Thrown when browser resolution fails. Carries the full candidate chain
 * and computes its own human-readable message — callers do not format manually.
 */
export class BrowserNotFoundError extends Error {
  /**
   * @param {string} [message]
   * @param {{ candidates: Array<{source: string, path: string|null, ok: boolean, reason: string|null}>, configSource: string|null }} data
   */
  constructor (message, { candidates = [], configSource = null } = {}) {
    super(message ?? BrowserNotFoundError.formatMessage(candidates, configSource));
    this.name = 'BrowserNotFoundError';
    this.code = 'BROWSER_NOT_FOUND';
    this.candidates = candidates;
    this.configSource = configSource;
  }

  /**
   * Ensure JSON.stringify produces a useful object, not `{}`.
   * Error own-properties (message, stack) are non-enumerable so JSON.stringify
   * silently drops them. toJSON lets callers (registry wrapError, tests) get a
   * serialisable snapshot without special-casing Error objects everywhere.
   */
  toJSON () {
    return {
      code: this.code,
      message: this.message,
      configSource: this.configSource,
      candidates: this.candidates,
    };
  }

  /** Compact single-line summary for token-efficient MCP responses. */
  static formatMessage (candidates, configSource = null) {
    const cfg = configSource ?? 'none';
    const cands = candidates.map(c => `${c.source}=${c.path ?? 'unset'}(${c.reason})`).join(' ');
    const configLocalToml = join(userConfigDir(), 'config.local.toml');
    const fixes = [
      'szkrabok doctor install',
      `set env CHROMIUM_PATH=/path/to/chrome in your MCP client server config`,
      `set executablePath in ${configLocalToml}`,
      'pass --config /abs/path/to/config.toml as MCP server arg',
    ].map((f, i) => `(${i + 1}) ${f}`).join(' ');
    return `BROWSER_NOT_FOUND | config:${cfg} | ${cands} | fix: ${fixes}`;
  }
}
