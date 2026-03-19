import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_SIDECAR_DIR = '.mcp-log';
const SIZE_THRESHOLD = 200; // chars

/**
 * Creates a logger that writes JSONL to console and optionally to a sidecar file.
 * @param {object} options
 * @param {string} [options.sidecarDir] - Directory for large result sidecar files
 * @param {boolean} [options.sidecarEnabled=false] - Enable sidecar writing
 * @returns {{ before: (call, seq) => void, afterSuccess: (call, result, ms, seq) => void, afterFailure: (call, err, ms, seq) => void }}
 */
export function createLogger({ sidecarDir = DEFAULT_SIDECAR_DIR, sidecarEnabled = false } = {}) {
  if (sidecarEnabled && !existsSync(sidecarDir)) {
    mkdirSync(sidecarDir, { recursive: true });
  }

  const getSidecarPath = (seqNum, name) => join(sidecarDir, `${seqNum}-${name.replace(/\./g, '_')}.txt`);

  const writeLog = (entry) => {
    const line = JSON.stringify(entry);
    console.log(line);
  };

  // Unwrap the MCP wire result ({ content: [{ type:'text', text:'...' }] })
  // into the parsed payload. Returns the raw result if unwrapping fails.
  const unwrap = raw => {
    try {
      let text = null;
      if (raw !== null && raw !== undefined) {
        const content = raw.content;
        if (content !== null && content !== undefined && Array.isArray(content)) {
          for (const c of content) {
            if (c !== null && c !== undefined && c.type === 'text') {
              if (c.text !== null && c.text !== undefined) {
                text = c.text;
                break;
              }
            }
          }
        }
      }
      if (text !== null && text !== undefined) { return JSON.parse(text); }
      return raw;
    } catch {
      return raw;
    }
  };

  // Registry of pretty-printers keyed by tool name.
  // Each entry: { success(call, result, ms), failure(call, err, ms) }
  // Either key is optional — omit to fall back to the default JSON log.
  const formatters = {
    'browser.run_test': {
      success(call, result, _ms) {
        const r = unwrap(result);
        let rLog;
        if (r !== null && r !== undefined && r.log !== null && r !== undefined) {
          rLog = r.log;
        } else {
          rLog = [];
        }
        for (const line of rLog) console.log(`  ${line}`);
      },
      failure(call, err, ms) {
        let callArgs;
        if (call !== null && call !== undefined && call.arguments !== null && call.arguments !== undefined) {
          callArgs = call.arguments;
        } else {
          callArgs = {};
        }
        const { files = [], grep, sessionName } = callArgs;
        let target;
        if (files.length) {
          target = files.join(', ');
        } else {
          if (grep !== null && grep !== undefined) {
            target = grep;
          } else {
            target = sessionName;
          }
        }
        console.log(`[browser.run_test] ${target} — ERROR (${ms}ms): ${err.message}`);
      },
    },
  };

  return {
    /**
     * Log intent before making a call.
     * @param {object} call - { name, arguments }
     * @param {number} seq - Sequence number
     */
    before(call, seq) {
      writeLog({
        name: call.name,
        arguments: call.arguments,
        _phase: 'before',
        _seq: seq,
      });
    },

    /**
     * Log successful result.
     * @param {object} call - { name, arguments }
     * @param {object} result - Tool result
     * @param {number} ms - Duration in milliseconds
     * @param {number} seq - Sequence number
     */
    afterSuccess(call, result, ms, seq) {
      const formatter = formatters[call.name];
      if (formatter !== null && formatter !== undefined && formatter.success !== null && formatter.success !== undefined) {
        formatters[call.name].success(call, result, ms);
        return;
      }
      const resultStr = JSON.stringify(result);
      let loggedResult;

      if (sidecarEnabled && resultStr.length > SIZE_THRESHOLD) {
        const path = getSidecarPath(seq, call.name);
        const stream = createWriteStream(path);
        stream.write(resultStr);
        stream.end();
        loggedResult = `[text ${resultStr.length} chars → ${path}]`;
      } else {
        // Try to parse result content if it's JSON
        try {
          const parsed = JSON.parse(resultStr);
          if (parsed.content && Array.isArray(parsed.content)) {
            const textContent = parsed.content.find(c => c.type === 'text');
            if (textContent) {
              loggedResult = JSON.parse(textContent.text);
            }
          }
        } catch {
          // Not JSON, use as-is
        }
        loggedResult = loggedResult || result;
      }

      writeLog({
        name: call.name,
        arguments: call.arguments,
        _phase: 'after',
        _result: loggedResult,
        _ok: true,
        _ms: ms,
        _seq: seq,
      });
    },

    /**
     * Log failed call.
     * @param {object} call - { name, arguments }
     * @param {Error} err - Error object
     * @param {number} ms - Duration in milliseconds
     * @param {number} seq - Sequence number
     */
    afterFailure(call, err, ms, seq) {
      const formatter2 = formatters[call.name];
      if (formatter2 !== null && formatter2 !== undefined && formatter2.failure !== null && formatter2.failure !== undefined) {
        formatters[call.name].failure(call, err, ms);
        return;
      }
      writeLog({
        name: call.name,
        arguments: call.arguments,
        _phase: 'after',
        _ok: false,
        _ms: ms,
        _error: err.message,
        _seq: seq,
      });
    },
  };
}
