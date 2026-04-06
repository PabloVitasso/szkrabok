/**
 * PC-3 - sessions unit tests
 *
 * Tests: destroyClone - teardown, dir removal, no-persistence guards, type guard.
 * Tests: closeSession (template path) - unchanged behaviour.
 *
 * Uses real pool and real temp dirs. No browser launched.
 *
 * Run: node --test tests/node/runtime/pc-layer3.test.js
 */

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'fs/promises';
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
  const closedFns = [];
  return {
    context: {
      _closed: false,
      close:        async () => { /* noop */ },
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

// ── PC-3.1-PC-3.5  destroyClone happy path ───────────────────────────────────

describe('PC-3 destroyClone — happy path', () => {
  test('PC-3.1: context.close() is called', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id       = uid('destroy-close');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-clonedir-'));
    let closeCalled = false;

    console.log('PC-3.1 step 1: makeEntry with mocked close()');
    const entry = makeEntry();
    entry.context.close = async () => { closeCalled = true; };
    console.log('PC-3.1 step 2: pool.add("' + id + '", isClone=true, cloneDir="' + cloneDir + '")');
    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label, true, cloneDir);

    console.log('PC-3.1 step 3: destroyClone("' + id + '")');
    await destroyClone(id);
    console.log('PC-3.1 step 3 returned. closeCalled:', closeCalled);
    assert.ok(closeCalled, 'context.close() must be called');
  });

  test('PC-3.2: pool entry is removed after destroy', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id       = uid('destroy-pool');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-clonedir-'));
    const entry    = makeEntry();

    console.log('PC-3.2 step 1: pool.add("' + id + '")');
    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label, true, cloneDir);
    console.log('PC-3.2 step 2: pool.has("' + id + '") =', pool.has(id));
    assert.ok(pool.has(id));

    console.log('PC-3.2 step 3: destroyClone("' + id + '")');
    await destroyClone(id);
    console.log('PC-3.2 step 4: pool.has("' + id + '") =', pool.has(id));
    assert.ok(!pool.has(id), 'pool entry must be removed after destroyClone');
  });

  test('PC-3.3: cloneDir is deleted from filesystem', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id       = uid('destroy-dir');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-rmtest-'));

    console.log('PC-3.3 step 1: confirm dir exists:', cloneDir);
    const before = existsSync(cloneDir);
    console.log('PC-3.3 step 1 exists:', before);
    assert.ok(before);

    console.log('PC-3.3 step 2: pool.add("' + id + '")');
    const entry = makeEntry();
    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label, true, cloneDir);

    console.log('PC-3.3 step 3: destroyClone("' + id + '")');
    await destroyClone(id);
    console.log('PC-3.3 step 4: existsSync("' + cloneDir + '") =', existsSync(cloneDir));
    assert.ok(!existsSync(cloneDir), 'cloneDir must be deleted after destroyClone');
  });

  test('PC-3.4: saveState is NOT called (no state.json created in sessions dir)', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id       = uid('destroy-nostate');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-nostate-'));
    const entry    = makeEntry();

    console.log('PC-3.4 step 1: pool.add("' + id + '", isClone=true)');
    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label, true, cloneDir);

    console.log('PC-3.4 step 2: destroyClone("' + id + '")');
    await destroyClone(id);

    const stateFile = join(sessionsDir, id, 'state.json');
    console.log('PC-3.4 step 3: existsSync("' + stateFile + '") =', existsSync(stateFile));
    assert.ok(!existsSync(stateFile), 'state.json must NOT be created for a clone');
  });

  test('PC-3.5: updateMeta is NOT called (no meta.json created in sessions dir)', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id       = uid('destroy-nometa');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc3-nometa-'));
    const entry    = makeEntry();

    console.log('PC-3.5 step 1: pool.add("' + id + '", isClone=true)');
    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label, true, cloneDir);

    console.log('PC-3.5 step 2: destroyClone("' + id + '")');
    await destroyClone(id);

    const metaFile = join(sessionsDir, id, 'meta.json');
    console.log('PC-3.5 step 3: existsSync("' + metaFile + '") =', existsSync(metaFile));
    assert.ok(!existsSync(metaFile), 'meta.json must NOT be created for a clone');
  });
});

// ── PC-3.6-PC-3.7  destroyClone guard paths ──────────────────────────────────

describe('PC-3 destroyClone — guard paths', () => {
  test('PC-3.6: throws when called with a template session id (isClone: false)', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');

    const id    = uid('destroy-wrong-type');
    const entry = makeEntry();

    console.log('PC-3.6 step 1: pool.add("' + id + '", isClone=false — default)');
    // Add as template (isClone: false - the default).
    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label);

    console.log('PC-3.6 step 2: destroyClone("' + id + '") (expect rejection)');
    await assert.rejects(
      () => destroyClone(id),
      /template|closeSession/i,
      'destroyClone must refuse to act on a template session'
    );
    console.log('PC-3.6 step 2: correctly rejected');
  });

  test('PC-3.7: throws SessionNotFoundError for unknown id', async () => {
    const { destroyClone } = await import('../../../packages/runtime/sessions.js');
    const unknown = 'this-id-does-not-exist-pc3';
    console.log('PC-3.7 step 1: destroyClone("' + unknown + '") (expect rejection)');
    await assert.rejects(
      () => destroyClone(unknown),
      /Session not found/i
    );
    console.log('PC-3.7 step 1: correctly rejected');
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

    console.log('PC-3.8 step 1: mkdir sessions/"' + id + '/profile"');
    await mkdir(join(sessionsDir, id, 'profile'), { recursive: true });
    console.log('PC-3.8 step 2: storage.saveMeta("' + id + '")');
    await storage.saveMeta(id, { sessionName: id, created: Date.now() });

    console.log('PC-3.8 step 3: pool.add("' + id + '", isClone=false)');
    pool.add(id, entry.context, entry.page, entry.cdpPort, entry.preset, entry.label);

    console.log('PC-3.8 step 4: closeSession("' + id + '")');
    await closeSession(id);

    const stateFile = join(sessionsDir, id, 'state.json');
    console.log('PC-3.8 step 5: existsSync("' + stateFile + '") =', existsSync(stateFile));
    assert.ok(existsSync(stateFile), 'closeSession must write state.json for template sessions');
  });
});
