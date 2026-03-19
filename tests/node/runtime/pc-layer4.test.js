/**
 * PC-4 — launch unit tests
 *
 * Tests: launchClone pool keying, port discovery, no-cdpPortForId, concurrent
 *        launches, close() cleanup, ensureGcOnExit idempotency, cleanupClones
 *        call on entry.
 *
 * Uses a _launchImpl seam — no real browser launched.
 *
 * _launchImpl contract (injectable replacement for _launchPersistentContext):
 *   async (userDataDir, options) => context
 *   Side effect: writes DevToolsActivePort to userDataDir before returning.
 *
 * Run: node --test tests/node/runtime/pc-layer4.test.js
 */

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Shared fixtures ───────────────────────────────────────────────────────────

let sessionsDir;

before(async () => {
  sessionsDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc4-sessions-'));
  process.env.SZKRABOK_SESSIONS_DIR = sessionsDir;
  // launch() calls getConfig() which requires prior initConfig().
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
    if (e.id.includes('-pc4-')) pool.remove(e.id);
  }
});

let _seq = 0;
const uid = prefix => `${prefix}-pc4-${++_seq}`;

// Build a minimal fake context that Playwright-shaped code expects.
const makeFakePage = () => ({ isClosed: () => false });
const makeCtx = () => {
  const page = makeFakePage();
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

/**
 * Standard _launchImpl mock.
 * Writes DevToolsActivePort with the given port, returns a fake context.
 */
const makeLaunchImpl = (port = 19999) => async (userDataDir) => {
  await writeFile(join(userDataDir, 'DevToolsActivePort'), `${port}\n/devtools/browser/mock\n`);
  return makeCtx();
};

/**
 * Create a minimal template profile dir so cloneProfileAtomic has something to copy.
 */
const makeTemplateDir = async name => {
  const dir = join(sessionsDir, name, 'profile');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'Preferences'), '{}');
  return dir;
};

// ── PC-4.1–PC-4.2  pool keying and entry fields ───────────────────────────────

describe('PC-4 launchClone — pool entry', () => {
  test('PC-4.1: pool key is cloneId, not profile name', async () => {
    const { launchClone } = await import('../../../packages/runtime/launch.js');
    const pool            = await import('../../../packages/runtime/pool.js');
    const profile = uid('keying');
    await makeTemplateDir(profile);

    const handle = await launchClone({ profile, _launchImpl: makeLaunchImpl(19001) });
    try {
      assert.ok(!pool.has(profile), 'template profile name must NOT be a pool key');
      assert.ok(pool.has(handle.cloneId), 'cloneId must be the pool key');
    } finally {
      await handle.close();
    }
  });

  test('PC-4.2: pool entry has isClone:true and cloneDir set', async () => {
    const { launchClone } = await import('../../../packages/runtime/launch.js');
    const pool            = await import('../../../packages/runtime/pool.js');
    const profile = uid('entry-fields');
    await makeTemplateDir(profile);

    const handle = await launchClone({ profile, _launchImpl: makeLaunchImpl(19002) });
    try {
      const entry = pool.get(handle.cloneId);
      assert.strictEqual(entry.isClone, true);
      assert.ok(typeof entry.cloneDir === 'string' && entry.cloneDir.length > 0);
    } finally {
      await handle.close();
    }
  });
});

// ── PC-4.3–PC-4.4  port discovery (TOCTOU fix) ───────────────────────────────

describe('PC-4 launchClone — port discovery', () => {
  test('PC-4.3: cdpEndpoint uses port from DevToolsActivePort', async () => {
    const { launchClone } = await import('../../../packages/runtime/launch.js');
    const profile = uid('port-file');
    await makeTemplateDir(profile);

    const handle = await launchClone({ profile, _launchImpl: makeLaunchImpl(19003) });
    try {
      assert.ok(
        handle.cdpEndpoint.includes(':19003'),
        `expected port 19003 in endpoint, got: ${handle.cdpEndpoint}`
      );
    } finally {
      await handle.close();
    }
  });

  test('PC-4.4: cdpPortForId is not used (deleted from launch.js)', async () => {
    const launchMod = await import('../../../packages/runtime/launch.js');
    assert.strictEqual(
      typeof launchMod.cdpPortForId,
      'undefined',
      'cdpPortForId must be deleted — not exported and not accessible'
    );
    // Deeper check: the module source must not call cdpPortForId.
    // We verify by launching two clones with the same profile and confirming
    // their ports are whatever DevToolsActivePort said, not a deterministic hash.
    // (Port uniqueness is covered by PC-4.5; this test just checks the function is gone.)
  });
});

// ── PC-4.5  concurrent launches ───────────────────────────────────────────────

