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
import { join } from 'path';
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
    console.log('PC-1.1 step 1: write DevToolsActivePort file');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), '54321\n/devtools/browser/abc123\n');
    console.log('PC-1.1 step 2: call readDevToolsPort');
    const port = await readDevToolsPort(tmpDir);
    console.log('PC-1.1 step 2 returned:', port);
    assert.strictEqual(port, 54321);
  });

  test('PC-1.2: parses port-only content (no path line)', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.2 step 1: write DevToolsActivePort with port only');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), '12345');
    console.log('PC-1.2 step 2: call readDevToolsPort');
    const port = await readDevToolsPort(tmpDir);
    console.log('PC-1.2 step 2 returned:', port);
    assert.strictEqual(port, 12345);
  });

  test('PC-1.3: returns a number, not a string', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.3 step 1: write DevToolsActivePort');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), '9222\n/devtools/browser/x\n');
    console.log('PC-1.3 step 2: call readDevToolsPort');
    const port = await readDevToolsPort(tmpDir);
    console.log('PC-1.3 step 2 returned:', port, 'typeof:', typeof port);
    assert.strictEqual(typeof port, 'number');
  });

  test('PC-1.4: file absent → rejects', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    const emptyDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc1-absent-'));
    try {
      console.log('PC-1.4 step 1: call readDevToolsPort on non-existent file (expect rejection)');
      await assert.rejects(
        () => readDevToolsPort(emptyDir, { timeoutMs: 300 }),
        'expected rejection when DevToolsActivePort is absent'
      );
      console.log('PC-1.4 step 1: correctly rejected');
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  test('PC-1.5: file appears after 200 ms delay → resolves correctly', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    const dir = await mkdtemp(join(tmpdir(), 'szkrabok-pc1-delayed-'));
    let handle;
    try {
      console.log('PC-1.5 step 1: schedule write of DevToolsActivePort in 200ms');
      handle = setTimeout(() =>
        writeFile(join(dir, 'DevToolsActivePort'), '33333\n/devtools/browser/delayed\n').catch(() => {}),
        200
      );
      console.log('PC-1.5 step 2: call readDevToolsPort with 2000ms timeout');
      const port = await readDevToolsPort(dir, { timeoutMs: 2000 });
      console.log('PC-1.5 step 2 returned:', port);
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
      console.log('PC-1.6 step 1: call readDevToolsPort with 300ms timeout on empty dir');
      const start = Date.now();
      await assert.rejects(() => readDevToolsPort(dir, { timeoutMs: 300 }));
      const elapsed = Date.now() - start;
      console.log('PC-1.6 step 1: rejected after', elapsed, 'ms (expected ~300ms)');
      assert.ok(elapsed < 1500, 'timeout took unexpectedly long');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.7: invalid port content → throws with "invalid port"', async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.7 step 1: write invalid content to DevToolsActivePort');
    await writeFile(join(tmpDir, 'DevToolsActivePort'), 'abc\n/devtools/browser/x\n');
    console.log('PC-1.7 step 2: call readDevToolsPort (expect rejection)');
    await assert.rejects(
      () => readDevToolsPort(tmpDir),
      /invalid port/i
    );
    console.log('PC-1.7 step 2: correctly rejected');
  });
});

// ── PC-1.8–PC-1.11  newCloneId ────────────────────────────────────────────────

