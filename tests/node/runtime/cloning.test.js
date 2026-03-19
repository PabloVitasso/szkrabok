/**
 * Cloning unit tests — readDevToolsPort, cloneProfileAtomic, cleanupLeases, newLeaseId
 *
 * No browser launched. All tests use temp directories.
 *
 * Run: node --test tests/node/runtime/cloning.test.js
 *
 * NOTE: these tests require the proposed storage.js additions to be implemented:
 *   readDevToolsPort, cloneProfileAtomic, cleanupLeases, newLeaseId
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

// Spawn a process that exits immediately — gives us a guaranteed dead PID.
const deadPid = spawnSync(process.execPath, ['--eval', '']).pid;

// ── readDevToolsPort ──────────────────────────────────────────────────────────

describe('readDevToolsPort', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'szkrabok-cloning-test-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('parses standard format "{port}\\n/devtools/browser/..."', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), '54321\n/devtools/browser/abc123\n');
    const port = await readDevToolsPort(tmpDir);
    assert.strictEqual(port, 54321);
  });

  test('parses port-only content (no path line)', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), '12345');
    const port = await readDevToolsPort(tmpDir);
    assert.strictEqual(port, 12345);
  });

  test('returns a number, not a string', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), '9222\n/devtools/browser/x\n');
    const port = await readDevToolsPort(tmpDir);
    assert.strictEqual(typeof port, 'number');
  });

  test('throws when file is absent', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    const emptyDir = await mkdtemp(join(tmpdir(), 'szkrabok-no-port-'));
    try {
      await assert.rejects(() => readDevToolsPort(emptyDir));
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

// ── newLeaseId ────────────────────────────────────────────────────────────────

describe('newLeaseId', () => {
  test('returns a non-empty string', async () => {
    const { newLeaseId } = await import('../../../packages/runtime/storage.js');
    const id = newLeaseId();
    assert.strictEqual(typeof id, 'string');
    assert.ok(id.length > 0);
  });

  test('starts with a timestamp segment', async () => {
    const { newLeaseId } = await import('../../../packages/runtime/storage.js');
    const before = Date.now();
    const id = newLeaseId();
    const after = Date.now();
    const ts = parseInt(id.split('-')[0], 10);
    assert.ok(ts >= before && ts <= after, `timestamp ${ts} not in [${before}, ${after}]`);
  });

  test('two consecutive calls produce different ids', async () => {
    const { newLeaseId } = await import('../../../packages/runtime/storage.js');
    const a = newLeaseId();
    const b = newLeaseId();
    assert.notStrictEqual(a, b);
  });
});

// ── cloneProfileAtomic ────────────────────────────────────────────────────────

describe('cloneProfileAtomic', () => {
  let srcDir;

  before(async () => {
    srcDir = await mkdtemp(join(tmpdir(), 'szkrabok-clone-src-'));

    // Populate a minimal fake profile structure
    await writeFile(join(srcDir, 'Cookies'), 'sqlite-magic');
    await writeFile(join(srcDir, 'Preferences'), '{}');
    await writeFile(join(srcDir, 'SingletonLock'), 'locked');
    await mkdir(join(srcDir, 'GPUCache'), { recursive: true });
    await writeFile(join(srcDir, 'GPUCache', 'data_0'), 'gpu-junk');
    await mkdir(join(srcDir, 'Local Storage'), { recursive: true });
    await writeFile(join(srcDir, 'Local Storage', 'leveldb.ldb'), 'storage-data');
  });

  after(async () => {
    await rm(srcDir, { recursive: true, force: true });
  });

  test('returns leaseId and dir', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const lease = await cloneProfileAtomic(srcDir);

    try {
      assert.ok(typeof lease.leaseId === 'string');
      assert.ok(typeof lease.dir === 'string');
    } finally {
      await rm(lease.dir, { recursive: true, force: true });
    }
  });

  test('dest dir exists and contains copied files', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const lease = await cloneProfileAtomic(srcDir);

    try {
      const cookies = await readFile(join(lease.dir, 'Cookies'), 'utf8');
      assert.strictEqual(cookies, 'sqlite-magic');

      const prefs = await readFile(join(lease.dir, 'Preferences'), 'utf8');
      assert.strictEqual(prefs, '{}');
    } finally {
      await rm(lease.dir, { recursive: true, force: true });
    }
  });

  test('skips SingletonLock', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const lease = await cloneProfileAtomic(srcDir);

    try {
      const { existsSync } = await import('fs');
      assert.ok(!existsSync(join(lease.dir, 'SingletonLock')), 'SingletonLock must not be copied');
    } finally {
      await rm(lease.dir, { recursive: true, force: true });
    }
  });

  test('skips GPUCache directory', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const lease = await cloneProfileAtomic(srcDir);

    try {
      const { existsSync } = await import('fs');
      assert.ok(!existsSync(join(lease.dir, 'GPUCache')), 'GPUCache must not be copied');
    } finally {
      await rm(lease.dir, { recursive: true, force: true });
    }
  });

  test('copies subdirectories that are not in skip list', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const lease = await cloneProfileAtomic(srcDir);

    try {
      const ldb = await readFile(join(lease.dir, 'Local Storage', 'leveldb.ldb'), 'utf8');
      assert.strictEqual(ldb, 'storage-data');
    } finally {
      await rm(lease.dir, { recursive: true, force: true });
    }
  });

  test('writes .lease file with pid and created', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const before = Date.now();
    const lease = await cloneProfileAtomic(srcDir);
    const after = Date.now();

    try {
      const meta = JSON.parse(await readFile(join(lease.dir, '.lease'), 'utf8'));
      assert.strictEqual(meta.pid, process.pid);
      assert.ok(meta.created >= before && meta.created <= after);
    } finally {
      await rm(lease.dir, { recursive: true, force: true });
    }
  });

  test('two concurrent clones produce separate dirs', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const [a, b] = await Promise.all([
      cloneProfileAtomic(srcDir),
      cloneProfileAtomic(srcDir),
    ]);

    try {
      assert.notStrictEqual(a.dir, b.dir);
      assert.notStrictEqual(a.leaseId, b.leaseId);
    } finally {
      await Promise.allSettled([
        rm(a.dir, { recursive: true, force: true }),
        rm(b.dir, { recursive: true, force: true }),
      ]);
    }
  });
});

// ── cleanupLeases ─────────────────────────────────────────────────────────────

describe('cleanupLeases', () => {
  // Create a lease dir in tmpdir() directly (where cleanupLeases scans).
  const makeLeaseDir = async meta => {
    const dir = join(tmpdir(), `szkrabok-lease-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '.lease'), JSON.stringify(meta));
    return dir;
  };

  test('deletes expired dir with dead PID', async () => {
    const { cleanupLeases } = await import('../../../packages/runtime/storage.js');

    const dir = await makeLeaseDir({ pid: deadPid, created: 0 }); // epoch = always expired
    await cleanupLeases();

    const { existsSync } = await import('fs');
    assert.ok(!existsSync(dir), 'expired dead-PID lease should be deleted');
  });

  test('keeps dir with live PID regardless of age', async () => {
    const { cleanupLeases } = await import('../../../packages/runtime/storage.js');

    const dir = await makeLeaseDir({ pid: process.pid, created: 0 }); // expired age, but PID alive

    try {
      await cleanupLeases();

      const { existsSync } = await import('fs');
      assert.ok(existsSync(dir), 'live-PID lease must not be deleted even if old');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('keeps dir with dead PID that is within TTL', async () => {
    const { cleanupLeases } = await import('../../../packages/runtime/storage.js');

    const dir = await makeLeaseDir({ pid: deadPid, created: Date.now() }); // just created

    try {
      await cleanupLeases();

      const { existsSync } = await import('fs');
      assert.ok(existsSync(dir), 'recently-created lease must not be deleted even if PID is dead');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('deletes orphaned dir with no .lease file', async () => {
    const { cleanupLeases } = await import('../../../packages/runtime/storage.js');

    const dir = join(tmpdir(), `szkrabok-lease-${Date.now()}-orphan`);
    await mkdir(dir, { recursive: true });
    // No .lease written — orphaned

    await cleanupLeases();

    const { existsSync } = await import('fs');
    assert.ok(!existsSync(dir), 'orphaned lease dir (no .lease) should be deleted');
  });
});
