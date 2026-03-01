/**
 * Phase 5.1 — Runtime unit tests.
 *
 * Run without MCP, without Playwright Test runner:
 *   node --test selftest/runtime/unit.test.js
 *
 * Tests: config loading, preset resolution, storage paths, pool operations.
 * Does NOT launch a browser (no network required).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Config / preset ───────────────────────────────────────────────────────────

describe('resolvePreset', () => {
  test('returns default preset for null name', async () => {
    const { resolvePreset } = await import('../../packages/runtime/config.js');
    const result = resolvePreset(null);
    assert.ok(result.preset, 'preset field present');
    assert.ok(typeof result.label === 'string', 'label is string');
  });

  test('returns default preset for "default"', async () => {
    const { resolvePreset } = await import('../../packages/runtime/config.js');
    const a = resolvePreset(null);
    const b = resolvePreset('default');
    assert.deepEqual(a, b);
  });

  test('unknown preset falls back gracefully without throwing', async () => {
    const { resolvePreset } = await import('../../packages/runtime/config.js');
    const result = resolvePreset('this-preset-does-not-exist');
    assert.ok(result, 'returned a result');
    assert.ok(typeof result.label === 'string');
  });

  test('HEADLESS export is boolean', async () => {
    const { HEADLESS } = await import('../../packages/runtime/config.js');
    assert.strictEqual(typeof HEADLESS, 'boolean');
  });

  test('STEALTH_ENABLED export is boolean', async () => {
    const { STEALTH_ENABLED } = await import('../../packages/runtime/config.js');
    assert.strictEqual(typeof STEALTH_ENABLED, 'boolean');
  });
});

// ── Pool ──────────────────────────────────────────────────────────────────────

describe('pool', () => {
  test('add + has + get + remove cycle', async () => {
    const pool = await import('../../packages/runtime/pool.js');

    const mockContext = {
      _closed: false,
      browser: () => null,
      storageState: async () => ({ cookies: [], origins: [] }),
      close: async () => {},
      pages: () => [],
    };
    const mockPage = {
      isClosed: () => false,
      url: () => 'about:blank',
    };

    pool.add('unit-test-1', mockContext, mockPage, 20001, 'default', 'Default');
    assert.ok(pool.has('unit-test-1'));

    const entry = pool.get('unit-test-1');
    assert.strictEqual(entry.context, mockContext);
    assert.strictEqual(entry.page, mockPage);
    assert.strictEqual(entry.cdpPort, 20001);

    pool.remove('unit-test-1');
    assert.ok(!pool.has('unit-test-1'));
  });

  test('get throws for missing session', async () => {
    const pool = await import('../../packages/runtime/pool.js');
    assert.throws(() => pool.get('does-not-exist'), /Session not found/);
  });

  test('list returns array', async () => {
    const pool = await import('../../packages/runtime/pool.js');
    const result = pool.list();
    assert.ok(Array.isArray(result));
  });
});

// ── Storage ───────────────────────────────────────────────────────────────────

describe('storage', () => {
  let tmpDir;

  test('before: create temp dir', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'szkrabok-runtime-test-'));
    process.env.SZKRABOK_SESSIONS_DIR = tmpDir;
  });

  test('ensureSessionsDir creates directory', async () => {
    const storage = await import('../../packages/runtime/storage.js');
    await storage.ensureSessionsDir();
    // Should not throw; directory already created
  });

  test('sessionExists returns false for new id', async () => {
    const storage = await import('../../packages/runtime/storage.js');
    assert.strictEqual(storage.sessionExists('no-such-profile'), false);
  });

  test('getUserDataDir returns a path string', async () => {
    const storage = await import('../../packages/runtime/storage.js');
    const dir = storage.getUserDataDir('myprofile');
    assert.ok(typeof dir === 'string' && dir.includes('myprofile'));
  });

  test('saveState + loadState round-trip', async () => {
    const storage = await import('../../packages/runtime/storage.js');
    const id = 'unit-state-test';
    const state = { cookies: [{ name: 'foo', value: 'bar', domain: 'example.com', path: '/' }], origins: [] };

    await storage.saveState(id, state);
    const loaded = await storage.loadState(id);
    assert.deepEqual(loaded, state);
  });

  test('saveMeta + loadMeta round-trip', async () => {
    const storage = await import('../../packages/runtime/storage.js');
    const id = 'unit-meta-test';
    const meta = { sessionName: id, preset: 'default', created: Date.now() };

    await storage.saveMeta(id, meta);
    const loaded = await storage.loadMeta(id);
    assert.deepEqual(loaded, meta);
  });

  test('updateMeta merges and updates lastUsed', async () => {
    const storage = await import('../../packages/runtime/storage.js');
    const id = 'unit-meta-update';
    await storage.saveMeta(id, { sessionName: id, created: 1000 });
    const updated = await storage.updateMeta(id, { lastUrl: 'https://example.com' });
    assert.strictEqual(updated.lastUrl, 'https://example.com');
    assert.ok(updated.lastUsed > 0);
  });

  test('loadState returns null for missing session', async () => {
    const storage = await import('../../packages/runtime/storage.js');
    const result = await storage.loadState('never-saved');
    assert.strictEqual(result, null);
  });

  test('after: cleanup temp dir', async () => {
    delete process.env.SZKRABOK_SESSIONS_DIR;
    await rm(tmpDir, { recursive: true });
  });
});
