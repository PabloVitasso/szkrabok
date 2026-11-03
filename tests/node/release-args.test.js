import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, targetsOf } from '../../scripts/lib/release.js';

test('release args: defaults to the npm target', () => {
  assert.deepEqual(parseArgs([]), { target: 'npm', skipGate: false, force: false });
});

test('release args: accepts the three targets, space and equals forms', () => {
  assert.equal(parseArgs(['--target', 'github']).target, 'github');
  assert.equal(parseArgs(['--target=both']).target, 'both');
  assert.equal(parseArgs(['--target', 'npm']).target, 'npm');
});

test('release args: boolean flags', () => {
  const opts = parseArgs(['--target', 'github', '--skip-gate', '--force']);
  assert.deepEqual(opts, { target: 'github', skipGate: true, force: true });
});

test('release args: rejects an unknown target', () => {
  assert.throws(() => parseArgs(['--target', 'registry']), /unknown --target "registry"/);
});

test('release args: rejects a missing target value', () => {
  assert.throws(() => parseArgs(['--target']), /--target needs a value/);
});

test('release args: rejects unknown arguments', () => {
  assert.throws(() => parseArgs(['--frobnicate']), /unknown argument: --frobnicate/);
});

test('release targets: both expands to npm then github', () => {
  assert.deepEqual(targetsOf('npm'), ['npm']);
  assert.deepEqual(targetsOf('github'), ['github']);
  assert.deepEqual(targetsOf('both'), ['npm', 'github']);
});
