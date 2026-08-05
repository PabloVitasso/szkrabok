import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BrowserNotFoundError } from '../../../packages/runtime/errors.js';
import { SessionNotFoundError, wrapError } from '../../../src/utils/errors.js';
import { _resetConfigForTesting } from '../../../packages/runtime/config.js';

const allNothing = [
  { source: 'env', path: null, ok: false, reason: 'not set' },
  { source: 'config', path: null, ok: false, reason: 'not set' },
  { source: 'system', path: null, ok: false, reason: 'not found' },
  { source: 'playwright', path: null, ok: false, reason: 'not found' },
];

let tmpDirs = [];

const makeTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'szkrabok-diag-'));
  tmpDirs.push(d);
  return d;
};

beforeEach(() => {
  _resetConfigForTesting();
  tmpDirs = [];
});

afterEach(() => {
  _resetConfigForTesting();
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignored */
    }
  }
});

// ── BrowserNotFoundError output shape ─────────────────────────────────────────

describe('BrowserNotFoundError.toJSON() — output shape', () => {
  test('code is BROWSER_NOT_FOUND', () => {
    const json = new BrowserNotFoundError({ candidates: allNothing }).toJSON();
    assert.strictEqual(json.code, 'BROWSER_NOT_FOUND');
  });

  test('message is fixed lowercase string', () => {
    const json = new BrowserNotFoundError({ candidates: allNothing }).toJSON();
    assert.strictEqual(json.message, 'browser executable not found');
  });

  test('hint is a non-empty string', () => {
    const json = new BrowserNotFoundError({ candidates: allNothing }).toJSON();
    assert.ok(typeof json.hint === 'string' && json.hint.length > 0);
  });

  test('context.config.source present', () => {
    const json = new BrowserNotFoundError({
      candidates: allNothing,
      configSource: 'xdg (/home/user/.config/szkrabok)',
    }).toJSON();
    assert.strictEqual(json.context.config.source, 'xdg (/home/user/.config/szkrabok)');
  });

  test('context.config.source defaults to "none"', () => {
    const json = new BrowserNotFoundError({ candidates: allNothing }).toJSON();
    assert.strictEqual(json.context.config.source, 'none');
  });

  test('context.failureSource is present', () => {
    const json = new BrowserNotFoundError({ candidates: allNothing }).toJSON();
    assert.ok(typeof json.context.failureSource === 'string');
  });

  test('context.attempted has all four keys', () => {
    const json = new BrowserNotFoundError({ candidates: allNothing }).toJSON();
    const { attempted } = json.context;
    assert.ok('CHROMIUM_PATH' in attempted);
    assert.ok('executablePath' in attempted);
    assert.ok('system' in attempted);
    assert.ok('playwrightBundled' in attempted);
  });

  test('candidates[] not in toJSON output', () => {
    const json = new BrowserNotFoundError({ candidates: allNothing }).toJSON();
    assert.ok(!('candidates' in json));
  });

  test('candidates[] preserved on instance for CLI use', () => {
    const err = new BrowserNotFoundError({ candidates: allNothing });
    assert.ok(Array.isArray(err.candidates));
    assert.strictEqual(err.candidates.length, 4);
  });
});

// ── attempted values normalized ───────────────────────────────────────────────

describe('attempted values — normalized set', () => {
  const VALID_VALUES = new Set(['not set', 'set_invalid', 'resolved', 'not found']);

  test('all values are from normalized set', () => {
    const candidates = [
      { source: 'env', path: '/bad', ok: false, reason: 'file not found' },
      { source: 'config', path: null, ok: false, reason: 'not set' },
      { source: 'system', path: null, ok: false, reason: 'not found' },
      { source: 'playwright', path: null, ok: false, reason: 'not found' },
    ];
    const { attempted } = new BrowserNotFoundError({ candidates }).toJSON().context;
    for (const [key, val] of Object.entries(attempted)) {
      assert.ok(VALID_VALUES.has(val), `${key} has invalid value: ${val}`);
    }
  });

  test('"not found" never on CHROMIUM_PATH', () => {
    const candidates = [
      { source: 'env', path: '/bad', ok: false, reason: 'file not found' },
      { source: 'config', path: null, ok: false, reason: 'not set' },
      { source: 'system', path: null, ok: false, reason: 'not found' },
      { source: 'playwright', path: null, ok: false, reason: 'not found' },
    ];
    const { attempted } = new BrowserNotFoundError({ candidates }).toJSON().context;
    assert.notStrictEqual(attempted.CHROMIUM_PATH, 'not found');
  });

  test('"not found" never on executablePath', () => {
    const candidates = [
      { source: 'env', path: null, ok: false, reason: 'not set' },
      { source: 'config', path: '/bad', ok: false, reason: 'file not found' },
      { source: 'system', path: null, ok: false, reason: 'not found' },
      { source: 'playwright', path: null, ok: false, reason: 'not found' },
    ];
    const { attempted } = new BrowserNotFoundError({ candidates }).toJSON().context;
    assert.notStrictEqual(attempted.executablePath, 'not found');
    assert.strictEqual(attempted.executablePath, 'set_invalid');
  });

  test('"not set" for user key with no path', () => {
    const candidates = [
      { source: 'env', path: null, ok: false, reason: 'not set' },
      { source: 'config', path: null, ok: false, reason: 'not set' },
      { source: 'system', path: null, ok: false, reason: 'not found' },
      { source: 'playwright', path: null, ok: false, reason: 'not found' },
    ];
    const { attempted } = new BrowserNotFoundError({ candidates }).toJSON().context;
    assert.strictEqual(attempted.CHROMIUM_PATH, 'not set');
    assert.strictEqual(attempted.executablePath, 'not set');
  });

  test('"resolved" for valid path', () => {
    const candidates = [
      { source: 'env', path: '/bin/ls', ok: true, reason: null },
      { source: 'config', path: null, ok: false, reason: 'not set' },
      { source: 'system', path: null, ok: false, reason: 'not found' },
      { source: 'playwright', path: null, ok: false, reason: 'not found' },
    ];
    const { attempted } = new BrowserNotFoundError({ candidates }).toJSON().context;
    assert.strictEqual(attempted.CHROMIUM_PATH, 'resolved');
  });
});

