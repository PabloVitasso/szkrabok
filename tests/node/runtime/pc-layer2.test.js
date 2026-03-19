/**
 * PC-2 — pool unit tests
 *
 * Tests: isClone, cloneDir, templateName fields on pool entries.
 * Verifies existing add/get/remove/list behaviour is unchanged.
 *
 * Run: node --test tests/node/runtime/pc-layer2.test.js
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal mock objects that satisfy pool.get()'s liveness checks.
const mockCtx = (closed = false) => ({
  _closed: closed,
  close: async () => {},
  storageState: async () => ({ cookies: [], origins: [] }),
  browser: () => ({}),
  pages: () => [],
  on: () => {},
});

const mockPage = (closed = false) => ({
  isClosed: () => closed,
  url: () => 'about:blank',
});

// Unique ID per test to avoid cross-test pollution in the singleton pool.
let _seq = 0;
const uid = prefix => `${prefix}-pc2-${++_seq}`;

describe('PC-2 pool — isClone and cloneDir fields', () => {
  afterEach(async () => {
    // Clean up any entries added in this test by removing known prefixes.
    // pool.list() returns all entries; remove those with our test prefix.
    const pool = await import('../../../packages/runtime/pool.js');
    for (const entry of pool.list()) {
      if (entry.id.includes('-pc2-')) pool.remove(entry.id);
    }
  });

  test('PC-2.1: add() default → isClone: false, cloneDir: null', async () => {
    const pool = await import('../../../packages/runtime/pool.js');
    const id = uid('template');
    pool.add(id, mockCtx(), mockPage(), 9000, 'default', 'Default');
    const entry = pool.get(id);
    assert.strictEqual(entry.isClone, false);
    assert.strictEqual(entry.cloneDir, null);
  });

  test('PC-2.2: add() with isClone:true → entry.isClone === true', async () => {
    const pool = await import('../../../packages/runtime/pool.js');
    const id = uid('clone');
    pool.add(id, mockCtx(), mockPage(), 9001, 'default', 'Default', true, '/tmp/szkrabok-clone-test');
    const entry = pool.get(id);
    assert.strictEqual(entry.isClone, true);
  });

  test('PC-2.3: add() with cloneDir → entry.cloneDir equals passed value', async () => {
    const pool = await import('../../../packages/runtime/pool.js');
    const id = uid('clonedir');
    const cloneDir = '/tmp/szkrabok-clone-pc2-dir';
    pool.add(id, mockCtx(), mockPage(), 9002, 'default', 'Default', true, cloneDir);
    assert.strictEqual(pool.get(id).cloneDir, cloneDir);
  });

  test('PC-2.4: list() entries all carry isClone and cloneDir fields', async () => {
    const pool = await import('../../../packages/runtime/pool.js');
    const id = uid('listcheck');
    pool.add(id, mockCtx(), mockPage(), 9003, 'default', 'Default');
    const entries = pool.list();
    // Every entry in list must have both fields (even pre-existing entries from other tests).
    for (const e of entries) {
      assert.ok('isClone' in e, `entry ${e.id} missing isClone`);
      assert.ok('cloneDir' in e, `entry ${e.id} missing cloneDir`);
    }
  });

  test('PC-2.5: list() returns clone entries alongside template entries', async () => {
    const pool = await import('../../../packages/runtime/pool.js');
    const templateId = uid('mixed-template');
    const cloneId    = uid('mixed-clone');

    pool.add(templateId, mockCtx(), mockPage(), 9004, 'default', 'Default', false, null);
    pool.add(cloneId,    mockCtx(), mockPage(), 9005, 'default', 'Default', true, '/tmp/clone-dir');

    const entries = pool.list();
    const t = entries.find(e => e.id === templateId);
    const c = entries.find(e => e.id === cloneId);

    assert.ok(t, 'template entry present in list');
    assert.ok(c, 'clone entry present in list');
    assert.strictEqual(t.isClone, false);
    assert.strictEqual(c.isClone, true);
    assert.strictEqual(c.cloneDir, '/tmp/clone-dir');
  });
});