describe('PC-1 newCloneId', () => {
  test('PC-1.8: returns a non-empty string', async () => {
    const { newCloneId } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.8 step 1: call newCloneId("myprofile")');
    const id = newCloneId('myprofile');
    console.log('PC-1.8 step 1 returned:', id);
    assert.strictEqual(typeof id, 'string');
    assert.ok(id.length > 0);
  });

  test('PC-1.9: starts with sanitised template name', async () => {
    const { newCloneId } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.9 step 1: call newCloneId("myprofile")');
    const a = newCloneId('myprofile');
    console.log('PC-1.9 step 1 returned:', a);
    console.log('PC-1.9 step 2: call newCloneId("my profile") (special char)');
    const b = newCloneId('my profile');
    console.log('PC-1.9 step 2 returned:', b);
    console.log('PC-1.9 step 3: call newCloneId("my/profile") (special char)');
    const c = newCloneId('my/profile');
    console.log('PC-1.9 step 3 returned:', c);
    assert.ok(a.startsWith('myprofile-'));
    assert.ok(b.startsWith('my-profile-'));
    assert.ok(c.startsWith('my-profile-'));
  });

  test('PC-1.10: timestamp segment falls within the call window', async () => {
    const { newCloneId } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.10 step 1: capture Date.now() before call');
    const before = Date.now();
    console.log('PC-1.10 step 2: call newCloneId("ts-test")');
    const id = newCloneId('ts-test');
    const after = Date.now();
    console.log('PC-1.10 step 2 returned:', id);
    const parts = id.split('-');
    const ts = parseInt(parts[parts.length - 2], 10);
    console.log('PC-1.10 step 3: timestamp extracted =', ts, 'expected in [', before, ',', after, ']');
    assert.ok(ts >= before && ts <= after, `timestamp ${ts} not in [${before}, ${after}]`);
  });

  test('PC-1.11: two consecutive calls produce different ids', async () => {
    const { newCloneId } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.11 step 1: call newCloneId("dup-test")');
    const a = newCloneId('dup-test');
    console.log('PC-1.11 step 1 returned:', a);
    console.log('PC-1.11 step 2: call newCloneId("dup-test") again');
    const b = newCloneId('dup-test');
    console.log('PC-1.11 step 2 returned:', b);
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
    console.log('PC-1.12 step 1: call cloneProfileAtomic(srcDir, "myprofile")');
    const result = await cloneProfileAtomic(srcDir, 'myprofile');
    console.log('PC-1.12 step 1 returned:', result);
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
    console.log('PC-1.13 step 1: call cloneProfileAtomic');
    const { dir } = await cloneProfileAtomic(srcDir, 'myprofile');
    console.log('PC-1.13 step 1 returned dir:', dir);
    try {
      console.log('PC-1.13 step 2: read Cookies from clone dir');
      const cookies = await readFile(join(dir, 'Cookies'), 'utf8');
      console.log('PC-1.13 step 2 returned:', cookies);
      console.log('PC-1.13 step 3: read Preferences from clone dir');
      const prefs = await readFile(join(dir, 'Preferences'), 'utf8');
      console.log('PC-1.13 step 3 returned:', prefs);
      assert.strictEqual(cookies, 'sqlite-magic');
      assert.strictEqual(prefs, '{}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.14: SingletonLock is not copied', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.14 step 1: call cloneProfileAtomic');
    const { dir } = await cloneProfileAtomic(srcDir, 'myprofile');
    console.log('PC-1.14 step 1 returned dir:', dir);
    console.log('PC-1.14 step 2: check SingletonLock does NOT exist in clone');
    const exists = existsSync(join(dir, 'SingletonLock'));
    console.log('PC-1.14 step 2 SingletonLock exists:', exists);
    assert.ok(!exists, 'SingletonLock must not be copied');
    await rm(dir, { recursive: true, force: true });
  });

  test('PC-1.15: GPUCache directory is not copied', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.15 step 1: call cloneProfileAtomic');
    const { dir } = await cloneProfileAtomic(srcDir, 'myprofile');
    console.log('PC-1.15 step 1 returned dir:', dir);
    console.log('PC-1.15 step 2: check GPUCache does NOT exist in clone');
    const exists = existsSync(join(dir, 'GPUCache'));
    console.log('PC-1.15 step 2 GPUCache exists:', exists);
    assert.ok(!exists, 'GPUCache must not be copied');
    await rm(dir, { recursive: true, force: true });
  });

  test('PC-1.16: subdirectories not in skip list are copied', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.16 step 1: call cloneProfileAtomic');
    const { dir } = await cloneProfileAtomic(srcDir, 'myprofile');
    console.log('PC-1.16 step 1 returned dir:', dir);
    console.log('PC-1.16 step 2: read Local Storage/leveldb.ldb from clone');
    const ldb = await readFile(join(dir, 'Local Storage', 'leveldb.ldb'), 'utf8');
    console.log('PC-1.16 step 2 returned:', ldb);
    assert.strictEqual(ldb, 'storage-data');
    await rm(dir, { recursive: true, force: true });
  });

  test('PC-1.17: writes .clone metadata with created and templateName (no pid — uses FD lease)', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.17 step 1: capture Date.now() before call');
    const before = Date.now();
    console.log('PC-1.17 step 2: call cloneProfileAtomic');
    const { dir } = await cloneProfileAtomic(srcDir, 'myprofile');
    console.log('PC-1.17 step 2 returned dir:', dir);
    const after = Date.now();
    try {
      console.log('PC-1.17 step 3: read .clone metadata file');
      const raw = await readFile(join(dir, '.clone'), 'utf8');
      console.log('PC-1.17 step 3 returned raw:', raw);
      const meta = JSON.parse(raw);
      console.log('PC-1.17 step 3 parsed:', meta);
      // FD lease replaces PID liveness check — .clone must NOT contain pid.
      assert.ok(!('pid' in meta), '.clone must not contain pid (FD lease replaces PID check)');
      console.log('PC-1.17 step 4: assert created in [', before, ',', after, '], got:', meta.created);
      assert.ok(meta.created >= before && meta.created <= after, `created ${meta.created} must be in [${before}, ${after}]`);
      console.log('PC-1.17 step 5: assert templateName === "myprofile", got:', meta.templateName);
      assert.strictEqual(meta.templateName, 'myprofile');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.18: two concurrent calls produce separate dirs and ids', async () => {
    const { cloneProfileAtomic } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.18 step 1: call cloneProfileAtomic twice concurrently');
    const [a, b] = await Promise.all([
      cloneProfileAtomic(srcDir, 'myprofile'),
      cloneProfileAtomic(srcDir, 'myprofile'),
    ]);
    console.log('PC-1.18 step 1 returned a:', a, 'b:', b);
    try {
      console.log('PC-1.18 step 2: assert a.dir !== b.dir');
      assert.notStrictEqual(a.dir, b.dir);
      console.log('PC-1.18 step 3: assert a.cloneId !== b.cloneId');
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
    console.log('PC-1.19 step 1: makeCloneDir with deadPid', deadPid, 'and created=0');
    const dir = await makeCloneDir({ pid: deadPid, created: 0, templateName: 'test' });
    console.log('PC-1.19 step 1 created dir:', dir);
    console.log('PC-1.19 step 2: call cleanupClones');
    await cleanupClones();
    console.log('PC-1.19 step 3: check dir no longer exists');
    const exists = existsSync(dir);
    console.log('PC-1.19 step 3 dir exists:', exists);
    assert.ok(!exists, 'expired dead-PID clone should be deleted');
  });

  test('PC-1.20: keeps dir with recent created timestamp within TTL', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.20 step 1: makeCloneDir with recent created timestamp (now)');
    const dir = await makeCloneDir({ created: Date.now(), templateName: 'test' });
    console.log('PC-1.20 step 1 created dir:', dir);
    try {
      console.log('PC-1.20 step 2: call cleanupClones');
      await cleanupClones();
      console.log('PC-1.20 step 3: check dir still exists');
      const exists = existsSync(dir);
      console.log('PC-1.20 step 3 dir exists:', exists);
      // Recent created timestamp is within TTL — must be kept (no FD lease held).
      assert.ok(exists, 'recently-created clone must not be deleted within TTL');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.21: keeps dir with dead PID that is within TTL', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.21 step 1: makeCloneDir with deadPid', deadPid, 'and recent created timestamp');
    const dir = await makeCloneDir({ pid: deadPid, created: Date.now(), templateName: 'test' });
    console.log('PC-1.21 step 1 created dir:', dir);
    try {
      console.log('PC-1.21 step 2: call cleanupClones');
      await cleanupClones();
      console.log('PC-1.21 step 3: check dir still exists');
      const exists = existsSync(dir);
      console.log('PC-1.21 step 3 dir exists:', exists);
      assert.ok(exists, 'recently-created clone must not be deleted even if PID is dead');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('PC-1.22: deletes orphaned dir with no .clone file', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.22 step 1: create dir without .clone file (orphaned)');
    const dir = join(tmpdir(), `szkrabok-clone-pc1-orphan-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    console.log('PC-1.22 step 1 created dir:', dir);
    console.log('PC-1.22 step 2: call cleanupClones');
    await cleanupClones();
    console.log('PC-1.22 step 3: check dir no longer exists');
    const exists = existsSync(dir);
    console.log('PC-1.22 step 3 dir exists:', exists);
    assert.ok(!exists, 'orphaned clone dir should be deleted');
  });

  test('PC-1.23: no szkrabok-clone-* dirs present → runs without error', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.23 step 1: call cleanupClones with empty tmpdir (expect no throw)');
    await assert.doesNotReject(() => cleanupClones());
    console.log('PC-1.23 step 1: completed without error');
  });

  test('PC-1.24: non-clone dirs in tmpdir are not touched', async () => {
    const { cleanupClones } = await import('../../../packages/runtime/storage.js');
    console.log('PC-1.24 step 1: create a non-clone dir');
    const dir = join(tmpdir(), `other-tool-pc1-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    console.log('PC-1.24 step 1 created dir:', dir);
    console.log('PC-1.24 step 2: call cleanupClones');
    await cleanupClones();
    console.log('PC-1.24 step 3: check non-clone dir still exists');
    const exists = existsSync(dir);
    console.log('PC-1.24 step 3 dir exists:', exists);
    assert.ok(exists, 'non-clone dir must not be deleted');
    await rm(dir, { recursive: true, force: true });
  });
});
