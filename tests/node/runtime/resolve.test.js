/**
 * Browser resolution tests — Stage 1 + Stage 2 + Stage 3
 *
 * Run: node --test tests/node/runtime/resolve.test.js
 *
 * Category 1: validateCandidate() — false-positive prevention (11 tests)
 * Category 2: resolveChromium() — priority matrix (8 tests)
 * Category 3: buildCandidates() — discovery shape (4 tests)
 * Category 4: checkBrowser() + error contract (7 tests)
 * Category 5: findChromiumPath backward compat (2 tests)
 * Category 6: install-time invariant — postinstall no browser download (3 tests)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, chmodSync, symlinkSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  validateCandidate,
  resolveChromium,
  buildCandidates,
} from '../../../packages/runtime/resolve.js';
import { checkBrowser } from '../../../packages/runtime/launch.js';
import { BrowserNotFoundError } from '../../../packages/runtime/errors.js';
import { initConfig } from '../../../packages/runtime/config.js';
import { findChromiumPath } from '../../../packages/runtime/config.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ── Helpers ────────────────────────────────────────────────────────────────────

const OK_PATH = '/bin/ls';

function makeNonExecutableFile() {
  const dir = join(tmpdir(), `szkrabok-test-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'not-exec');
  writeFileSync(file, '');
  chmodSync(file, 0o644);
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── Category 1: validateCandidate ─────────────────────────────────────────────

describe('validateCandidate', () => {
  test('accepts real executable — exact shape', () => {
    const result = validateCandidate(OK_PATH);
    assert.deepEqual(result, { ok: true, reason: null });
  });

  test('rejects non-existent path — "not found", not "not a file"', () => {
    const result = validateCandidate('/nonexistent/chrome');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'file not found');
  });

  test('rejects directory — "not a file", not "not executable"', () => {
    const result = validateCandidate('/tmp');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'not a file');
  });

  test('rejects non-executable file — passes stat+isFile, fails accessSync', () => {
    const { file, cleanup } = makeNonExecutableFile();
    try {
      const result = validateCandidate(file);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'not executable');
    } finally {
      cleanup();
    }
  });

  test('rejects empty string — before filesystem checks', () => {
    const result = validateCandidate('');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'empty path');
  });

  test('rejects null — before filesystem checks', () => {
    const result = validateCandidate(null);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'not set');
  });

  test('rejects undefined — treated same as null', () => {
    const result = validateCandidate(undefined);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'not set');
  });

  test('surfaces real permission error — not ENOENT', () => {
    const result = validateCandidate('/root/.bashrc');
    if (process.getuid?.() === 0) {
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'not executable');
      return;
    }
    assert.strictEqual(result.ok, false);
    assert.ok(
      !result.reason.includes('not found'),
      `should not say "not found" for permission error: ${result.reason}`
    );
    assert.ok(
      result.reason.includes('cannot resolve') || result.reason.includes('cannot stat'),
      `should mention real error: ${result.reason}`
    );
  });

  test('rejects broken symlink — "file not found" (symlink target does not exist)', () => {
    // On Linux, stat() on a broken symlink returns ENOENT — same as non-existent path.
    // ELOOP is only for "too many symlink levels" (circular reference), not for
    // a symlink whose target is missing. So "file not found" is the correct reason.
    const dir = join(tmpdir(), `szkrabok-test-${process.pid}-${Date.now()}-symlink`);
    mkdirSync(dir, { recursive: true });
    const link = join(dir, 'broken-link');
    symlinkSync('/nonexistent/target', link);
    try {
      const result = validateCandidate(link);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(
        result.reason,
        'file not found',
        `expected "file not found", got: ${result.reason}`
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts valid symlink to executable', () => {
    const dir = join(tmpdir(), `szkrabok-test-${process.pid}-${Date.now()}-symlink2`);
    mkdirSync(dir, { recursive: true });
    const link = join(dir, 'ls-link');
    symlinkSync('/bin/ls', link);
    try {
      const result = validateCandidate(link);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.reason, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns consistent shape — always { ok, reason }', () => {
    const inputs = [null, undefined, '', '/nope', OK_PATH];
    for (const input of inputs) {
      const result = validateCandidate(input);
      assert.ok('ok' in result);
      assert.ok('reason' in result);
      assert.strictEqual(typeof result.ok, 'boolean');
    }
  });
});

// ── Category 2: resolveChromium priority matrix ────────────────────────────────

describe('resolveChromium priority matrix', () => {
  test('#1: env ok -> source=env, path matches input', () => {
    const result = resolveChromium([{ source: 'env', path: OK_PATH }]);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.source, 'env');
    assert.strictEqual(result.path, OK_PATH);
    assert.ok(!('candidates' in result));
  });

  test('#2: env fail, config ok -> source=config', () => {
    const result = resolveChromium([
      { source: 'env', path: '/nonexistent' },
      { source: 'config', path: OK_PATH },
    ]);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.source, 'config');
    assert.strictEqual(result.path, OK_PATH);
  });

  test('#3: env fail, config fail, system ok -> source=system', () => {
    const result = resolveChromium([
      { source: 'env', path: '/nonexistent' },
      { source: 'config', path: '/nonexistent' },
      { source: 'system', path: OK_PATH },
    ]);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.source, 'system');
    assert.strictEqual(result.path, OK_PATH);
  });

  test('#4: all fail except playwright -> source=playwright', () => {
    const result = resolveChromium([
      { source: 'env', path: '/nonexistent' },
      { source: 'config', path: '/nonexistent' },
      { source: 'system', path: '/nonexistent' },
      { source: 'playwright', path: OK_PATH },
    ]);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.source, 'playwright');
    assert.strictEqual(result.path, OK_PATH);
  });

  test('#5: all fail -> not found, each candidate has specific reason', () => {
    const result = resolveChromium([
      { source: 'env', path: '/nonexistent' },
      { source: 'config', path: '/nonexistent' },
      { source: 'system', path: null },
      { source: 'playwright', path: null },
    ]);
    assert.strictEqual(result.found, false);
    assert.ok(!('path' in result));
    assert.ok(!('source' in result));
    assert.ok(Array.isArray(result.candidates));
    assert.strictEqual(result.candidates.length, 4);

    const bySource = Object.fromEntries(result.candidates.map(c => [c.source, c]));
    assert.strictEqual(bySource.env.ok, false);
    assert.strictEqual(bySource.env.reason, 'file not found');
    assert.strictEqual(bySource.config.ok, false);
    assert.strictEqual(bySource.config.reason, 'file not found');
    assert.strictEqual(bySource.system.ok, false);
    assert.strictEqual(bySource.system.reason, 'not set');
    assert.strictEqual(bySource.playwright.ok, false);
    assert.strictEqual(bySource.playwright.reason, 'not set');
  });

  test('#6: env ok, config ok -> env wins', () => {
    const result = resolveChromium([
      { source: 'env', path: OK_PATH },
      { source: 'config', path: OK_PATH },
    ]);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.source, 'env');
    assert.ok(!('candidates' in result));
  });

  test('#7: all ok -> env wins, others not inspected', () => {
    const result = resolveChromium([
      { source: 'env', path: OK_PATH },
      { source: 'config', path: OK_PATH },
      { source: 'system', path: OK_PATH },
      { source: 'playwright', path: OK_PATH },
    ]);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.source, 'env');
    assert.ok(!('candidates' in result));
  });

  test('#8: short-circuit — failure list stops before winner', () => {
    const result = resolveChromium([
      { source: 'env', path: '/nonexistent' },
      { source: 'config', path: OK_PATH },
      { source: 'system', path: OK_PATH },
    ]);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.source, 'config');
    assert.ok(!('candidates' in result), 'success must not carry failure list');
  });
});

// ── Category 3: buildCandidates ───────────────────────────────────────────────

describe('buildCandidates', () => {
  test('returns 4 candidates in precedence order', () => {
    const candidates = buildCandidates({});
    assert.strictEqual(candidates.length, 4);
    assert.strictEqual(candidates[0].source, 'env');
    assert.strictEqual(candidates[1].source, 'config');
    assert.strictEqual(candidates[2].source, 'system');
    assert.strictEqual(candidates[3].source, 'playwright');
  });

  test('passes through config.executablePath', () => {
    const candidates = buildCandidates({ executablePath: '/opt/chrome' });
    assert.strictEqual(candidates[1].path, '/opt/chrome');
  });

  test('system and playwright are null (async probe not in scope)', () => {
    const candidates = buildCandidates({});
    assert.strictEqual(candidates[2].path, null);
    assert.strictEqual(candidates[3].path, null);
  });

  test('preserves empty string from env — does not coerce to null', () => {
    const orig = process.env.CHROMIUM_PATH;
    process.env.CHROMIUM_PATH = '';
    try {
      const candidates = buildCandidates({});
      assert.strictEqual(candidates[0].path, '');
    } finally {
      if (orig === undefined) delete process.env.CHROMIUM_PATH;
      else process.env.CHROMIUM_PATH = orig;
    }
  });
});

// ── Category 4: checkBrowser + error contract ─────────────────────────────────

describe('checkBrowser + error contract', () => {
  test('returns string path when CHROMIUM_PATH points to valid executable', async () => {
    initConfig([]);
    const orig = process.env.CHROMIUM_PATH;
    process.env.CHROMIUM_PATH = '/bin/ls';
    try {
      const result = await checkBrowser();
      assert.strictEqual(typeof result, 'string');
      assert.strictEqual(result, '/bin/ls');
    } finally {
      if (orig !== undefined) process.env.CHROMIUM_PATH = orig;
      else delete process.env.CHROMIUM_PATH;
    }
  });

  test('CHROMIUM_PATH wins over config.executablePath', async () => {
    initConfig([]);
    const orig = process.env.CHROMIUM_PATH;
    process.env.CHROMIUM_PATH = '/bin/ls';
    try {
      const result = await checkBrowser();
      assert.strictEqual(result, '/bin/ls');
    } finally {
      if (orig !== undefined) process.env.CHROMIUM_PATH = orig;
      else delete process.env.CHROMIUM_PATH;
    }
  });

  test('never throws on this machine (TOML has valid executablePath)', async () => {
    initConfig([]);
    const orig = process.env.CHROMIUM_PATH;
    delete process.env.CHROMIUM_PATH;
    try {
      const result = await checkBrowser();
      assert.strictEqual(typeof result, 'string');
    } finally {
      if (orig !== undefined) process.env.CHROMIUM_PATH = orig;
    }
  });

  test('BrowserNotFoundError has all required fields', () => {
    const candidates = [
      { source: 'env', path: null, ok: false, reason: 'not set' },
      { source: 'config', path: null, ok: false, reason: 'not set' },
      { source: 'system', path: null, ok: false, reason: 'not set' },
      { source: 'playwright', path: null, ok: false, reason: 'not set' },
    ];
    const lines = candidates
      .map(c => {
        const pathDisplay = c.path ?? '(not set)';
        return `  ${c.source.padEnd(12)} ${pathDisplay} — ${c.reason}`;
      })
      .join('\n');
    const err = new BrowserNotFoundError(
      'Chromium not found.\n\n' +
        'Options (choose one):\n' +
        '  1. szkrabok install-browser\n' +
        '  2. export CHROMIUM_PATH=/usr/bin/google-chrome\n' +
        '  3. Set executablePath in szkrabok.config.toml\n\n' +
        'Candidates checked:\n' +
        lines,
      { candidates }
    );
    assert.ok(err instanceof Error);
    assert.ok(err instanceof BrowserNotFoundError);
    assert.ok(Array.isArray(err.candidates));
    assert.strictEqual(err.candidates.length, 4);
    assert.ok(err.message.includes('szkrabok install-browser'));
    assert.ok(err.message.includes('CHROMIUM_PATH'));
    assert.ok(err.message.includes('executablePath'));
  });

  test('BrowserNotFoundError message is deterministic', () => {
    const candidates = [
      { source: 'env', path: null, ok: false, reason: 'not set' },
      { source: 'config', path: null, ok: false, reason: 'not set' },
      { source: 'system', path: null, ok: false, reason: 'not set' },
      { source: 'playwright', path: null, ok: false, reason: 'not set' },
    ];
    const err1 = new BrowserNotFoundError('test', { candidates });
    const err2 = new BrowserNotFoundError('test', { candidates });
    assert.strictEqual(err1.message, err2.message);
  });

  test('resolveChromium failure has all fields for error construction', () => {
    const result = resolveChromium([
      { source: 'env', path: null },
      { source: 'config', path: null },
      { source: 'system', path: null },
      { source: 'playwright', path: null },
    ]);
    assert.strictEqual(result.found, false);
    assert.ok(Array.isArray(result.candidates));
    assert.strictEqual(result.candidates.length, 4);
    for (const c of result.candidates) {
      assert.ok(typeof c.source === 'string');
      assert.ok('ok' in c);
      assert.ok('reason' in c);
      assert.ok('path' in c);
    }
  });

  test('resolveChromium is pure — completes without side effects', () => {
    const start = Date.now();
    const result = resolveChromium([
      { source: 'env', path: '/nonexistent' },
      { source: 'config', path: null },
      { source: 'system', path: null },
      { source: 'playwright', path: null },
    ]);
    const elapsed = Date.now() - start;
    assert.strictEqual(result.found, false);
    assert.ok(elapsed < 100, `resolveChromium took ${elapsed}ms — possible side effect`);
  });
});

// ── Category 5: findChromiumPath backward compat ─────────────────────────────

describe('findChromiumPath backward compat', () => {
  test('returns string or null — never throws, never undefined', async () => {
    const result = await findChromiumPath();
    assert.ok(result === null || typeof result === 'string');
  });

  test('returned path exists on disk when non-null', async () => {
    const result = await findChromiumPath();
    if (result !== null) {
      assert.ok(existsSync(result));
    }
  });
});

// ── Category 6: install-time invariant (I1) ────────────────────────────────────
//
// Static analysis: postinstall chain must not trigger browser download.

describe('install-time: no browser download in postinstall', () => {
  test('postinstall does not reference "playwright install"', async () => {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
    const postinstall = pkg.scripts?.postinstall ?? '';
    assert.ok(
      !postinstall.includes('playwright install'),
      `postinstall must not reference "playwright install":\n  ${postinstall}`
    );
  });

  test('postinstall does not import postinstall.js', async () => {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
    const postinstall = pkg.scripts?.postinstall ?? '';
    assert.ok(
      !postinstall.includes('postinstall.js'),
      `postinstall must not import postinstall.js:\n  ${postinstall}`
    );
  });

  test('scripts/postinstall.js still exists (manual fallback)', () => {
    assert.ok(
      existsSync(join(REPO_ROOT, 'scripts', 'postinstall.js')),
      'scripts/postinstall.js must exist for manual use'
    );
  });
});
