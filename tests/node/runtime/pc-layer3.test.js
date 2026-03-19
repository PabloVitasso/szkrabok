/**
 * PC-3 — sessions unit tests
 *
 * Tests: destroyClone — teardown, dir removal, no-persistence guards, type guard.
 * Tests: closeSession (template path) — unchanged behaviour.
 *
 * Uses real pool and real temp dirs. No browser launched.
 *
 * Run: node --test tests/node/runtime/pc-layer3.test.js
 */

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let sessionsDir;

// Isolate storage writes to a temp sessions dir.
before(async () => {
  sessionsDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-sessions-'));
  process.env.SZKRABOK_SESSIONS_DIR = sessionsDir;
});

after(async () => {
  delete process.env.SZKRABOK_SESSIONS_DIR;
  await rm(sessionsDir, { recursive: true, force: true });
});

// Pool cleanup between tests.
afterEach(async () => {
  const pool = await import('../../../packages/runtime/pool.js');
  for (const e of pool.list()) {
    if (e.id.includes('-pc3-')) pool.remove(e.id);
  }
});

let _seq = 0;
const uid = prefix => `${prefix}-pc3-${++_seq}`;

// Build a minimal pool entry that pool.get() accepts (checks _closed / isClosed).
const makeEntry = (overrides = {}) => {
  let closed = false;
  const closedFns = [];
  return {
    context: {
      _closed: false,
      close:        async () => { closed = true; },
      storageState: async () => ({ cookies: [], origins: [] }),
      browser:      () => ({}),
      pages:        () => [],
      on:           (event, fn) => { if (event === 'close') closedFns.push(fn); },
    },
    page: { isClosed: () => false, url: () => 'about:blank' },
    cdpPort: 9000,
    preset: 'default',
    label: 'Default',
    ...overrides,
  };
};

// ── PC-3.1–PC-3.5  destroyClone happy path ───────────────────────────────────

describe('PC-3 destroyClone — happy path', () => {
  test('PC-3.1: context.close() is called', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id       = uid('destroy-close');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-clonedir-'));
    let closeCalled = false;

    const entry = makeEntry();
    entry.context.close = async () => { closeCalled = true; };

    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label, true, cloneDir);

    await destroyClone(id);

    assert.ok(closeCalled, 'context.close() must be called');
  });

  test('PC-3.2: pool entry is removed after destroy', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id       = uid('destroy-pool');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-clonedir-'));
    const entry    = makeEntry();

    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label, true, cloneDir);
    assert.ok(pool.has(id));

    await destroyClone(id);

    assert.ok(!pool.has(id), 'pool entry must be removed after destroyClone');
  });

  test('PC-3.3: cloneDir is deleted from filesystem', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id       = uid('destroy-dir');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-rmtest-'));

    // Confirm it exists before.
    assert.ok(existsSync(cloneDir));

    const entry = makeEntry();
    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label, true, cloneDir);

    await destroyClone(id);

    assert.ok(!existsSync(cloneDir), 'cloneDir must be deleted after destroyClone');
  });

  test('PC-3.4: saveState is NOT called (no state.json created in sessions dir)', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id       = uid('destroy-nostate');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-nostate-'));
    const entry    = makeEntry();

    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label, true, cloneDir);

    await destroyClone(id);

    // saveState would write to sessions/{id}/state.json — must not exist.
    const stateFile = join(sessionsDir, id, 'state.json');
    assert.ok(!existsSync(stateFile), 'state.json must NOT be created for a clone');
  });

  test('PC-3.5: updateMeta is NOT called (no meta.json created in sessions dir)', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id       = uid('destroy-nometa');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-nometa-'));
    const entry    = makeEntry();

    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label, true, cloneDir);

    await destroyClone(id);

    const metaFile = join(sessionsDir, id, 'meta.json');
    assert.ok(!existsSync(metaFile), 'meta.json must NOT be created for a clone');
  });
});

// ── PC-3.6–PC-3.7  destroyClone guard paths ──────────────────────────────────

describe('PC-3 destroyClone — guard paths', () => {
  test('PC-3.6: throws when called with a template session id (isClone: false)', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id    = uid('destroy-wrong-type');
    const entry = makeEntry();

    // Add as template (isClone: false — the default).
    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label);

    await assert.rejects(
      () => destroyClone(id),
      /template|closeSession/i,
      'destroyClone must refuse to act on a template session'
    );
  });

  test('PC-3.7: throws SessionNotFoundError for unknown id', async () => {
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');
    await assert.rejects(
      () => destroyClone('this-id-does-not-exist-pc3'),
      /Session not found/i
    );
  });
});

// ── PC-3.8  closeSession unchanged ───────────────────────────────────────────

describe('PC-3 closeSession — template path unchanged', () => {
  test('PC-3.8: closeSession saves state to sessions dir when isClone: false', async () => {
    const pool             = await import('../../../packages/runtime/pool.js');
    const { closeSession } = await import('../../../packages/runtime/sessions.js');
    const storage          = await import('../../../packages/runtime/storage.js');

    const id    = uid('close-template');
    const entry = makeEntry();

    // Create the session dir so saveMeta/saveState can write.
    await mkdir(join(sessionsDir, id, 'profile'), { recursive: true });
    await storage.saveMeta(id, { sessionName: id, created: Date.now() });

    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label);

    await closeSession(id);

    const stateFile = join(sessionsDir, id, 'state.json');
    assert.ok(existsSync(stateFile), 'closeSession must write state.json for template sessions');
  });
});
