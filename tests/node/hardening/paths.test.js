/**
 * D3 — confinePath(root, input, { mustExist = true }) in src/utils/paths.js
 *
 * Contract:
 *   - returns the resolved, realpath'd absolute path inside `root`
 *   - throws { code: 'PATH_NOT_ALLOWED' } otherwise
 *   - mustExist:false allows a not-yet-existing final component (write target);
 *     its parent must exist and be inside root
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, sep } from 'node:path';
import { load, tmpTracker, withCode } from './helpers.js';

const pathsMod = await load('src/utils/paths.js', 'D3');
const confinePath = (...a) => pathsMod.confinePath(...a);

const tmp = tmpTracker();
after(() => tmp.cleanup());

const DENIED = withCode('PATH_NOT_ALLOWED');

const makeRoot = () => {
  const base = tmp.make();
  const root = join(base, 'root');
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'sub', 'a.spec.js'), '');
  writeFileSync(join(root, 'top.js'), '');
  return { base, root };
};

// ── accepted ──────────────────────────────────────────────────────────────────

test('relative path inside root resolves to absolute', () => {
  const { root } = makeRoot();
  assert.equal(confinePath(root, 'sub/a.spec.js'), join(root, 'sub', 'a.spec.js'));
});

test('absolute path inside root is accepted', () => {
  const { root } = makeRoot();
  assert.equal(confinePath(root, join(root, 'top.js')), join(root, 'top.js'));
});

test('the root itself is accepted', () => {
  const { root } = makeRoot();
  assert.equal(confinePath(root, '.'), root);
});

test('inner .. that stays inside root is accepted', () => {
  const { root } = makeRoot();
  assert.equal(confinePath(root, 'sub/../top.js'), join(root, 'top.js'));
});

test('mustExist:false accepts a new file in an existing dir inside root', () => {
  const { root } = makeRoot();
  assert.equal(
    confinePath(root, 'sub/new.json', { mustExist: false }),
    join(root, 'sub', 'new.json')
  );
});

test('root given via a symlink is resolved; results use the real root', () => {
  const { base, root } = makeRoot();
  const link = join(base, 'root-link');
  symlinkSync(root, link);
  assert.equal(confinePath(link, 'top.js'), join(root, 'top.js'));
});

// ── refused ───────────────────────────────────────────────────────────────────

test('.. escape is refused', () => {
  const { root, base } = makeRoot();
  writeFileSync(join(base, 'outside.js'), '');
  assert.throws(() => confinePath(root, '../outside.js'), DENIED);
});

test('absolute path outside root is refused', () => {
  const { root } = makeRoot();
  assert.throws(() => confinePath(root, '/etc/hostname'), DENIED);
});

test('prefix sibling (/root-evil vs /root) is refused', () => {
  const { root } = makeRoot();
  const evil = `${root}-evil`;
  mkdirSync(evil);
  writeFileSync(join(evil, 'x.js'), '');
  assert.throws(() => confinePath(root, join(evil, 'x.js')), DENIED);
  assert.throws(() => confinePath(root, `../root-evil${sep}x.js`), DENIED);
});

test('symlink inside root pointing outside is refused (final component)', () => {
  const { root, base } = makeRoot();
  writeFileSync(join(base, 'secret'), 'x');
  symlinkSync(join(base, 'secret'), join(root, 'link.js'));
  assert.throws(() => confinePath(root, 'link.js'), DENIED);
});

test('symlinked directory component pointing outside is refused', () => {
  const { root, base } = makeRoot();
  mkdirSync(join(base, 'elsewhere'));
  writeFileSync(join(base, 'elsewhere', 'x.js'), '');
  symlinkSync(join(base, 'elsewhere'), join(root, 'dirlink'));
  assert.throws(() => confinePath(root, 'dirlink/x.js'), DENIED);
});

test('mustExist:false still refuses a new file under a symlinked dir pointing outside', () => {
  const { root, base } = makeRoot();
  mkdirSync(join(base, 'elsewhere'));
  symlinkSync(join(base, 'elsewhere'), join(root, 'dirlink'));
  assert.throws(() => confinePath(root, 'dirlink/new.json', { mustExist: false }), DENIED);
});

test('non-existent target is refused by default (mustExist)', () => {
  const { root } = makeRoot();
  assert.throws(() => confinePath(root, 'nope.js'), DENIED);
});

test('mustExist:false refuses a missing parent dir', () => {
  const { root } = makeRoot();
  assert.throws(() => confinePath(root, 'missing/dir/new.json', { mustExist: false }), DENIED);
});

test('NUL byte is refused', () => {
  const { root } = makeRoot();
  assert.throws(() => confinePath(root, 'top.js\0.png'), DENIED);
});

test('empty string is refused', () => {
  const { root } = makeRoot();
  assert.throws(() => confinePath(root, ''), DENIED);
});

test('non-string input is refused', () => {
  const { root } = makeRoot();
  for (const bad of [undefined, null, 42, {}, ['top.js']]) {
    assert.throws(() => confinePath(root, bad), DENIED, `input ${JSON.stringify(bad)}`);
  }
});

test('leading "-" is refused even if such a file exists (E3: CLI option injection)', () => {
  const { root } = makeRoot();
  writeFileSync(join(root, '-c'), '');
  assert.throws(() => confinePath(root, '-c'), DENIED);
  assert.throws(() => confinePath(root, '--config=x.js'), DENIED);
});

test('error message names the root, not only the input', () => {
  const { root } = makeRoot();
  assert.throws(
    () => confinePath(root, '/etc/hostname'),
    err => err.message.includes(root)
  );
});
