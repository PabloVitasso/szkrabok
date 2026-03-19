/**
 * PC-5 — MCP tool unit tests
 *
 * Tests: session_manage open/close/list/deleteSession with isClone logic.
 * Uses _launchImpl seam for open (isClone:true) to avoid browser launch.
 * Uses real pool + temp sessions dir for routing and list tests.
 *
 * Run: node --test tests/node/runtime/pc-layer5.test.js
 */

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let sessionsDir;

before(async () => {
  sessionsDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc5-sessions-'));
  process.env.SZKRABOK_SESSIONS_DIR = sessionsDir;
  // open() → launch() → getConfig() requires prior initConfig().
  const { initConfig } = await import('../../../packages/runtime/config.js');
  await initConfig([]);
});

after(async () => {
  delete process.env.SZKRABOK_SESSIONS_DIR;
  await rm(sessionsDir, { recursive: true, force: true });
});

afterEach(async () => {
  const pool = await import('../../../packages/runtime/pool.js');
  for (const e of pool.list()) {
    if (e.id.includes('-pc5-')) pool.remove(e.id);
  }
});

let _seq = 0;
const uid = prefix => `${prefix}-pc5-${++_seq}`;

const makePage = () => ({ isClosed: () => false, url: () => 'about:blank' });

const makeCtx = () => {
  const page = makePage();
  return {
    _closed:       false,
    close:         async () => {},
    storageState:  async () => ({ cookies: [], origins: [] }),
    browser:       () => ({}),
    pages:         () => [page],
    newPage:       async () => page,
    addCookies:    async () => {},
    addInitScript: async () => {},
    on:            () => {},
  };
};

const makeLaunchImpl = (port = 19999) => async (userDataDir) => {
  await writeFile(join(userDataDir, 'DevToolsActivePort'), `${port}\n/devtools/browser/mock\n`);
  return makeCtx();
};

const makeTemplateDir = async name => {
  const dir = join(sessionsDir, name, 'profile');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'Preferences'), '{}');
  return dir;
};

// ── PC-5.1–PC-5.3  open response shape (isClone: true) ───────────────────────

describe('PC-5 session_manage open — isClone:true response shape', () => {
  test('PC-5.1: response includes isClone:true', async () => {
    const { open } = await import('../../../src/tools/szkrabok_session.js');
    const sessionName = uid('open-shape');
    await makeTemplateDir(sessionName);

    const result = await open({
      sessionName,
      launchOptions: { isClone: true, _launchImpl: makeLaunchImpl(20001) },
    });

    try {
      assert.strictEqual(result.isClone, true);
    } finally {
      const pool = await import('../../../packages/runtime/pool.js');
      if (pool.has(result.sessionName)) pool.remove(result.sessionName);
    }
  });

  test('PC-5.2: response sessionName is the generated cloneId, not the template name', async () => {
    const { open } = await import('../../../src/tools/szkrabok_session.js');
    const sessionName = uid('open-id');
    await makeTemplateDir(sessionName);

    const result = await open({
      sessionName,
      launchOptions: { isClone: true, _launchImpl: makeLaunchImpl(20002) },
    });

    try {
      assert.notStrictEqual(result.sessionName, sessionName, 'sessionName in response must be cloneId');
      assert.ok(result.sessionName.startsWith(sessionName), 'cloneId should start with template name');
    } finally {
      const pool = await import('../../../packages/runtime/pool.js');
      if (pool.has(result.sessionName)) pool.remove(result.sessionName);
    }
  });

  test('PC-5.3: response includes templateSession equal to original sessionName', async () => {
    const { open } = await import('../../../src/tools/szkrabok_session.js');
    const sessionName = uid('open-template');
    await makeTemplateDir(sessionName);

    const result = await open({
      sessionName,
      launchOptions: { isClone: true, _launchImpl: makeLaunchImpl(20003) },
    });

    try {
      assert.strictEqual(result.templateSession, sessionName);
    } finally {
      const pool = await import('../../../packages/runtime/pool.js');
      if (pool.has(result.sessionName)) pool.remove(result.sessionName);
    }
  });
});

// ── PC-5.4  open guard ────────────────────────────────────────────────────────

describe('PC-5 session_manage open — isClone:true guard', () => {
  test('PC-5.4: throws when template session is currently open', async () => {
    const { open } = await import('../../../src/tools/szkrabok_session.js');
    const pool      = await import('../../../packages/runtime/pool.js');
    const sessionName = uid('open-guard');

    // Simulate template session being open by adding it to the pool.
    pool.add(sessionName, makeCtx(), makePage(), 20010, 'default', 'Default', false, null);

    await assert.rejects(
      () => open({ sessionName, launchOptions: { isClone: true } }),
      /open|clone/i,
      'must throw when template is in pool'
    );
  });
});

// ── PC-5.5–PC-5.6  open with isClone:false / omitted ─────────────────────────

