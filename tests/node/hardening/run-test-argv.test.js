/**
 * D6 / E3 / E4 — buildTestArgv and assertReportName in src/tools/run_test_args.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, withCode } from './helpers.js';

const mod = await load('src/tools/run_test_args.js', 'D6');
const buildTestArgv = (...a) => mod.buildTestArgv(...a);
const assertReportName = (...a) => mod.assertReportName(...a);

const INVALID = withCode('VALIDATION_ERROR');

const confined = extra => ({
  configPath: '/spec/playwright.config.js',
  outputDir: '/work/reports/s1/test-results',
  updateSnapshots: 'none',
  ...extra,
});

const valueOf = (argv, flag) => argv[argv.indexOf(flag) + 1];

test('confined argv carries config, output dir and snapshot policy', () => {
  const argv = buildTestArgv(confined());
  assert.equal(argv[0], 'test');
  assert.equal(valueOf(argv, '--config'), '/spec/playwright.config.js');
  assert.equal(valueOf(argv, '--output'), '/work/reports/s1/test-results');
  assert.ok(argv.includes('--update-snapshots=none'));
});

test('legacy argv (no outputDir/updateSnapshots) leaves both to the config', () => {
  const argv = buildTestArgv({ configPath: '/w/playwright.config.js' });
  assert.ok(!argv.includes('--output'));
  assert.ok(!argv.some(a => a.startsWith('--update-snapshots')));
});

test('files are appended last, unchanged', () => {
  const argv = buildTestArgv(confined({ files: ['/spec/a.spec.js', '/spec/dir'] }));
  assert.deepEqual(argv.slice(-2), ['/spec/a.spec.js', '/spec/dir']);
});

test('relative or option-like files are refused (callers must confine first)', () => {
  for (const f of ['-c', '--output=/x', 'a.spec.js', '', 42]) {
    assert.throws(() => buildTestArgv(confined({ files: [f] })), INVALID, JSON.stringify(f));
  }
});

test('files must be an array', () => {
  assert.throws(() => buildTestArgv(confined({ files: '/spec/a.spec.js' })), INVALID);
});

test('project, workers, grep are passed as separate, typed values', () => {
  const argv = buildTestArgv(confined({ project: 'automation', workers: 1, grep: 'login' }));
  assert.equal(valueOf(argv, '--project'), 'automation');
  assert.equal(valueOf(argv, '--workers'), '1');
  assert.ok(argv.includes('--grep=login'));
});

test('grep with a leading "-" stays a pattern (single --grep= token)', () => {
  const argv = buildTestArgv(confined({ grep: '-c' }));
  assert.ok(argv.includes('--grep=-c'));
  assert.ok(!argv.includes('-c'));
});

test('option-like project refused', () => {
  for (const p of ['-c', '--config=/x', '']) {
    assert.throws(() => buildTestArgv(confined({ project: p })), INVALID, p);
  }
});

test('workers must be a small positive integer', () => {
  for (const w of [0, -1, 1.5, '2', 65]) {
    assert.throws(() => buildTestArgv(confined({ workers: w })), INVALID, String(w));
  }
});

test('no caller value appears as its own option token', () => {
  const argv = buildTestArgv(confined({ project: 'p', grep: 'g', workers: 2, files: ['/spec/x'] }));
  const options = argv.filter(a => a.startsWith('-'));
  for (const o of options) {
    assert.match(
      o,
      /^--(config|output|update-snapshots=none|reporter|timeout|project|workers|grep=g)$/
    );
  }
});

// ── reportFile ────────────────────────────────────────────────────────────────

test('reportFile: plain .json names accepted', () => {
  for (const n of ['last-run.json', 'r1.json', 'a.b_c-d.json']) {
    assert.equal(assertReportName(n), n);
  }
});

test('reportFile: directories, traversal, other extensions refused', () => {
  for (const n of [
    '../x.json',
    'a/b.json',
    '/tmp/x.json',
    '.json',
    '.x.json',
    'x.js',
    'x',
    '',
    'x.json\0',
    1,
  ]) {
    assert.throws(() => assertReportName(n), INVALID, JSON.stringify(n));
  }
});
