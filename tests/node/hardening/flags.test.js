/**
 * D1 — server-mode flags, src/flags.js
 *
 * Contract:
 *   parseFlags(argv, { cwd }) → {
 *     workRoot,          // realpath; default realpath(cwd)
 *     specRoot,          // realpath | null
 *     allowNodeCode,     // boolean
 *     allowPrivateNet,   // boolean
 *     trustProjectConfig // boolean
 *   }
 *   throws { code: 'INVALID_FLAGS' } on: missing value, relative path,
 *   missing dir, a file instead of a dir, overlapping roots (either direction,
 *   or equal), and unknown --allow-* flags (typo must not silently fail open
 *   or closed without notice).
 *
 *   capabilities(flags) → {
 *     browserRunCode:  'page' | 'node',
 *     browserRunPath:  'off'  | 'page' | 'node',
 *     testTools:       'off'  | 'confined' | 'unconfined',
 *     scaffoldInit:    boolean,
 *     privateNet:      boolean,
 *     projectConfig:   boolean,
 *   }
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { load, tmpTracker, withCode } from './helpers.js';

const flagsMod = await load('src/flags.js', 'D1');
const parseFlags = (...a) => flagsMod.parseFlags(...a);
const capabilities = (...a) => flagsMod.capabilities(...a);

const tmp = tmpTracker();
after(() => tmp.cleanup());

const BAD = withCode('INVALID_FLAGS');

const roots = () => {
  const base = tmp.make();
  const work = join(base, 'work');
  const spec = join(base, 'spec');
  mkdirSync(work);
  mkdirSync(spec);
  return { base, work, spec };
};

// ── parseFlags ────────────────────────────────────────────────────────────────

test('defaults: work root = cwd, everything else off', () => {
  const { work } = roots();
  assert.deepEqual(parseFlags([], { cwd: work }), {
    workRoot: work,
    specRoot: null,
    allowNodeCode: false,
    allowPrivateNet: false,
    trustProjectConfig: false,
  });
});

test('all flags parsed', () => {
  const { work, spec } = roots();
  const f = parseFlags(
    ['--work-root', work, '--spec-root', spec, '--allow-node-code', '--allow-private-net'],
    { cwd: '/' }
  );
  assert.equal(f.workRoot, work);
  assert.equal(f.specRoot, spec);
  assert.equal(f.allowNodeCode, true);
  assert.equal(f.allowPrivateNet, true);
});

test('--trust-project-config parsed', () => {
  const { work } = roots();
  assert.equal(parseFlags(['--trust-project-config'], { cwd: work }).trustProjectConfig, true);
});

test('typos in --trust-* flags are refused', () => {
  const { work } = roots();
  assert.throws(() => parseFlags(['--trust-project-conf'], { cwd: work }), BAD);
  assert.throws(() => parseFlags(['--trust-everything'], { cwd: work }), BAD);
});

test('--flag=value form is accepted', () => {
  const { work, spec } = roots();
  const f = parseFlags([`--work-root=${work}`, `--spec-root=${spec}`], { cwd: '/' });
  assert.equal(f.workRoot, work);
  assert.equal(f.specRoot, spec);
});

test('existing server flags are ignored, not rejected', () => {
  const { work } = roots();
  assert.doesNotThrow(() =>
    parseFlags(['--headful', '--no-headless', '--config', '/x.toml'], { cwd: work })
  );
});

test("roots are realpath'd", () => {
  const { base, work, spec } = roots();
  symlinkSync(spec, join(base, 'spec-link'));
  const f = parseFlags(['--work-root', work, '--spec-root', join(base, 'spec-link')], { cwd: '/' });
  assert.equal(f.specRoot, spec);
});

test('missing value is refused', () => {
  const { work } = roots();
  assert.throws(() => parseFlags(['--spec-root'], { cwd: work }), BAD);
  assert.throws(() => parseFlags(['--spec-root', '--allow-node-code'], { cwd: work }), BAD);
});

test('relative root paths are refused (no dependence on mcp-proxy cwd)', () => {
  const { work } = roots();
  assert.throws(() => parseFlags(['--spec-root', 'spec'], { cwd: work }), BAD);
  assert.throws(() => parseFlags(['--work-root', './work'], { cwd: work }), BAD);
});

test('missing dir is refused', () => {
  const { base, work } = roots();
  assert.throws(() => parseFlags(['--spec-root', join(base, 'nope')], { cwd: work }), BAD);
});

test('a file instead of a dir is refused', () => {
  const { base, work } = roots();
  writeFileSync(join(base, 'file'), '');
  assert.throws(() => parseFlags(['--spec-root', join(base, 'file')], { cwd: work }), BAD);
});

test('spec root inside work root is refused', () => {
  const { work } = roots();
  mkdirSync(join(work, 'tests'));
  assert.throws(
    () => parseFlags(['--work-root', work, '--spec-root', join(work, 'tests')], { cwd: '/' }),
    BAD
  );
});

test('work root inside spec root is refused', () => {
  const { spec } = roots();
  mkdirSync(join(spec, 'w'));
  assert.throws(
    () => parseFlags(['--work-root', join(spec, 'w'), '--spec-root', spec], { cwd: '/' }),
    BAD
  );
});

test('equal roots are refused, also via symlink', () => {
  const { base, work } = roots();
  assert.throws(() => parseFlags(['--work-root', work, '--spec-root', work], { cwd: '/' }), BAD);
  symlinkSync(work, join(base, 'alias'));
  assert.throws(
    () => parseFlags(['--work-root', work, '--spec-root', join(base, 'alias')], { cwd: '/' }),
    BAD
  );
});

test('default work root (cwd) overlapping the spec root is refused', () => {
  const { spec } = roots();
  mkdirSync(join(spec, 'sub'));
  assert.throws(() => parseFlags(['--spec-root', spec], { cwd: join(spec, 'sub') }), BAD);
});

test('prefix siblings are not overlap (/x/spec vs /x/spec-work)', () => {
  const { base, spec } = roots();
  const sibling = `${spec}-work`;
  mkdirSync(sibling);
  assert.doesNotThrow(() =>
    parseFlags(['--work-root', sibling, '--spec-root', spec], { cwd: base })
  );
});

test('unknown --allow-* flag is refused (typo guard)', () => {
  const { work } = roots();
  assert.throws(() => parseFlags(['--allow-node-cod'], { cwd: work }), BAD);
  assert.throws(() => parseFlags(['--allow-everything'], { cwd: work }), BAD);
});

test('flags are argv-only: env vars do not set them', () => {
  const { work, spec } = roots();
  const saved = { ...process.env };
  try {
    process.env.SZKRABOK_ALLOW_NODE_CODE = '1';
    process.env.SZKRABOK_SPEC_ROOT = spec;
    process.env.ALLOW_NODE_CODE = 'true';
    const f = parseFlags([], { cwd: work });
    assert.equal(f.allowNodeCode, false);
    assert.equal(f.specRoot, null);
  } finally {
    process.env = saved;
  }
});

// ── capabilities: the D1 matrix ───────────────────────────────────────────────

const base = {
  workRoot: '/w',
  specRoot: null,
  allowNodeCode: false,
  allowPrivateNet: false,
  trustProjectConfig: false,
};

test('matrix: default', () => {
  assert.deepEqual(capabilities(base), {
    browserRunCode: 'page',
    browserRunPath: 'off',
    testTools: 'off',
    scaffoldInit: false,
    privateNet: false,
    projectConfig: false,
  });
});

test('matrix: --spec-root', () => {
  assert.deepEqual(capabilities({ ...base, specRoot: '/s' }), {
    browserRunCode: 'page',
    browserRunPath: 'page',
    testTools: 'confined',
    scaffoldInit: false,
    privateNet: false,
    projectConfig: false,
  });
});

test('matrix: --allow-node-code', () => {
  assert.deepEqual(capabilities({ ...base, allowNodeCode: true }), {
    browserRunCode: 'node',
    browserRunPath: 'node',
    testTools: 'unconfined',
    scaffoldInit: true,
    privateNet: false,
    projectConfig: false,
  });
});

test('matrix: --allow-node-code wins over --spec-root for test tools', () => {
  const c = capabilities({ ...base, specRoot: '/s', allowNodeCode: true });
  assert.equal(c.testTools, 'unconfined');
  assert.equal(c.browserRunPath, 'node');
});

test('matrix: --trust-project-config only toggles projectConfig (not implied by --allow-node-code)', () => {
  assert.deepEqual(capabilities({ ...base, trustProjectConfig: true }), {
    ...capabilities(base),
    projectConfig: true,
  });
  assert.equal(capabilities({ ...base, allowNodeCode: true }).projectConfig, false);
});

test('matrix: --allow-private-net only toggles privateNet', () => {
  assert.deepEqual(capabilities({ ...base, allowPrivateNet: true }), {
    ...capabilities(base),
    privateNet: true,
  });
});
