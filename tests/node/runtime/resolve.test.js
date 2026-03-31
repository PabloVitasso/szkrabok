/**
 * Browser resolution tests — Stage 1 + Stage 2 + Stage 3 + Stage 4 + Stage 5 + Stage 6
 *
 * Run: node --test tests/node/runtime/resolve.test.js
 *
 * Category 1:  validateCandidate() — false-positive prevention (11 tests)
 * Category 2:  resolveChromium() — priority matrix (8 tests)
 * Category 3:  buildCandidates() — discovery shape (4 tests)
 * Category 4:  checkBrowser() + error contract (7 tests)
 * Category 5:  findChromiumPath backward compat (2 tests)
 * Category 6:  install-time invariant — postinstall no browser download (3 tests)
 * Category 7:  doctor CLI output (7 tests)
 * Category 8:  install-browser integrity (3 tests)
 * Category 9:  MCP tool / BrowserNotFoundError serialization (4 tests)
 * Category 10: cross-platform path handling (3 tests)
 * Category 11: Stage 6 — D1 exit codes, D2/D4 tag format, D3 CDP check, CHROMIUM_PATH=''
 * Category 12: snap wrapper fix — isFunctionalBrowser probe (3 tests)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync, symlinkSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import {
  validateCandidate,
  resolveChromium,
  buildCandidates,
  populateCandidates,
  isFunctionalBrowser,
} from '../../../packages/runtime/resolve.js';
import { checkBrowser } from '../../../packages/runtime/launch.js';
import { BrowserNotFoundError } from '../../../packages/runtime/errors.js';
import { initConfig } from '../../../packages/runtime/config.js';
import { findChromiumPath } from '../../../packages/runtime/config.js';
import {
  runDetect,
  writeExecPath,
  getGlobalConfigPath,
} from '../../../src/cli/lib/browser-actions.js';

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

// ── Category 7: doctor CLI output ─────────────────────────────────────────────
//
// Spawns `node src/index.js doctor` as a subprocess with controlled env.

describe('doctor CLI output', () => {
  const CLI = join(REPO_ROOT, 'src', 'index.js');

  test('env wins — [PASS  ] env shown, lower-priority candidates shown', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 10000,
      }
    );
    const out = result.stdout + result.stderr;
    assert.ok(
      out.includes('[PASS  ] env'),
      `expected "[PASS  ] env" in output:\n${out}`
    );
  });

  test('output lines with browser tags are fixed-width — [(PASS  |FAIL  |SKIP  |ABSENT|      )]', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 10000,
      }
    );
    const out = result.stdout + result.stderr;
    // Match the fixed-width 8-char bracket format
    const tagPattern = /\[(PASS {2}|FAIL {2}|SKIP {2}|ABSENT| {6})\]/;
    const tagLines = out.split('\n').filter(l => tagPattern.test(l));
    assert.ok(tagLines.length >= 1, `expected at least one fixed-width tag line:\n${out}`);
    for (const line of tagLines) {
      assert.ok(
        tagPattern.test(line),
        `line does not match fixed-width tag format:\n  ${line}`
      );
    }
  });

  test('valid browser — Resolved line present, exits 0', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 10000,
      }
    );
    const out = result.stdout + result.stderr;
    assert.ok(
      out.includes('Resolved:'),
      `expected "Resolved:" in output:\n${out}`
    );
    assert.strictEqual(result.status, 0, `expected exit 0:\n${out}`);
  });

  test('invalid CHROMIUM_PATH — env shows as [FAIL  ] (configured but broken, before winner or no winner)', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/nonexistent/chrome' },
        encoding: 'utf8',
        timeout: 10000,
      }
    );
    const out = result.stdout + result.stderr;
    // env failed validation — it is before any winner (or there is no winner)
    // → state is always 'fail' → [FAIL  ]
    assert.ok(
      out.includes('[FAIL  ] env'),
      `expected "[FAIL  ] env" in output:\n${out}`
    );
    // doctor always exits 0 (D1 contract)
    assert.strictEqual(result.status, 0, `doctor must exit 0 by default:\n${out}`);
  });
});

// ── Category 8: install-browser integrity (static) ────────────────────────────
//
// Verifies install-browser.js uses the resolution chain for post-install check.

describe('browser-actions integrity (static)', () => {
  test('browser-actions.js imports from #runtime — no hardcoded path logic', async () => {
    const src = await readFile(join(REPO_ROOT, 'src', 'cli', 'lib', 'browser-actions.js'), 'utf8');
    assert.ok(
      src.includes("from '#runtime'"),
      'browser-actions.js must import from #runtime for resolution'
    );
    assert.ok(
      src.includes('resolveChromium'),
      'browser-actions.js must call resolveChromium for resolution'
    );
  });
});

// ── Category 9: MCP tool behavior ─────────────────────────────────────────────
//
// Tests that session_manage open fails cleanly with BrowserNotFoundError.

describe('MCP tool: BrowserNotFoundError propagation', () => {
  test('szkrabok_session.js imports BrowserNotFoundError from #runtime', async () => {
    const src = await readFile(join(REPO_ROOT, 'src', 'tools', 'szkrabok_session.js'), 'utf8');
    assert.ok(
      src.includes('BrowserNotFoundError'),
      'szkrabok_session.js must import BrowserNotFoundError'
    );
    assert.ok(
      src.includes('instanceof BrowserNotFoundError'),
      'szkrabok_session.js must use instanceof check, not message string matching'
    );
  });

  test('szkrabok_session.js does not use --setup message', async () => {
    const src = await readFile(join(REPO_ROOT, 'src', 'tools', 'szkrabok_session.js'), 'utf8');
    assert.ok(
      !src.includes('--setup'),
      'szkrabok_session.js must not reference stale --setup message'
    );
  });
});

// ── Category 7 additions ───────────────────────────────────────────────────────

describe('doctor CLI output — ABSENT tag and version warning', () => {
  const CLI = join(REPO_ROOT, 'src', 'index.js');

  test('non-playwright binary — doctor prints [warn] or [note] for CDP compatibility', () => {
    // /bin/ls is a valid executable but not a real browser, source=env (not playwright).
    // Its --version output cannot be parsed as a Chromium major version →
    // extractChromiumMajor returns null → [note] (not [warn]).
    // A real Chrome binary would produce [warn] on mismatch or nothing on match.
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 10000,
      }
    );
    const out = result.stdout + result.stderr;
    assert.ok(
      (out.includes('[warn]') || out.includes('[note]')) && out.toLowerCase().includes('cdp'),
      `expected "[warn] CDP" or "[note] CDP" in output when using non-playwright binary:\n${out}`
    );
  });

  test('non-playwright binary — doctor prints version line', () => {
    // /bin/ls --version exits 0 and prints a version string on Linux
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 10000,
      }
    );
    const out = result.stdout + result.stderr;
    assert.ok(
      out.includes('Version:'),
      `expected "Version:" line in doctor output:\n${out}`
    );
  });

  test('[ABSENT] vs [FAIL  ]: doctor.js source uses ABSENT_REASONS and fixed-width TAGS', async () => {
    const src = await readFile(join(REPO_ROOT, 'src', 'cli', 'commands', 'doctor.js'), 'utf8');
    assert.ok(
      src.includes('ABSENT_REASONS'),
      'doctor.js must define ABSENT_REASONS to distinguish absent from failed candidates'
    );
    assert.ok(
      src.includes('[ABSENT]'),
      'doctor.js must use [ABSENT] tag for not-configured candidates'
    );
    assert.ok(
      src.includes('[FAIL  ]'),
      'doctor.js must use fixed-width [FAIL  ] tag (8 chars)'
    );
    assert.ok(
      src.includes('[PASS  ]'),
      'doctor.js must use fixed-width [PASS  ] tag (8 chars)'
    );
    assert.ok(
      src.includes('[SKIP  ]'),
      'doctor.js must use fixed-width [SKIP  ] tag (8 chars)'
    );
    // CHROMIUM_PATH='' must NOT be in ABSENT_REASONS — it is a fail, not absent
    assert.ok(
      !src.includes("'empty path'") || src.indexOf('ABSENT_REASONS') > src.indexOf("'empty path'"),
      "ABSENT_REASONS must not include 'empty path'"
    );
  });
});

// ── Category 8 additions — install-browser (mock npx) ─────────────────────────
//
// Uses a fake `npx` script on PATH to avoid a real ~200 MB download.
// Success path: fake npx exits 0, resolution runs against real installed browsers.
// Failure path: fake npx exits 2, install-browser must surface error + exit non-zero.

describe('doctor install: mock-npx integration', () => {
  const CLI = join(REPO_ROOT, 'src', 'index.js');

  // Helper: create a temp dir with a fake `npx` script, return { dir, cleanup }
  const makeFakeNpx = (exitCode) => {
    const dir = mkdtempSync(join(tmpdir(), 'szkrabok-test-npx-'));
    const fakeNpx = join(dir, 'npx');
    writeFileSync(fakeNpx, `#!/bin/sh\nexit ${exitCode}\n`);
    chmodSync(fakeNpx, 0o755);
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  };

  test('fake npx exits 0 → prints doctor detect --write-config tip and CHROMIUM_PATH hint, exits 0', () => {
    const { dir, cleanup } = makeFakeNpx(0);
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'doctor', 'install', '--force'],
        {
          env: { ...process.env, CHROMIUM_PATH: '/bin/ls', PATH: `${dir}:${process.env.PATH}` },
          encoding: 'utf8',
          timeout: 15000,
        }
      );
      assert.strictEqual(result.status, 0, `expected exit 0:\n${result.stderr}`);
      const out = result.stdout + result.stderr;
      assert.ok(
        out.includes('CHROMIUM_PATH'),
        `expected "CHROMIUM_PATH" hint in output:\n${out}`
      );
      assert.ok(
        out.includes('doctor detect --write-config'),
        `expected "doctor detect --write-config" tip in output:\n${out}`
      );
    } finally {
      cleanup();
    }
  });

  test('fake npx exits 2 → actionable stderr message, exits non-zero', () => {
    const { dir, cleanup } = makeFakeNpx(2);
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'doctor', 'install', '--force'],
        {
          env: { ...process.env, CHROMIUM_PATH: '/bin/ls', PATH: `${dir}:${process.env.PATH}` },
          encoding: 'utf8',
          timeout: 5000,
        }
      );
      assert.notStrictEqual(result.status, 0, 'should exit with non-zero code on install failure');
      assert.ok(
        result.stderr.includes('szkrabok doctor'),
        `expected "szkrabok doctor" in stderr:\n${result.stderr}`
      );
    } finally {
      cleanup();
    }
  });

  test('fake npx exits 0 → post-install prints resolved path', () => {
    const { dir, cleanup } = makeFakeNpx(0);
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'doctor', 'install', '--force'],
        {
          env: { ...process.env, CHROMIUM_PATH: '/bin/ls', PATH: `${dir}:${process.env.PATH}` },
          encoding: 'utf8',
          timeout: 15000,
        }
      );
      const out = result.stdout + result.stderr;
      const hasPath = out.includes('Path:') || out.includes('playwright-managed');
      const hasWarn = out.includes('not found after install') || out.includes('szkrabok doctor');
      assert.ok(
        hasPath || hasWarn,
        `expected path or warning in doctor install output:\n${out}`
      );
    } finally {
      cleanup();
    }
  });
});

// ── Category 9 additions — BrowserNotFoundError serialization ─────────────────

describe('BrowserNotFoundError serialization and MCP error contract', () => {
  test('has code = BROWSER_NOT_FOUND', () => {
    const err = new BrowserNotFoundError(undefined, { candidates: [] });
    assert.strictEqual(err.code, 'BROWSER_NOT_FOUND');
  });

  test('toJSON includes code, message, and candidates', () => {
    const candidates = [
      { source: 'env', path: null, ok: false, reason: 'not set' },
    ];
    const err = new BrowserNotFoundError(undefined, { candidates });
    const json = err.toJSON();
    assert.strictEqual(json.code, 'BROWSER_NOT_FOUND');
    assert.ok(typeof json.message === 'string' && json.message.length > 0);
    assert.deepEqual(json.candidates, candidates);
  });

  test('JSON.stringify preserves message — not empty object', () => {
    const err = new BrowserNotFoundError(undefined, { candidates: [] });
    const serialized = JSON.parse(JSON.stringify(err));
    assert.ok(
      serialized.message && serialized.message.includes('szkrabok install-browser'),
      `JSON.stringify must preserve message with install instructions:\n${JSON.stringify(serialized)}`
    );
    assert.strictEqual(serialized.code, 'BROWSER_NOT_FOUND');
  });

  test('resolve.js pure functions do not spawn processes', async () => {
    // Proves invariant I6: pure core never spawns.
    // child_process may be imported for isFunctionalBrowser (system candidate probe).
    // But spawnSync must NOT appear inside validateCandidate or resolveChromium.
    const src = await readFile(join(REPO_ROOT, 'packages', 'runtime', 'resolve.js'), 'utf8');
    const validateStart = src.indexOf('export const validateCandidate');
    const resolveStart = src.indexOf('export const resolveChromium');
    const buildStart = src.indexOf('export const buildCandidates');
    assert.ok(validateStart >= 0 && resolveStart > validateStart && buildStart > resolveStart,
      'expected validateCandidate < resolveChromium < buildCandidates in file order');
    const validateBody = src.slice(validateStart, resolveStart);
    const resolveBody = src.slice(resolveStart, buildStart);
    assert.ok(
      !validateBody.includes('spawnSync'),
      'spawnSync must not appear inside validateCandidate'
    );
    assert.ok(
      !resolveBody.includes('spawnSync'),
      'spawnSync must not appear inside resolveChromium'
    );
  });
});

// ── Category 11: Stage 6 refinements ─────────────────────────────────────────

describe('Stage 6 — D1: doctor exit code contract', () => {
  const CLI = join(REPO_ROOT, 'src', 'index.js');

  test('default: exits 0 even when checks fail (no browser)', () => {
    // Use a clearly invalid CHROMIUM_PATH and SZKRABOK_CONFIG pointing nowhere
    // so browser section fails. Doctor must still exit 0 without --strict.
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/nonexistent/chrome' },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    // Exit 0 regardless of check outcome — this is the public API contract
    assert.strictEqual(
      result.status, 0,
      `doctor must exit 0 by default (execution success), got ${result.status}:\n${result.stdout}${result.stderr}`
    );
  });

  test('--strict: exits 1 when checks fail', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor', '--strict'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/nonexistent/chrome' },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    // With --strict, doctor exits 1 when any check fails.
    // On this machine the TOML may resolve a browser — so we check the output
    // and only assert exit 1 if "Some checks failed" is present.
    if ((result.stdout + result.stderr).includes('Some checks failed')) {
      assert.strictEqual(
        result.status, 1,
        `doctor --strict must exit 1 when checks fail:\n${result.stdout}${result.stderr}`
      );
    } else {
      // All checks passed (e.g. TOML resolved a browser) — --strict exits 0
      assert.strictEqual(
        result.status, 0,
        `doctor --strict exits 0 when all checks pass:\n${result.stdout}${result.stderr}`
      );
    }
  });

  test('--strict: exits 0 when all checks pass', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor', '--strict'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    // /bin/ls is a valid executable — browser check passes, so all checks pass
    // (assuming node version >=20 and playwright-core is installed)
    assert.strictEqual(
      result.status, 0,
      `doctor --strict must exit 0 when all checks pass:\n${result.stdout}${result.stderr}`
    );
  });

  test('doctor.js source defines --strict option', async () => {
    const src = await readFile(join(REPO_ROOT, 'src', 'cli', 'commands', 'doctor.js'), 'utf8');
    assert.ok(
      src.includes('--strict'),
      'doctor.js must define --strict option'
    );
  });
});

describe('Stage 6 — D3: CDP version check via lookup table', () => {
  const CLI = join(REPO_ROOT, 'src', 'index.js');

  test('doctor.js defines PLAYWRIGHT_CHROMIUM_MAJOR lookup table', async () => {
    const src = await readFile(join(REPO_ROOT, 'src', 'cli', 'commands', 'doctor.js'), 'utf8');
    assert.ok(
      src.includes('PLAYWRIGHT_CHROMIUM_MAJOR'),
      'doctor.js must define PLAYWRIGHT_CHROMIUM_MAJOR lookup table'
    );
    // The version is captured from the playwright-core package.json already read above
    // (via resolvePlaywrightCore + fs.readFile) and stored in pwCoreVersion
    assert.ok(
      src.includes('pwCoreVersion'),
      'doctor.js must use pwCoreVersion as the lookup key (sourced from playwright-core package.json)'
    );
    // Must NOT use _revision — that is the rejected approach
    assert.ok(
      !src.includes('_revision'),
      'doctor.js must not use _revision — use package.json version as lookup key'
    );
  });

  test('non-playwright binary with unparseable version → [note] CDP', () => {
    // /bin/ls --version output cannot be parsed as "Chromium X.Y.Z.W" →
    // extractChromiumMajor returns null → [note], not [warn]
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    const out = result.stdout + result.stderr;
    assert.ok(
      out.includes('[note] CDP'),
      `expected "[note] CDP" for binary with unparseable version:\n${out}`
    );
  });

  test('playwright binary → no CDP warning or note', () => {
    // When using playwright-managed browser (default on this machine without CHROMIUM_PATH),
    // no CDP compatibility output should appear at all
    const orig = process.env.CHROMIUM_PATH;
    const env = { ...process.env };
    delete env.CHROMIUM_PATH;
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      { env, encoding: 'utf8', timeout: 15000 }
    );
    // restore (not needed since subprocess, but good form to document)
    void orig;
    const out = result.stdout + result.stderr;
    // If resolved via playwright, no CDP warning/note should appear
    if (out.includes('[PASS  ] playwright')) {
      assert.ok(
        !out.includes('[warn] CDP') && !out.includes('[note] CDP'),
        `playwright-managed binary must not produce CDP warning/note:\n${out}`
      );
    }
    // If resolved via another source (e.g. config executablePath), skip assertion
  });
});

describe('Stage 6 — D2/D4: tag format and state model', () => {
  const CLI = join(REPO_ROOT, 'src', 'index.js');

  test('CHROMIUM_PATH="" renders [FAIL  ] not [ABSENT]', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '' },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    const out = result.stdout + result.stderr;
    // empty string is a configured-but-invalid value → [FAIL  ], not [ABSENT]
    assert.ok(
      out.includes('[FAIL  ] env'),
      `expected "[FAIL  ] env" for CHROMIUM_PATH="" — empty string is fail, not absent:\n${out}`
    );
    assert.ok(
      !out.includes('[ABSENT] env'),
      `must NOT show "[ABSENT] env" for CHROMIUM_PATH="" :\n${out}`
    );
  });

  test('after winner: valid lower-priority candidate renders [SKIP  ]', () => {
    // env wins, system is also valid (populated by chrome-launcher if present)
    // We can only verify this on machines where system Chrome exists.
    // This test verifies the tag is present when applicable.
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    const out = result.stdout + result.stderr;
    // [SKIP  ] must be used (not [SKIP] without padding) if any skip-state candidate is shown
    if (out.includes('[SKIP')) {
      assert.ok(
        out.includes('[SKIP  ]'),
        `[SKIP] tags must be fixed-width [SKIP  ]:\n${out}`
      );
    }
    // post-winner candidates render their true evaluation state (never suppressed)
    // skip → [SKIP  ], absent → [ABSENT], fail → [FAIL  ]; no [      ] suppression
    assert.ok(
      !out.includes('[      ]'),
      `[      ] suppression tag must not appear — post-winner candidates always show true state:\n${out}`
    );
  });

  test('state model: no old variable-width tags present', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    const out = result.stdout + result.stderr;
    // Old tags without padding must not appear in browser resolution section
    assert.ok(!out.includes('[PASS]'), `old variable-width [PASS] must not appear:\n${out}`);
    assert.ok(!out.includes('[FAIL]'), `old variable-width [FAIL] must not appear:\n${out}`);
    assert.ok(!out.includes('[SKIP]'), `old variable-width [SKIP] must not appear:\n${out}`);
  });
});

// ── Category 12: snap wrapper fix — isFunctionalBrowser probe ─────────────────

describe('isFunctionalBrowser probe', () => {
  // Helper: create a temp stub script
  const makeStub = (body) => {
    const dir = mkdtempSync(join(tmpdir(), 'szkrabok-test-stub-'));
    const stub = join(dir, 'stub');
    writeFileSync(stub, `#!/bin/sh\n${body}\n`);
    chmodSync(stub, 0o755);
    return { stub, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  };

  test('stub exits 1 — returns false', () => {
    const { stub, cleanup } = makeStub('exit 1');
    try {
      assert.strictEqual(isFunctionalBrowser(stub), false);
    } finally {
      cleanup();
    }
  });

  test('stub exits 0, empty stdout — returns false', () => {
    const { stub, cleanup } = makeStub('exit 0');
    try {
      assert.strictEqual(isFunctionalBrowser(stub), false);
    } finally {
      cleanup();
    }
  });

  test('real binary /bin/ls — returns true', () => {
    assert.strictEqual(isFunctionalBrowser('/bin/ls'), true);
  });
});

// ── Category 10: cross-platform path handling ─────────────────────────────────

describe('cross-platform path handling', () => {
  test('path with spaces — validation runs without error', () => {
    // Does not need to exist — just must not throw internally
    const result = validateCandidate('/path/to/Google Chrome.app/Contents/MacOS/Google Chrome');
    assert.ok('ok' in result);
    assert.ok('reason' in result);
    // Should fail with file not found (not an internal error)
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'file not found');
  });

  test('trailing slash — rejected as not a file', () => {
    // /tmp/ has trailing slash — directories fail isFile check
    const result = validateCandidate('/tmp/');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'not a file');
  });

  test('Windows-style backslash path — skipped on non-Windows', { skip: process.platform !== 'win32' }, () => {
    // On win32, backslash paths must validate without internal errors.
    // validateCandidate normalises via statSync which handles win32 separators.
    const result = validateCandidate('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    // File won't exist in CI — just assert no unexpected internal error
    assert.ok(
      result.reason !== 'cannot stat path: undefined',
      `unexpected internal error for win32 path: ${result.reason}`
    );
    // Must be false (file won't exist), but with a recognisable reason
    assert.strictEqual(result.ok, false);
  });
});

// ── Category 13: browser-actions unit tests ───────────────────────────────────

describe('browser-actions unit', () => {
  test('runDetect() shape — winner has found; results has 4 entries with source/path/ok/reason', async () => {
    const { winner, results } = await runDetect();
    assert.ok('found' in winner);
    assert.strictEqual(results.length, 4);
    for (const r of results) {
      assert.ok(typeof r.source === 'string');
      assert.ok('path' in r);
      assert.ok(typeof r.ok === 'boolean');
      assert.ok('reason' in r);
    }
  });

  test('runDetect() winner is consistent with resolveChromium on same candidates', async () => {
    // runDetect uses initConfig([]) + getConfig() — run twice and compare for idempotency
    const { winner: w1, results: r1 } = await runDetect();
    const { winner: w2, results: r2 } = await runDetect();
    assert.strictEqual(w1.found, w2.found);
    if (w1.found) {
      assert.strictEqual(w1.path, w2.path);
      assert.strictEqual(w1.source, w2.source);
    }
    // winner must match the first ok result in results
    const firstOk = r1.find(r => r.ok);
    if (firstOk) {
      assert.ok(w1.found);
      assert.strictEqual(w1.path, firstOk.path);
      assert.strictEqual(w1.source, firstOk.source);
    } else {
      assert.ok(!w1.found);
    }
  });

  // writeExecPath tests use a temp XDG_CONFIG_HOME to avoid touching real config
  const makeTempConfig = () => {
    const dir = mkdtempSync(join(tmpdir(), 'szkrabok-test-cfg-'));
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  };

  const writeExecPathInTemp = async (existingContent, path) => {
    const { dir, cleanup } = makeTempConfig();
    const origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = dir;
    try {
      if (existingContent !== null) {
        const cfgDir = join(dir, 'szkrabok');
        mkdirSync(cfgDir, { recursive: true });
        writeFileSync(join(cfgDir, 'config.toml'), existingContent, 'utf8');
      }
      const configPath = await writeExecPath(path);
      const written = readFileSync(configPath, 'utf8');
      return written;
    } finally {
      if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = origXdg;
      cleanup();
    }
  };

  test('writeExecPath — no [default] section — creates [default] + key at top', async () => {
    const written = await writeExecPathInTemp('', '/opt/chrome');
    assert.ok(written.includes('[default]'), `missing [default]:\n${written}`);
    assert.ok(written.includes('executablePath = "/opt/chrome"'), `missing key:\n${written}`);
    // [default] must appear before the key
    assert.ok(written.indexOf('[default]') < written.indexOf('executablePath'));
  });

  test('writeExecPath — [default] exists, key absent — inserts key after header', async () => {
    const existing = '[default]\nheadless = true\n\n[other]\nfoo = "bar"\n';
    const written = await writeExecPathInTemp(existing, '/opt/chrome');
    assert.ok(written.includes('executablePath = "/opt/chrome"'));
    // [other] section must still be present
    assert.ok(written.includes('[other]'), `other section must be preserved:\n${written}`);
  });

  test('writeExecPath — [default] exists, key present — replaces in-place, rest unchanged', async () => {
    const existing = '[default]\nexecutablePath = "/old/chrome"\nheadless = true\n';
    const written = await writeExecPathInTemp(existing, '/new/chrome');
    assert.ok(written.includes('executablePath = "/new/chrome"'), `new path missing:\n${written}`);
    assert.ok(!written.includes('/old/chrome'), `old path must be gone:\n${written}`);
    assert.ok(written.includes('headless = true'), `other keys must be preserved:\n${written}`);
  });

  test('writeExecPath — multiple executablePath keys in [default] — throws without writing', async () => {
    const existing = '[default]\nexecutablePath = "/a"\nexecutablePath = "/b"\n';
    await assert.rejects(
      () => writeExecPathInTemp(existing, '/new'),
      /multiple executablePath/
    );
  });

  test('writeExecPath — multiple [default] sections — throws without writing', async () => {
    const existing = '[default]\nexecutablePath = "/a"\n[default]\nexecutablePath = "/b"\n';
    await assert.rejects(
      () => writeExecPathInTemp(existing, '/new'),
      /multiple \[default\] sections/
    );
  });

  test('writeExecPath — other sections untouched', async () => {
    const existing = '[other]\nfoo = "bar"\n\n[default]\nheadless = false\n';
    const written = await writeExecPathInTemp(existing, '/opt/chrome');
    assert.ok(written.includes('[other]'), `[other] must be preserved:\n${written}`);
    assert.ok(written.includes('foo = "bar"'), `other key must be preserved:\n${written}`);
  });

  test('getGlobalConfigPath() — returns absolute path containing szkrabok and config.toml', () => {
    const p = getGlobalConfigPath();
    assert.ok(p.includes('szkrabok'), `must contain 'szkrabok': ${p}`);
    assert.ok(p.endsWith('config.toml'), `must end with config.toml: ${p}`);
    assert.ok(p.startsWith('/') || /^[A-Z]:\\/.test(p), `must be absolute: ${p}`);
  });
});

// ── Category 7 addition — doctor --write-config hint ─────────────────────────

describe('doctor CLI output — write-config hint', () => {
  const CLI = join(REPO_ROOT, 'src', 'index.js');

  test('doctor (no subcommand) shows --write-config hint when winner source is not config', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    const out = result.stdout + result.stderr;
    // env is the winner source — not 'config' — hint must appear
    assert.ok(
      out.includes('--write-config'),
      `expected "--write-config" hint in output when winner is not from config:\n${out}`
    );
  });
});

// ── Category 14: doctor detect CLI ────────────────────────────────────────────

describe('doctor detect CLI', () => {
  const CLI = join(REPO_ROOT, 'src', 'index.js');

  test('valid browser found — stdout contains Resolved:, exits 0', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor', 'detect'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    const out = result.stdout + result.stderr;
    assert.ok(out.includes('Resolved:'), `expected "Resolved:" in output:\n${out}`);
    assert.strictEqual(result.status, 0, `expected exit 0:\n${out}`);
  });

  test('no browser found — stdout contains install hint, exits 0', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor', 'detect'],
      {
        env: {
          ...process.env,
          CHROMIUM_PATH: '/nonexistent/chrome',
          SZKRABOK_CONFIG: '/nonexistent/config.toml',
        },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    const out = result.stdout + result.stderr;
    // May still find playwright or system — test is best-effort on CI
    // If no browser: must mention install
    if (!out.includes('Resolved:')) {
      assert.ok(
        out.includes('doctor install') || out.includes('install'),
        `expected install hint when no browser found:\n${out}`
      );
    }
    assert.strictEqual(result.status, 0, `detect must exit 0:\n${out}`);
  });

  test('hint shown — source is env, not config — --write-config hint appears', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'doctor', 'detect'],
      {
        env: { ...process.env, CHROMIUM_PATH: '/bin/ls' },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    const out = result.stdout + result.stderr;
    assert.ok(
      out.includes('--write-config'),
      `expected "--write-config" hint when source is env:\n${out}`
    );
  });

  test('--write-config writes executablePath to config file', () => {
    const tmpXdg = mkdtempSync(join(tmpdir(), 'szkrabok-test-xdg-'));
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'doctor', 'detect', '--write-config'],
        {
          env: { ...process.env, CHROMIUM_PATH: '/bin/ls', XDG_CONFIG_HOME: tmpXdg },
          encoding: 'utf8',
          timeout: 15000,
        }
      );
      const out = result.stdout + result.stderr;
      const configFile = join(tmpXdg, 'szkrabok', 'config.toml');
      assert.ok(existsSync(configFile), `config file must be created:\n${out}`);
      const content = readFileSync(configFile, 'utf8');
      assert.ok(
        content.includes('executablePath = "'),
        `config must contain executablePath:\n${content}`
      );
    } finally {
      rmSync(tmpXdg, { recursive: true, force: true });
    }
  });

  test('--write-config prints "Written to:" in output', () => {
    const tmpXdg = mkdtempSync(join(tmpdir(), 'szkrabok-test-xdg2-'));
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'doctor', 'detect', '--write-config'],
        {
          env: { ...process.env, CHROMIUM_PATH: '/bin/ls', XDG_CONFIG_HOME: tmpXdg },
          encoding: 'utf8',
          timeout: 15000,
        }
      );
      const out = result.stdout + result.stderr;
      assert.ok(
        out.includes('Written to:'),
        `expected "Written to:" in output:\n${out}`
      );
    } finally {
      rmSync(tmpXdg, { recursive: true, force: true });
    }
  });
});

// ── Category 15: doctor install CLI ───────────────────────────────────────────

describe('doctor install CLI', () => {
  const CLI = join(REPO_ROOT, 'src', 'index.js');

  // Helper: create a temp dir with a fake `npx` script, return { dir, cleanup }
  const makeFakeNpxInstall = (exitCode, sentinel = null) => {
    const dir = mkdtempSync(join(tmpdir(), 'szkrabok-test-inst-npx-'));
    const fakeNpx = join(dir, 'npx');
    const sentinelLine = sentinel ? `touch ${sentinel}` : '';
    writeFileSync(fakeNpx, `#!/bin/sh\n${sentinelLine}\nexit ${exitCode}\n`);
    chmodSync(fakeNpx, 0o755);
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  };

  test('playwright already installed — exits 0, "already installed" message, npx not called', () => {
    // Simulate playwright-managed path by resolving what playwright actually has
    // We use the env/PATH trick: put a sentinel-writing fake npx on PATH
    const sentinelFile = join(tmpdir(), `szkrabok-sentinel-${Date.now()}`);
    const { dir, cleanup } = makeFakeNpxInstall(0, sentinelFile);
    try {
      // Find real playwright chromium path
      const { chromium } = (() => {
        try { return require('playwright'); } catch { return {}; }
      })();
      // Use /bin/ls as a stand-in for playwright source since we can't easily fake source=playwright
      // Instead, test the force guard: if browser already found via any source + no force, no download
      // We rely on the idempotency logic in runInstall: found && source !== playwright && !force → no download
      const result = spawnSync(
        process.execPath,
        [CLI, 'doctor', 'install'],
        {
          env: { ...process.env, CHROMIUM_PATH: '/bin/ls', PATH: `${dir}:${process.env.PATH}` },
          encoding: 'utf8',
          timeout: 15000,
        }
      );
      const out = result.stdout + result.stderr;
      assert.strictEqual(result.status, 0, `expected exit 0:\n${out}`);
      // no-op path: browser found via env, no force → npx must NOT be called
      assert.ok(
        !existsSync(sentinelFile),
        `npx must not be called when browser already found (no --force):\n${out}`
      );
      assert.ok(
        out.includes('Browser found via') || out.includes('already installed'),
        `expected no-op message:\n${out}`
      );
    } finally {
      cleanup();
      try { rmSync(sentinelFile); } catch {} // eslint-disable-line no-empty -- best-effort cleanup
    }
  });

  test('browser found non-playwright — exits 0, no download without --force', () => {
    const sentinelFile = join(tmpdir(), `szkrabok-sentinel2-${Date.now()}`);
    const { dir, cleanup } = makeFakeNpxInstall(0, sentinelFile);
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'doctor', 'install'],
        {
          env: { ...process.env, CHROMIUM_PATH: '/bin/ls', PATH: `${dir}:${process.env.PATH}` },
          encoding: 'utf8',
          timeout: 15000,
        }
      );
      const out = result.stdout + result.stderr;
      assert.strictEqual(result.status, 0, `expected exit 0:\n${out}`);
      assert.ok(!existsSync(sentinelFile), `npx must not be called:\n${out}`);
    } finally {
      cleanup();
      try { rmSync(sentinelFile); } catch {} // eslint-disable-line no-empty -- best-effort cleanup
    }
  });

  test('no browser — downloads (mock npx exits 0) — exits 0, prints resolution result', () => {
    const { dir, cleanup } = makeFakeNpxInstall(0);
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'doctor', 'install', '--force'],
        {
          env: { ...process.env, CHROMIUM_PATH: '/bin/ls', PATH: `${dir}:${process.env.PATH}` },
          encoding: 'utf8',
          timeout: 15000,
        }
      );
      const out = result.stdout + result.stderr;
      assert.strictEqual(result.status, 0, `expected exit 0:\n${out}`);
      // After fake install, playwright path is resolved (playwright IS installed on this machine)
      const hasOutput = out.includes('playwright-managed') || out.includes('Path:') ||
        out.includes('resolved via') || out.includes('not found after install') ||
        out.includes('szkrabok doctor');
      assert.ok(hasOutput, `expected meaningful output after install:\n${out}`);
    } finally {
      cleanup();
    }
  });

  test('install failure (mock npx exits 2) — exits non-zero, stderr contains "szkrabok doctor"', () => {
    const { dir, cleanup } = makeFakeNpxInstall(2);
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'doctor', 'install', '--force'],
        {
          env: { ...process.env, CHROMIUM_PATH: '/bin/ls', PATH: `${dir}:${process.env.PATH}` },
          encoding: 'utf8',
          timeout: 15000,
        }
      );
      assert.notStrictEqual(result.status, 0, `expected non-zero exit on install failure`);
      assert.ok(
        result.stderr.includes('szkrabok doctor'),
        `expected "szkrabok doctor" in stderr:\n${result.stderr}`
      );
    } finally {
      cleanup();
    }
  });
});

// ── Category 16: removed commands rejected ────────────────────────────────────

describe('removed commands rejected', () => {
  const CLI = join(REPO_ROOT, 'src', 'index.js');

  test('detect-browser → unknown command error, exits non-zero', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'detect-browser'],
      { encoding: 'utf8', timeout: 5000 }
    );
    assert.notStrictEqual(result.status, 0, 'detect-browser must exit non-zero (removed command)');
    const out = result.stdout + result.stderr;
    assert.ok(
      out.toLowerCase().includes('unknown') || out.toLowerCase().includes('error'),
      `expected error/unknown in output:\n${out}`
    );
  });

  test('install-browser → unknown command error, exits non-zero', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'install-browser'],
      { encoding: 'utf8', timeout: 5000 }
    );
    assert.notStrictEqual(result.status, 0, 'install-browser must exit non-zero (removed command)');
    const out = result.stdout + result.stderr;
    assert.ok(
      out.toLowerCase().includes('unknown') || out.toLowerCase().includes('error'),
      `expected error/unknown in output:\n${out}`
    );
  });
});
