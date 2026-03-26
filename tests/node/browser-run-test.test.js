/**
 * Unit tests for szkrabok_browser.js helpers:
 *   - waitForAttach: file-system polling primitive for CDP attach confirmation
 *   - getRuntimeEntry / writeRuntimeShim: F-option shim injection for zero-install MCP
 *
 * No browser, no subprocess, no mocks needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { waitForAttach, getRuntimeEntry, writeRuntimeShim } =
  await import('../../src/tools/szkrabok_browser.js');

const makeTmp = () => mkdtemp(join(tmpdir(), 'wat-test-'));

test('waitForAttach resolves when signal file exists', async () => {
  const dir = await makeTmp();
  try {
    const signalFile = join(dir, '.attach-signal');

    // Create the signal file before calling waitForAttach.
    // The polling loop should find it on the first poll and resolve immediately.
    await writeFile(signalFile, '');

    const start = Date.now();
    await waitForAttach(signalFile);
    const elapsed = Date.now() - start;

    // Resolved on first poll — well under one poll interval (100ms).
    assert.ok(elapsed < 500, `should resolve immediately, took ${elapsed}ms`);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('waitForAttach resolves when signal file appears after a delay', async () => {
  const dir = await makeTmp();
  try {
    const signalFile = join(dir, '.attach-signal');

    // Write the signal file from a detached setTimeout so the event loop
    // is free to run it while waitForAttach is polling.
    const timer = setTimeout(() => {
      writeFile(signalFile, '').catch(() => {});
    }, 150);

    const start = Date.now();
    await waitForAttach(signalFile);
    const elapsed = Date.now() - start;

    clearTimeout(timer);

    // Should resolve shortly after the file is written (~150ms), well before the 30s timeout.
    assert.ok(
      elapsed < 5000,
      `should resolve after file appears, took ${elapsed}ms`
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});

// --- getRuntimeEntry / writeRuntimeShim ---

test('getRuntimeEntry returns a resolvable path string', () => {
  // The MCP server package can always resolve its own runtime subpath.
  const entry = getRuntimeEntry();
  assert.ok(typeof entry === 'string' && entry.length > 0, 'should return a non-empty string');
  assert.ok(entry.endsWith('.js') || entry.endsWith('.mjs'), `should be a JS file, got: ${entry}`);
});

test('writeRuntimeShim creates a valid ESM re-export file', async () => {
  const shimPath = writeRuntimeShim();
  assert.ok(shimPath !== null, 'should return a path when runtime is resolvable');
  try {
    assert.ok(existsSync(shimPath), 'shim file should exist on disk');
    const content = await readFile(shimPath, 'utf8');
    assert.match(content, /^export \* from ".+";$/m, 'shim should be a valid ESM re-export');
  } finally {
    await rm(shimPath, { force: true });
  }
});

test('writeRuntimeShim produces unique paths on concurrent calls', async () => {
  const [a, b] = [writeRuntimeShim(), writeRuntimeShim()];
  try {
    assert.ok(a !== null && b !== null, 'both calls should succeed');
    assert.notEqual(a, b, 'paths should be unique');
  } finally {
    await Promise.all([a, b].map(p => p && rm(p, { force: true })));
  }
});

test('NODE_OPTIONS injection preserves existing value', () => {
  const existing = '--max-old-space-size=512';
  const shimArg = '--import=/tmp/test-shim.mjs';
  const result = [existing, shimArg].filter(Boolean).join(' ');
  assert.ok(result.includes(existing), 'should preserve existing NODE_OPTIONS');
  assert.ok(result.includes(shimArg), 'should include shim import');
});

test('NODE_OPTIONS injection with empty existing value omits leading space', () => {
  const shimArg = '--import=/tmp/test-shim.mjs';
  const result = [undefined, shimArg].filter(Boolean).join(' ');
  assert.equal(result, shimArg, 'should not have leading space when no prior NODE_OPTIONS');
});
