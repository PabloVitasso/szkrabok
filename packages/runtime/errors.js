// @szkrabok/runtime — structured errors

/**
 * Thrown when browser resolution fails. Carries the full candidate chain
 * and computes its own human-readable message — callers do not format manually.
 */
export class BrowserNotFoundError extends Error {
  /**
   * @param {string} [message] - Optional custom message. If omitted, a default is generated from candidates.
   * @param {{ candidates: Array<{source: string, path: string|null, ok: boolean, reason: string|null}> }} data
   */
  constructor (message, { candidates = [] } = {}) {
    super(message ?? BrowserNotFoundError.formatMessage(candidates));
    this.name = 'BrowserNotFoundError';
    this.code = 'BROWSER_NOT_FOUND';
    this.candidates = candidates;
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
      candidates: this.candidates,
    };
  }

  /** Format a candidate list into the standard human-readable message string. */
  static formatMessage (candidates) {
    const lines = candidates.map(c => {
      const pathDisplay = c.path ?? '(not set)';
      return `  ${c.source.padEnd(12)} ${pathDisplay} — ${c.reason}`;
    }).join('\n');

    return (
      'Chromium not found.\n\n' +
      'Options (choose one):\n' +
      '  1. szkrabok install-browser\n' +
      '  2. export CHROMIUM_PATH=/usr/bin/google-chrome\n' +
      '  3. Set executablePath in szkrabok.config.toml\n\n' +
      'Candidates checked:\n' +
      lines
    );
  }
}