// ── failureSource and hint ────────────────────────────────────────────────────

describe('failureSource and hint derivation', () => {
  test('CHROMIUM_PATH set_invalid → failureSource = CHROMIUM_PATH', () => {
    const candidates = [
      { source: 'env', path: '/bad', ok: false, reason: 'file not found' },
      { source: 'config', path: '/also/bad', ok: false, reason: 'file not found' },
      { source: 'system', path: null, ok: false, reason: 'not found' },
      { source: 'playwright', path: null, ok: false, reason: 'not found' },
    ];
    const json = new BrowserNotFoundError({ candidates }).toJSON();
    assert.strictEqual(json.context.failureSource, 'CHROMIUM_PATH');
    assert.ok(json.hint.includes('CHROMIUM_PATH'), `hint must target CHROMIUM_PATH: ${json.hint}`);
  });

  test('CHROMIUM_PATH not set + executablePath set_invalid → failureSource = executablePath', () => {
    const candidates = [
      { source: 'env', path: null, ok: false, reason: 'not set' },
      { source: 'config', path: '/bad', ok: false, reason: 'file not found' },
      { source: 'system', path: null, ok: false, reason: 'not found' },
      { source: 'playwright', path: null, ok: false, reason: 'not found' },
    ];
    const json = new BrowserNotFoundError({ candidates }).toJSON();
    assert.strictEqual(json.context.failureSource, 'executablePath');
    assert.ok(
      json.hint.includes('--write-config'),
      `hint must target executablePath: ${json.hint}`
    );
  });

  test('both user sources not set → failureSource = executablePath (persistent preferred)', () => {
    const candidates = [
      { source: 'env', path: null, ok: false, reason: 'not set' },
      { source: 'config', path: null, ok: false, reason: 'not set' },
      { source: 'system', path: null, ok: false, reason: 'not found' },
      { source: 'playwright', path: null, ok: false, reason: 'not found' },
    ];
    const json = new BrowserNotFoundError({ candidates }).toJSON();
    assert.strictEqual(json.context.failureSource, 'executablePath');
  });

  test('CHROMIUM_PATH hint mentions restart MCP server', () => {
    const candidates = [
      { source: 'env', path: '/bad', ok: false, reason: 'file not found' },
      { source: 'config', path: null, ok: false, reason: 'not set' },
      { source: 'system', path: null, ok: false, reason: 'not found' },
      { source: 'playwright', path: null, ok: false, reason: 'not found' },
    ];
    const json = new BrowserNotFoundError({ candidates }).toJSON();
    assert.ok(
      json.hint.includes('restart MCP server'),
      `CHROMIUM_PATH hint must mention restart: ${json.hint}`
    );
  });
});

// ── restartNeeded computation ─────────────────────────────────────────────────