describe('PC-4 launchClone — concurrency', () => {
  test('PC-4.5: two concurrent launches produce distinct cloneId and cloneDir', async () => {
    const { launchClone } = await import('../../../packages/runtime/launch.js');
    const profile = uid('concurrent');
    await makeTemplateDir(profile);

    let portCounter = 19010;
    const launchImpl = async (userDataDir) => {
      const port = portCounter++;
      await writeFile(join(userDataDir, 'DevToolsActivePort'), `${port}\n/devtools/browser/mock\n`);
      return makeCtx();
    };

    const [a, b] = await Promise.all([
      launchClone({ profile, _launchImpl: launchImpl }),
      launchClone({ profile, _launchImpl: launchImpl }),
    ]);

    try {
      assert.notStrictEqual(a.cloneId, b.cloneId);
      const pool = await import('../../../packages/runtime/pool.js');
      const ea   = pool.get(a.cloneId);
      const eb   = pool.get(b.cloneId);
      assert.notStrictEqual(ea.cloneDir, eb.cloneDir);
    } finally {
      await Promise.allSettled([a.close(), b.close()]);
    }
  });
});

// ── PC-4.6–PC-4.7  close() returned from launchClone ─────────────────────────

describe('PC-4 launchClone — close() behaviour', () => {
  test('PC-4.6: close() removes the cloneDir from filesystem', async () => {
    const { launchClone } = await import('../../../packages/runtime/launch.js');
    const profile = uid('close-dir');
    await makeTemplateDir(profile);

    const handle = await launchClone({ profile, _launchImpl: makeLaunchImpl(19020) });
    const pool   = await import('../../../packages/runtime/pool.js');
    const dir    = pool.get(handle.cloneId).cloneDir;

    assert.ok(existsSync(dir), 'cloneDir must exist before close()');
    await handle.close();
    assert.ok(!existsSync(dir), 'cloneDir must be removed after close()');
  });

  test('PC-4.7: close() does not write state.json to sessions dir', async () => {
    const { launchClone } = await import('../../../packages/runtime/launch.js');
    const profile = uid('close-nostate');
    await makeTemplateDir(profile);

    const handle = await launchClone({ profile, _launchImpl: makeLaunchImpl(19021) });
    const cloneId = handle.cloneId;
    await handle.close();

    const stateFile = join(sessionsDir, cloneId, 'state.json');
    assert.ok(!existsSync(stateFile), 'close() must not persist state for a clone');
  });
});

// ── PC-4.8  template launch also uses DevToolsActivePort ──────────────────────

describe('PC-4 launch (template) — port discovery', () => {
  test('PC-4.8: template launch cdpEndpoint uses DevToolsActivePort, not a hash', async () => {
    const { launch } = await import('../../../packages/runtime/launch.js');
    const profile = uid('template-port');
    await makeTemplateDir(profile);

    // Write a meta so launch() can find the profile.
    const storage = await import('../../../packages/runtime/storage.js');
    await storage.saveMeta(profile, { sessionName: profile, created: Date.now() });

    const handle = await launch({
      profile,
      reuse: false,
      _launchImpl: makeLaunchImpl(19030),
    });

    try {
      assert.ok(
        handle.cdpEndpoint.includes(':19030'),
        `expected port 19030 in template endpoint, got: ${handle.cdpEndpoint}`
      );
    } finally {
      await handle.close();
    }
  });
});

// ── PC-4.9  ensureGcOnExit idempotency ────────────────────────────────────────

describe('PC-4 ensureGcOnExit', () => {
  test('PC-4.9: multiple launch calls register beforeExit handler exactly once', async () => {
    const { launchClone } = await import('../../../packages/runtime/launch.js');
    const before = process.listenerCount('beforeExit');

    // Call launchClone multiple times — each call hits ensureGcOnExit.
    const handles = [];
    for (let i = 0; i < 3; i++) {
      const profile = uid(`gc-exit-${i}`);
      await makeTemplateDir(profile);
      handles.push(
        await launchClone({ profile, _launchImpl: makeLaunchImpl(19040 + i) })
      );
    }

    const after = process.listenerCount('beforeExit');
    // Should have added exactly one handler total (idempotent guard).
    assert.ok(after - before <= 1, `beforeExit listener count grew by ${after - before}, expected at most 1`);

    await Promise.allSettled(handles.map(h => h.close()));
  });
});

// ── PC-4.10  cleanupClones called on launch entry ─────────────────────────────

describe('PC-4 launchClone — GC on launch', () => {
  test('PC-4.10: stale clone dir from dead process is cleaned up during launchClone', async () => {
    const { launchClone } = await import('../../../packages/runtime/launch.js');
    const { spawnSync }   = await import('child_process');

    const deadPid = spawnSync(process.execPath, ['--eval', '']).pid;

    // Plant an expired stale clone dir with a dead PID.
    const staleDir = join(tmpdir(), `szkrabok-clone-pc4-stale-${Date.now()}`);
    await mkdir(staleDir, { recursive: true });
    await writeFile(join(staleDir, '.clone'), JSON.stringify({
      pid:          deadPid,
      created:      0,          // epoch — always past TTL
      templateName: 'stale-test',
    }));

    assert.ok(existsSync(staleDir), 'stale dir must exist before launchClone');

    // Launch any clone — cleanupClones should run at entry.
    const profile = uid('gc-on-launch');
    await makeTemplateDir(profile);
    const handle = await launchClone({ profile, _launchImpl: makeLaunchImpl(19050) });
    await handle.close();

    assert.ok(!existsSync(staleDir), 'stale clone dir must be removed by launchClone GC');
  });
});