describe('PC-5 session_manage open — isClone default', () => {
  test('PC-5.5: isClone:false in launchOptions → response has isClone:false', async () => {
    const { open } = await import('../../../src/tools/szkrabok_session.js');
    const sessionName = uid('open-false');
    await makeTemplateDir(sessionName);
    const storage = await import('../../../packages/runtime/storage.js');
    await storage.saveMeta(sessionName, { sessionName, created: Date.now() });

    const result = await open({
      sessionName,
      launchOptions: { isClone: false, _launchImpl: makeLaunchImpl(20011) },
    });

    try {
      assert.strictEqual(result.isClone, false);
    } finally {
      const pool = await import('../../../packages/runtime/pool.js');
      if (pool.has(result.sessionName)) pool.remove(result.sessionName);
    }
  });

  test('PC-5.6: isClone omitted from launchOptions → response has isClone:false', async () => {
    const { open } = await import('../../../src/tools/szkrabok_session.js');
    const sessionName = uid('open-omit');
    await makeTemplateDir(sessionName);
    const storage = await import('../../../packages/runtime/storage.js');
    await storage.saveMeta(sessionName, { sessionName, created: Date.now() });

    const result = await open({
      sessionName,
      launchOptions: { _launchImpl: makeLaunchImpl(20012) },
    });

    try {
      assert.strictEqual(result.isClone, false);
    } finally {
      const pool = await import('../../../packages/runtime/pool.js');
      if (pool.has(result.sessionName)) pool.remove(result.sessionName);
    }
  });
});

// ── PC-5.7–PC-5.8  close routing ─────────────────────────────────────────────

describe('PC-5 session_manage close — routing', () => {
  test('PC-5.7: close with clone sessionName routes to destroyClone (dir deleted)', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { close }     = await import('../../../src/tools/szkrabok_session.js');

    const cloneId  = uid('close-clone');
    const cloneDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc5-clonedir-'));

    pool.add(cloneId, makeCtx(), makePage(), 20020, 'default', 'Default', true, cloneDir);

    await close({ sessionName: cloneId });

    assert.ok(!pool.has(cloneId), 'clone must be removed from pool');
    assert.ok(!existsSync(cloneDir), 'cloneDir must be deleted');
  });

  test('PC-5.8: close with template sessionName routes to closeSession (state saved)', async () => {
    const pool          = await import('../../../packages/runtime/pool.js');
    const { close }     = await import('../../../src/tools/szkrabok_session.js');
    const storage       = await import('../../../packages/runtime/storage.js');

    const sessionName = uid('close-template');
    await mkdir(join(sessionsDir, sessionName, 'profile'), { recursive: true });
    await storage.saveMeta(sessionName, { sessionName, created: Date.now() });

    pool.add(sessionName, makeCtx(), makePage(), 20021, 'default', 'Default', false, null);

    await close({ sessionName });

    const stateFile = join(sessionsDir, sessionName, 'state.json');
    assert.ok(existsSync(stateFile), 'closeSession must write state.json for template');
  });
});

// ── PC-5.9–PC-5.11  list ─────────────────────────────────────────────────────

describe('PC-5 session_manage list', () => {
  test('PC-5.9: list includes active clone with isClone:true and templateSession', async () => {
    const pool       = await import('../../../packages/runtime/pool.js');
    const { list }   = await import('../../../src/tools/szkrabok_session.js');

    const cloneId       = uid('list-clone');
    const templateName  = uid('list-template-src');

    pool.add(cloneId, makeCtx(), makePage(), 20030, 'default', 'Default', true, '/tmp/clone', templateName);

    const { sessions } = await list();
    const entry = sessions.find(s => s.id === cloneId);

    assert.ok(entry, 'clone must appear in list');
    assert.strictEqual(entry.isClone, true);
    assert.strictEqual(entry.active, true);
    assert.strictEqual(entry.templateSession, templateName);
  });

  test('PC-5.10: clone id does not appear in listStoredSessions (no disk entry)', async () => {
    const { listStoredSessions } = await import('../../../packages/runtime/sessions.js');
    const pool                   = await import('../../../packages/runtime/pool.js');

    const cloneId = uid('list-no-disk');
    pool.add(cloneId, makeCtx(), makePage(), 20031, 'default', 'Default', true, '/tmp/no-disk', 'some-template');

    const stored = await listStoredSessions();
    assert.ok(!stored.includes(cloneId), 'clone id must not appear in stored sessions list');
  });

  test('PC-5.11: list returns both template (isClone:false) and clone (isClone:true) entries', async () => {
    const pool        = await import('../../../packages/runtime/pool.js');
    const storage     = await import('../../../packages/runtime/storage.js');
    const { list }    = await import('../../../src/tools/szkrabok_session.js');

    const templateName = uid('list-mixed-t');
    const cloneId      = uid('list-mixed-c');

    // Stored template.
    await mkdir(join(sessionsDir, templateName, 'profile'), { recursive: true });
    await storage.saveMeta(templateName, { sessionName: templateName, created: Date.now() });
    pool.add(templateName, makeCtx(), makePage(), 20032, 'default', 'Default', false, null);

    // Active clone (not on disk).
    pool.add(cloneId, makeCtx(), makePage(), 20033, 'default', 'Default', true, '/tmp/mixed-clone', templateName);

    const { sessions } = await list();
    const t = sessions.find(s => s.id === templateName);
    const c = sessions.find(s => s.id === cloneId);

    assert.ok(t, 'template entry must appear');
    assert.ok(c, 'clone entry must appear');
    assert.strictEqual(t.isClone, false);
    assert.strictEqual(c.isClone, true);
  });
});

// ── PC-5.12  deleteSession guard ──────────────────────────────────────────────

describe('PC-5 session_manage deleteSession — clone guard', () => {
  test('PC-5.12: deleteSession with a clone sessionName throws (use close instead)', async () => {
    const pool              = await import('../../../packages/runtime/pool.js');
    const { deleteSession } = await import('../../../src/tools/szkrabok_session.js');

    const cloneId = uid('delete-guard');
    pool.add(cloneId, makeCtx(), makePage(), 20040, 'default', 'Default', true, '/tmp/del-guard', 'some-template');

    await assert.rejects(
      () => deleteSession({ sessionName: cloneId }),
      /clone|close/i,
      'deleteSession must refuse to delete a clone — use close'
    );
  });
});
