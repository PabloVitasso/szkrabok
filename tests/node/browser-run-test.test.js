/**
 * Unit tests for szkrabok_browser.js helpers:
 *   - waitForAttach: file-system polling primitive for CDP attach confirmation
 *
 * No browser, no subprocess, no mocks needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { waitForAttach } = await import('../../src/tools/szkrabok_browser.js');

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

    // Resolved on first poll - well under one poll interval (100ms).
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

