/**
 * PC-1 — storage unit tests
 *
 * Tests: readDevToolsPort, newCloneId, cloneProfileAtomic, cleanupClones
 * No browser launched. All tests use temp directories.
 *
 * Run: node --test tests/node/runtime/pc-layer1.test.js
 *
 * Replaces: cloning.test.js (scaffolded, old lease naming)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

// Guaranteed dead PID — process exits immediately.
const deadPid = spawnSync(process.execPath, ['--eval', '']).pid;

// ── PC-1.1–PC-1.7  readDevToolsPort ──────────────────────────────────────────

describe('PC-1 readDevToolsPort', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc1-port-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('PC-1.1: parses standard format "{port}\\n/devtools/browser/..."', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), '54321\n/devtools/browser/abc123\n');
    const port = await readDevToolsPort(tmpDir);
    assert.strictEqual(port, 54321);
  });

  test('PC-1.2: parses port-only content (no path line)', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), '12345');
    const port = await readDevToolsPort(tmpDir);
    assert.strictEqual(port, 12345);
  });

  test('PC-1.3: returns a number, not a string', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), '9222\n/devtools/browser/x\n');
    const port = await readDevToolsPort(tmpDir);
    assert.strictEqual(typeof port, 'number');
  });

  test('PC-1.4: file absent → rejects', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    const emptyDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc1-absent-'));
    try {
      await assert.rejects(
        () => readDevToolsPort(emptyDir, { timeoutMs: 300 }),
        'expected rejection when DevToolsActivePort is absent'
      );
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  test('PC-1.5: file appears after 200 ms delay → resolves correctly', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    const dir = await mkdtemp(join(tmpdir(), 'szkrabok-pc1-delayed-'));
    let handle;
    try {
      // Write the file after 200 ms — polling must catch it.
      // Store handle so we can cancel if readDevToolsPort throws before the write.
      handle = setTimeout(() =>
        writeFile(join(dir, 'DevToolsActivePort'), '33333\n/devtools/browser/delayed\n').catch(() => {}),
        200
      );
      const port = await readDevToolsPort(dir, { timeoutMs: 2000 });
      assert.strictEqual(port, 33333);
    } finally {
      clearTimeout(handle);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.6: file never appears within timeoutMs → rejects', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    const dir = await mkdtemp(join(tmpdir(), 'szkrabok-pc1-timeout-'));
    try {
      const start = Date.now();
      await assert.rejects(() => readDevToolsPort(dir, { timeoutMs: 300 }));
      // Should not take dramatically longer than the timeout.
      assert.ok(Date.now() - start < 1500, 'timeout took unexpectedly long');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.7: invalid port content → throws with "invalid port"', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), 'abc\n/devtools/browser/x\n');
    await assert.rejects(
      () => readDevToolsPort(tmpDir),
      /invalid port/i
    );
  });
});

// ── PC-1.8–PC-1.11  newCloneId ────────────────────────────────────────────────

describe('PC-1 newCloneId', () => {
  test('PC-1.8: returns a non-empty string', async () => {
    const { newCloneId } = await import('../../../packages/runtime/storage.js');
    const id = newCloneId('myprofile');
    assert.strictEqual(typeof id, 'string');
    assert.ok(id.length > 0);
  });

  test('PC-1.9: starts with sanitised template name', async () => {
    const { newCloneId } = await import('../../../packages/runtime/storage.js');
    assert.ok(newCloneId('myprofile').startsWith('myprofile-'));
    // Special chars sanitised to hyphens.
    assert.ok(newCloneId('my profile').startsWith('my-profile-'));
    assert.ok(newCloneId('my/profile').startsWith('my-profile-'));
  });

  test('PC-1.10: timestamp segment falls within the call window', async () => {
    const { newCloneId } = await import('../../../packages/runtime/storage.js');
    const before = Date.now();
    const id = newCloneId('ts-test');
    const after = Date.now();
    // Format: "{name}-{timestamp}-{hex}" — timestamp is the second-to-last segment.
    const parts = id.split('-');
    const ts = parseInt(parts[parts.length - 2], 10);
    assert.ok(ts >= before && ts <= after, `timestamp ${ts} not in [${before}, ${after}]`);
  });

  test('PC-1.11: two consecutive calls produce different ids', async () => {
    const { newCloneId } = await import('../../../packages/runtime/storage.js');
    const a = newCloneId('dup-test');
    const b = newCloneId('dup-test');
    assert.notStrictEqual(a, b);
  });
});

// ── PC-1.12–PC-1.18  cloneProfileAtomic ──────────────────────────────────────

// concurrency:1 — prevent cleanupClones describe from running in parallel
// and deleting clone dirs (szkrabok-clone-*) before .clone is written.
describe('PC-1 cloneProfileAtomic', { concurrency: 1 }, () => {
  let srcDir;

  before(async () => {
    srcDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc1-src-'));
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

  test('PC-1.12: returns { cloneId, dir }', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const result = await cloneProfileAtomic(srcDir, 'myprofile');
    try {
      assert.strictEqual(typeof result.cloneId, 'string');
      assert.ok(result.cloneId.length > 0);
      assert.strictEqual(typeof result.dir, 'string');
    } finally {
      await rm(result.dir, { recursive: true, force: true });
    }
  });

  test('PC-1.13: dest dir contains copied profile files', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const { dir } = await cloneProfileAtomic(srcDir, 'myprofile');
    try {
      assert.strictEqual(await readFile(join(dir, 'Cookies'), 'utf8'), 'sqlite-magic');
      assert.strictEqual(await readFile(join(dir, 'Preferences'), 'utf8'), '{}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.14: SingletonLock is not copied', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const { dir } = await cloneProfileAtomic(srcDir, 'myprofile');
    try {
      assert.ok(!existsSync(join(dir, 'SingletonLock')), 'SingletonLock must not be copied');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.15: GPUCache directory is not copied', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const { dir } = await cloneProfileAtomic(srcDir, 'myprofile');
    try {
      assert.ok(!existsSync(join(dir, 'GPUCache')), 'GPUCache must not be copied');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.16: subdirectories not in skip list are copied', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const { dir } = await cloneProfileAtomic(srcDir, 'myprofile');
    try {
      const ldb = await readFile(join(dir, 'Local Storage', 'leveldb.ldb'), 'utf8');
      assert.strictEqual(ldb, 'storage-data');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.17: writes .clone metadata with pid, created, templateName', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const before = Date.now();
    const { dir } = await cloneProfileAtomic(srcDir, 'myprofile');
    const after = Date.now();
    try {
      const meta = JSON.parse(await readFile(join(dir, '.clone'), 'utf8'));
      assert.strictEqual(meta.pid, process.pid);
      assert.ok(meta.created >= before && meta.created <= after);
      assert.strictEqual(meta.templateName, 'myprofile');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.18: two concurrent calls produce separate dirs and ids', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    const [a, b] = await Promise.all([
      cloneProfileAtomic(srcDir, 'myprofile'),
      cloneProfileAtomic(srcDir, 'myprofile'),
    ]);
    try {
      assert.notStrictEqual(a.dir, b.dir);
      assert.notStrictEqual(a.cloneId, b.cloneId);
    } finally {
      await Promise.allSettled([
        rm(a.dir, { recursive: true, force: true }),
        rm(b.dir, { recursive: true, force: true }),
      ]);
    }
  });
});

// ── PC-1.19–PC-1.24  cleanupClones ───────────────────────────────────────────

// concurrency:1 — prevents concurrent cleanupClones() calls within this describe
// from racing against each other's makeCloneDir setup.
describe('PC-1 cleanupClones', { concurrency: 1 }, () => {
  // Atomic staging pattern: write .clone to staging dir first, then rename
  // to szkrabok-clone-pc1-* so the dir is never visible without .clone.
  const makeCloneDir = async meta => {
    const id      = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const staging = join(tmpdir(), `szkrabok-staging-pc1-${id}`);
    const dir     = join(tmpdir(), `szkrabok-clone-pc1-${id}`);
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, '.clone'), JSON.stringify(meta));
    await rename(staging, dir);
    return dir;
  };

  test('PC-1.19: deletes expired dir with dead PID', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    const dir = await makeCloneDir({ pid: deadPid, created: 0, templateName: 'test' });
    await cleanupClones();
    assert.ok(!existsSync(dir), 'expired dead-PID clone should be deleted');
  });

  test('PC-1.20: keeps dir with live PID regardless of age', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    const dir = await makeCloneDir({ pid: process.pid, created: 0, templateName: 'test' });
    try {
      await cleanupClones();
      assert.ok(existsSync(dir), 'live-PID clone must not be deleted even if old');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.21: keeps dir with dead PID that is within TTL', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    const dir = await makeCloneDir({ pid: deadPid, created: Date.now(), templateName: 'test' });
    try {
      await cleanupClones();
      assert.ok(existsSync(dir), 'recently-created clone must not be deleted even if PID is dead');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.22: deletes orphaned dir with no .clone file', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    const dir = join(tmpdir(), `szkrabok-clone-pc1-orphan-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    // No .clone written — orphaned.
    await cleanupClones();
    assert.ok(!existsSync(dir), 'orphaned clone dir should be deleted');
  });

  test('PC-1.23: no szkrabok-clone-* dirs present → runs without error', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    // Just must not throw, regardless of current tmpdir state.
    await assert.doesNotReject(() => cleanupClones());
  });

  test('PC-1.24: non-clone dirs in tmpdir are not touched', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    const dir = join(tmpdir(), `other-tool-pc1-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    try {
      await cleanupClones();
      assert.ok(existsSync(dir), 'non-clone dir must not be deleted');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