describe('restartNeeded computation', () => {
  test('absent when no configMeta provided', () => {
    const json = new BrowserNotFoundError({ candidates: allNothing }).toJSON();
    assert.ok(!json.restartNeeded, 'restartNeeded must be absent when no configMeta');
  });

  test('present when fileModifiedAt > loadedAt and user source failing', () => {
    const dir = makeTmp();
    const configFile = join(dir, 'config.local.toml');
    writeFileSync(configFile, '[browser]\nexecutablePath = "/bad/chrome"\n');

    // Set the file mtime to "now"
    const now = new Date();
    utimesSync(configFile, now, now);

    // loadedAt is 1 minute in the past
    const pastDate = new Date(now.getTime() - 60000);
    const loadedAt = pastDate.toISOString().replace(/\.\d{3}Z$/, 'Z');

    const configMeta = {
      loadedAt,
      source: `xdg (${dir})`,
    };

    const json = new BrowserNotFoundError({
      candidates: allNothing,
      configSource: `xdg (${dir})`,
      configMeta,
    }).toJSON();

    assert.strictEqual(json.restartNeeded, true);
    assert.ok(json.context.config.loadedAt);
    assert.ok(json.context.config.fileModifiedAt);
  });

  test('absent when fileModifiedAt <= loadedAt (file not newer)', () => {
    const dir = makeTmp();
    const configFile = join(dir, 'config.local.toml');
    writeFileSync(configFile, '[browser]\nexecutablePath = "/bad/chrome"\n');

    // Set file mtime to 1 minute in the past
    const past = new Date(Date.now() - 60000);
    utimesSync(configFile, past, past);

    // loadedAt is "now" (after the file was written)
    const loadedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const configMeta = { loadedAt, source: `xdg (${dir})` };

    const json = new BrowserNotFoundError({
      candidates: allNothing,
      configSource: `xdg (${dir})`,
      configMeta,
    }).toJSON();

    assert.ok(
      !json.restartNeeded,
      'restartNeeded must be absent when file not newer than loadedAt'
    );
  });

  test('context.config.loadedAt present when in configMeta', () => {
    const loadedAt = '2026-05-05T14:23:11Z';
    const json = new BrowserNotFoundError({
      candidates: [],
      configMeta: { loadedAt, source: 'none' },
    }).toJSON();
    assert.strictEqual(json.context.config.loadedAt, loadedAt);
  });

  test('context.config.loadedAt omitted (not null) when unavailable', () => {
    const json = new BrowserNotFoundError({ candidates: [] }).toJSON();
    assert.ok(!('loadedAt' in json.context.config), 'loadedAt must be omitted, not null');
  });

  test('context.config.fileModifiedAt omitted when source has no file', () => {
    const json = new BrowserNotFoundError({
      candidates: [],
      configSource: 'none (no config file found)',
      configMeta: { loadedAt: '2026-05-05T14:23:11Z', source: 'none' },
    }).toJSON();
    assert.ok(!('fileModifiedAt' in json.context.config));
  });
});

// ── SessionNotFoundError contract ─────────────────────────────────────────────

describe('SessionNotFoundError contract', () => {
  test('message is lowercase', () => {
    const err = new SessionNotFoundError('my-session');
    assert.ok(
      err.message.startsWith('session not found'),
      `message must be lowercase: ${err.message}`
    );
  });

  test('hint is present', () => {
    const err = new SessionNotFoundError('my-session');
    assert.ok(typeof err.hint === 'string' && err.hint.length > 0);
  });

  test('sessionId at root', () => {
    const err = new SessionNotFoundError('my-session');
    assert.strictEqual(err.sessionId, 'my-session');
  });

  test('code is SESSION_NOT_FOUND', () => {
    const err = new SessionNotFoundError('my-session');
    assert.strictEqual(err.code, 'SESSION_NOT_FOUND');
  });

  test('no restartNeeded', () => {
    const err = new SessionNotFoundError('my-session');
    assert.ok(!err.restartNeeded);
  });
});

// ── wrapError() dispatch ──────────────────────────────────────────────────────

describe('wrapError() dispatch', () => {
  test('calls toJSON() when present', () => {
    const err = new BrowserNotFoundError({
      candidates: [
        { source: 'env', path: null, ok: false, reason: 'not set' },
        { source: 'config', path: null, ok: false, reason: 'not set' },
        { source: 'system', path: null, ok: false, reason: 'not found' },
        { source: 'playwright', path: null, ok: false, reason: 'not found' },
      ],
    });
    const result = wrapError(err);
    assert.strictEqual(result.code, 'BROWSER_NOT_FOUND');
    assert.ok(result.context, 'wrapError via toJSON must include context');
    assert.ok(!('candidates' in result), 'candidates must not appear in wrapError output');
  });

  test('extracts fields explicitly for errors with code but no toJSON', () => {
    const err = new SessionNotFoundError('s1');
    const result = wrapError(err);
    assert.strictEqual(result.code, 'SESSION_NOT_FOUND');
    assert.ok(result.message.startsWith('session not found'));
    assert.strictEqual(result.hint, err.hint);
    assert.strictEqual(result.sessionId, 's1');
    assert.ok(!result.restartNeeded);
  });

  test('UNKNOWN_ERROR for errors without code', () => {
    const err = new Error('something broke');
    const result = wrapError(err);
    assert.strictEqual(result.code, 'UNKNOWN_ERROR');
    assert.ok(result.message.includes('something broke'));
    assert.ok(result.stack);
  });

  test('wrapError result is a plain object (JSON-safe)', () => {
    const err = new SessionNotFoundError('s2');
    const result = wrapError(err);
    const roundtripped = JSON.parse(JSON.stringify(result));
    assert.strictEqual(roundtripped.code, 'SESSION_NOT_FOUND');
    assert.strictEqual(roundtripped.sessionId, 's2');
  });
});
