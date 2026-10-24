/**
 * D5 — session names.
 *
 * Contract:
 *   - assertSessionName(name, { kind }) in src/utils/validate.js
 *       pattern ^[A-Za-z0-9][A-Za-z0-9._-]*$
 *       kind 'template' (user-chosen names, open/delete): max 64
 *       kind 'any' (ids coming back from the server, e.g. clone ids): max 96
 *       throws { code: 'VALIDATION_ERROR', field: 'sessionName' }
 *   - packages/runtime/storage.js refuses ids that escape the sessions dir in
 *     every path-building export, throwing { code: 'PATH_NOT_ALLOWED' }
 */

import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { load, tmpTracker, withCode } from './helpers.js';
import * as storage from '../../../packages/runtime/storage.js';

const validateMod = await load('src/utils/validate.js', 'D5');
const assertSessionName = (...a) => validateMod.assertSessionName(...a);

const tmp = tmpTracker();
after(() => tmp.cleanup());

const INVALID = withCode('VALIDATION_ERROR');

// ── assertSessionName ─────────────────────────────────────────────────────────

test('accepts ordinary names', () => {
  for (const name of ['a', 'a.b-c_1', 'Dev', '0day', 'x'.repeat(64)]) {
    assert.doesNotThrow(() => assertSessionName(name, { kind: 'template' }), name);
  }
});

test('rejects dot-only, leading separators and path characters', () => {
  for (const name of ['.', '..', '...', '.hidden', '-x', '_x', 'a/b', 'a\\b', '../x', 'a\0b']) {
    assert.throws(
      () => assertSessionName(name, { kind: 'template' }),
      INVALID,
      JSON.stringify(name)
    );
  }
});

test('rejects globs (delete glob mode is removed)', () => {
  for (const name of ['*', 'dev-*', 'a?b', '[ab]']) {
    assert.throws(() => assertSessionName(name, { kind: 'template' }), INVALID, name);
  }
});

test('rejects empty and non-string', () => {
  for (const name of ['', undefined, null, 1, {}, []]) {
    assert.throws(
      () => assertSessionName(name, { kind: 'template' }),
      INVALID,
      JSON.stringify(name)
    );
  }
});

test('template names are capped at 64', () => {
  assert.throws(() => assertSessionName('x'.repeat(65), { kind: 'template' }), INVALID);
});

test('ids are capped at 96', () => {
  assert.doesNotThrow(() => assertSessionName('x'.repeat(96), { kind: 'any' }));
  assert.throws(() => assertSessionName('x'.repeat(97), { kind: 'any' }), INVALID);
});

test('a clone id generated from a max-length template name passes as kind "any"', () => {
  const cloneId = storage.newCloneId('t'.repeat(64));
  assert.ok(cloneId.length > 64, 'precondition: clone id longer than the template cap');
  assert.doesNotThrow(() => assertSessionName(cloneId, { kind: 'any' }));
});

test('a clone id from a template with odd characters passes (newCloneId sanitizes)', () => {
  assert.doesNotThrow(() => assertSessionName(storage.newCloneId('a.b_c'), { kind: 'any' }));
});

test('the error names the field', () => {
  assert.throws(
    () => assertSessionName('..', { kind: 'template' }),
    err => err.field === 'sessionName'
  );
});

// ── storage defense in depth ──────────────────────────────────────────────────

let saved;
let sessionsDir;
let sentinelDir;

beforeEach(() => {
  saved = process.env.SZKRABOK_SESSIONS_DIR;
  const base = tmp.make();
  sessionsDir = join(base, 'sessions');
  sentinelDir = join(base, 'victim');
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(sentinelDir, { recursive: true });
  writeFileSync(join(sentinelDir, 'keep.txt'), 'x');
  process.env.SZKRABOK_SESSIONS_DIR = sessionsDir;
});

afterEach(() => {
  if (saved === undefined) delete process.env.SZKRABOK_SESSIONS_DIR;
  else process.env.SZKRABOK_SESSIONS_DIR = saved;
});

const ESCAPE = withCode('PATH_NOT_ALLOWED');

test('storage.deleteSession("../victim") rejects and leaves the dir intact', async () => {
  await assert.rejects(() => storage.deleteSession('../victim'), ESCAPE);
  assert.ok(existsSync(join(sentinelDir, 'keep.txt')));
});

test('storage.deleteSession refuses absolute ids', async () => {
  await assert.rejects(() => storage.deleteSession(sentinelDir), ESCAPE);
  assert.ok(existsSync(join(sentinelDir, 'keep.txt')));
});

test('storage.getUserDataDir refuses escaping ids', () => {
  assert.throws(() => storage.getUserDataDir('../victim'), ESCAPE);
});

test('storage.saveState refuses escaping ids and writes nothing', async () => {
  await assert.rejects(() => storage.saveState('../victim', { cookies: [] }), ESCAPE);
  assert.ok(!existsSync(join(sentinelDir, 'state.json')));
});

test('storage.saveMeta / updateMeta refuse escaping ids and write nothing', async () => {
  await assert.rejects(() => storage.saveMeta('../victim', {}), ESCAPE);
  await assert.rejects(() => storage.updateMeta('../victim', { lastUrl: 'x' }), ESCAPE);
  assert.ok(!existsSync(join(sentinelDir, 'meta.json')));
});

test('storage.ensureProfileDir refuses escaping ids and creates nothing', async () => {
  await assert.rejects(() => storage.ensureProfileDir('../victim'), ESCAPE);
  assert.ok(!existsSync(join(sentinelDir, 'profile')));
});

test('storage.sessionExists / loadState / loadMeta refuse escaping ids', async () => {
  assert.throws(() => storage.sessionExists('../victim'), ESCAPE);
  await assert.rejects(() => storage.loadState('../victim'), ESCAPE);
  await assert.rejects(() => storage.loadMeta('../victim'), ESCAPE);
});

test('the sessions dir itself is not a valid session (id "." / "")', async () => {
  await assert.rejects(() => storage.deleteSession('.'), ESCAPE);
  await assert.rejects(() => storage.deleteSession(''), ESCAPE);
  assert.ok(existsSync(sessionsDir));
});

test('ordinary ids still work', async () => {
  await storage.saveMeta('ok-1', { a: 1 });
  assert.deepEqual(await storage.loadMeta('ok-1'), { a: 1 });
  await storage.deleteSession('ok-1');
  assert.ok(!storage.sessionExists('ok-1'));
});
