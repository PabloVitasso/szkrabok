/**
 * D9 / E1 — buildTestEnv({ baseEnv, params, fixed }) in src/tools/run_test_args.js:
 * the complete contract.
 *
 * Pure-function tests only: they check which keys survive, never run a child.
 * Reserved keys are tested by name with an inert placeholder value ('x').
 *
 * Tests tagged F<n> cover the 2026-10-24 audit findings (hardening proposal):
 *   F1  reserved set covers shell/interpreter vars and the PYTHON/PERL5/RUBY/
 *       JAVA families
 *   F2  FIXED_ENV_KEYS asserted exactly and frozen
 *   F3  every fixed key's outcome as a param pinned, no catch-all
 *   F4  the whole npm_* family is scrubbed from baseEnv, not only npm_config_*
 *   F5  `fixed` must be a plain object
 *   F6  scalar rule: string | finite number | boolean; NaN/Infinity refused
 *   F7  value length is UTF-16 code units, surrogate pairs count 2
 *   F8  NUL in key, case-fold collision refused, default-call purity
 *
 * Every refusal asserts both { code: 'VALIDATION_ERROR' } and the field
 * ('params' or 'fixed'). End-to-end proof that the real attack fails stays in
 * the companion doc's live verification checklist, run by hand on the host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, withCode } from './helpers.js';

const mod = await load('src/tools/run_test_args.js', 'D9');
const buildTestEnv = (...a) => mod.buildTestEnv(...a);
const FIXED_ENV_KEYS = () => mod.FIXED_ENV_KEYS;
const P = 'SZKRABOK_PARAM_'; // params reach the spec under this namespace

const INVALID = withCode('VALIDATION_ERROR');
const invalidField = field => err => {
  INVALID(err);
  if (err.field !== field) {
    throw new Error(`expected field ${JSON.stringify(field)}, got ${JSON.stringify(err.field)}`);
  }
  return true;
};
const refusesParam = params =>
  assert.throws(() => buildTestEnv({ params }), invalidField('params'));

// ── accepted ──────────────────────────────────────────────────────────────────

test('ordinary params pass, uppercased, scalars stringified, under the prefix', () => {
  const env = buildTestEnv({
    params: {
      url: 'https://example.com',
      SESSIONMODE: 'clone',
      my_param_1: 3,
      flag: true,
      off: false,
      zero: 0,
    },
  });
  assert.equal(env[`${P}URL`], 'https://example.com');
  assert.equal(env[`${P}SESSIONMODE`], 'clone');
  assert.equal(env[`${P}MY_PARAM_1`], '3');
  assert.equal(env[`${P}FLAG`], 'true');
  assert.equal(env[`${P}OFF`], 'false');
  assert.equal(env[`${P}ZERO`], '0');
});

test('params never land under their bare or original-case name', () => {
  assert.deepEqual(Object.keys(buildTestEnv({ baseEnv: {}, params: { my_param: 'x' } })), [
    `${P}MY_PARAM`,
  ]);
  const env = buildTestEnv({ baseEnv: {}, params: { url: 'p', flag: true } });
  assert.deepEqual(Object.keys(env).sort(), [`${P}FLAG`, `${P}URL`]);
});

test('the prefix is exported', () => {
  assert.equal(mod.PARAM_ENV_PREFIX, P);
});

test('missing params is fine', () => {
  assert.deepEqual(buildTestEnv({ baseEnv: { A: '1' }, fixed: { B: '2' } }), { A: '1', B: '2' });
});

test('params leave same-named baseEnv keys alone', () => {
  const env = buildTestEnv({ baseEnv: { URL: 'base' }, params: { url: 'p' } });
  assert.equal(env.URL, 'base');
  assert.equal(env[`${P}URL`], 'p');
});

test("inherited SZKRABOK_PARAM_* is dropped; only this call's params appear", () => {
  const env = buildTestEnv({
    baseEnv: { [`${P}STALE`]: 'x', [`${P}URL`]: 'stale', szkrabok_param_lower: 'x' },
    params: { url: 'p' },
  });
  assert.equal(env[`${P}STALE`], undefined);
  assert.equal(env.szkrabok_param_lower, undefined);
  assert.equal(env[`${P}URL`], 'p');
});

test('key lengths: 1 char and exactly 64 chars accepted', () => {
  assert.equal(buildTestEnv({ params: { A: 'x' } })[`${P}A`], 'x');
  const key = 'K'.repeat(64);
  assert.equal(buildTestEnv({ params: { [key]: 'x' } })[`${P}${key}`], 'x');
});

// ── reserved names (placeholder values) ───────────────────────────────────────

const RESERVED_D9 = [
  // families
  'NODE_OPTIONS',
  'node_options',
  'NODE_PATH',
  'NPM_CONFIG_X',
  'npm_config_x',
  'NPX_X',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_X',
  'PLAYWRIGHT_JSON_OUTPUT_NAME',
  'PLAYWRIGHT_X',
  'PW_X',
  'SZKRABOK_CDP_ENDPOINT',
  'SZKRABOK_ATTACH_SIGNAL',
  'SZKRABOK_SESSION',
  'SZKRABOK_X',
  'DEBUG',
  'ELECTRON_X',
  'UV_X',
  'GIT_X',
  // exact names
  'PATH',
  'HOME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'USER',
  'LOGNAME',
  'DISPLAY',
  'XAUTHORITY',
  'SSH_AUTH_SOCK',
  'BROWSER',
];

// F1: shell/interpreter variables and families.
const RESERVED_F1 = [
  'BASH_ENV',
  'BASHOPTS',
  'ENV',
  'SHELLOPTS',
  'IFS',
  'PS4',
  'PYTHONPATH',
  'PERL5OPT',
  'PERL5LIB',
  'RUBYOPT',
  'JAVA_TOOL_OPTIONS',
  'PYTHON_X',
  'PERL5_X',
  'RUBY_X',
  'JAVA_X',
];

for (const name of RESERVED_D9) {
  test(`reserved param key refused: ${name}`, () => refusesParam({ [name]: 'x' }));
}

for (const name of RESERVED_F1) {
  test(`F1: reserved param key refused: ${name}`, () => refusesParam({ [name]: 'x' }));
}

test('reserved-looking but distinct names pass (prefix match is anchored)', () => {
  const env = buildTestEnv({ params: { MY_NODE_OPTIONS: 'x', PATHNAME: 'x', USERNAME: 'x' } });
  assert.equal(env[`${P}MY_NODE_OPTIONS`], 'x');
  assert.equal(env[`${P}PATHNAME`], 'x');
  assert.equal(env[`${P}USERNAME`], 'x');
});

test('F1: family-adjacent but distinct names still pass', () => {
  const env = buildTestEnv({ params: { PERL_X: 'x', RUST_X: 'x', JAVASCRIPT_X: 'x' } });
  assert.equal(env[`${P}PERL_X`], 'x');
  assert.equal(env[`${P}RUST_X`], 'x');
  assert.equal(env[`${P}JAVASCRIPT_X`], 'x');
});

// ── inherited env scrubbed ────────────────────────────────────────────────────

test('NODE_OPTIONS and npm config inherited from the host are dropped', () => {
  const env = buildTestEnv({
    baseEnv: { NODE_OPTIONS: 'x', NPM_CONFIG_X: 'x', npm_config_x: 'x', KEEP: 'y' },
  });
  assert.equal('NODE_OPTIONS' in env, false);
  assert.equal('NPM_CONFIG_X' in env, false);
  assert.equal('npm_config_x' in env, false);
  assert.equal(env.KEEP, 'y');
});

test('F4: the whole npm_* family is dropped from baseEnv, every spelling', () => {
  const scrubbed = [
    'npm_config_x',
    'NPM_CONFIG_X',
    'npm_package_json',
    'npm_package_version',
    'npm_lifecycle_event',
    'npm_lifecycle_script',
    'npm_execpath',
    'NPM_EXECPATH',
  ];
  const baseEnv = { KEEP: 'y' };
  for (const k of scrubbed) baseEnv[k] = 'x';
  const env = buildTestEnv({ baseEnv });
  for (const k of scrubbed) assert.equal(k in env, false, `${k} must be scrubbed`);
  assert.equal(env.KEEP, 'y');
});

// ── key shape ─────────────────────────────────────────────────────────────────

test('bad key syntax refused', () => {
  for (const key of ['', '1ABC', 'A-B', 'A B', 'A.B', 'A=B', 'Ä', 'X'.repeat(65)]) {
    refusesParam({ [key]: 'x' });
  }
});

test('F8: NUL in a key is refused', () => {
  refusesParam({ 'A\0B': 'x' });
});

test('F8: keys that collide after case folding are refused as ambiguous', () => {
  refusesParam({ url: 'a', URL: 'b' });
  refusesParam({ Url: 'a', uRl: 'b' });
});

// ── value shape ───────────────────────────────────────────────────────────────

test('non-scalar values refused', () => {
  for (const v of [null, undefined, {}, [], ['a'], () => {}, 1n]) {
    refusesParam({ URL: v });
  }
});

test('F6: NaN and Infinity refused, finite numbers coerced', () => {
  refusesParam({ URL: NaN });
  refusesParam({ URL: Infinity });
  refusesParam({ URL: -Infinity });
  const env = buildTestEnv({ params: { A: 5, B: -1.5 } });
  assert.equal(env[`${P}A`], '5');
  assert.equal(env[`${P}B`], '-1.5');
});

test('value of 4096 chars accepted, 4097 refused', () => {
  assert.equal(buildTestEnv({ params: { URL: 'a'.repeat(4096) } })[`${P}URL`].length, 4096);
  refusesParam({ URL: 'a'.repeat(4097) });
});

test('F7: length is UTF-16 code units, surrogate pairs count as two', () => {
  assert.equal(buildTestEnv({ params: { URL: '😀'.repeat(2048) } })[`${P}URL`].length, 4096);
  refusesParam({ URL: '😀'.repeat(2048) + '😀' });
});

test('NUL in a value refused', () => {
  refusesParam({ URL: 'a\0b' });
});

// ── params and fixed shapes ───────────────────────────────────────────────────

test('params must be a plain object', () => {
  // [] has no keys to fail the key check, so only the shape check refuses it.
  for (const p of ['x', 1, ['a'], []]) {
    assert.throws(() => buildTestEnv({ params: p }), invalidField('params'));
  }
});

test('F5: non-object fixed is refused, not spread into the env', () => {
  for (const fixed of ['x', 1, ['a'], () => {}]) {
    assert.throws(() => buildTestEnv({ params: {}, fixed }), invalidField('fixed'));
  }
});

// ── fixed keys ────────────────────────────────────────────────────────────────

test('F2: FIXED_ENV_KEYS is exactly the six runner-set keys, and frozen', () => {
  assert.deepEqual([...FIXED_ENV_KEYS()].sort(), [
    'FORCE_COLOR',
    'PLAYWRIGHT_JSON_OUTPUT_NAME',
    'PLAYWRIGHT_PROJECT',
    'SZKRABOK_ATTACH_SIGNAL',
    'SZKRABOK_CDP_ENDPOINT',
    'SZKRABOK_SESSION',
  ]);
  assert.ok(Object.isFrozen(FIXED_ENV_KEYS()));
});

test('F3: every fixed key has a pinned outcome as a param, no catch-all', () => {
  const RESERVED_FIXED = [
    'PLAYWRIGHT_JSON_OUTPUT_NAME',
    'PLAYWRIGHT_PROJECT',
    'SZKRABOK_ATTACH_SIGNAL',
    'SZKRABOK_CDP_ENDPOINT',
    'SZKRABOK_SESSION',
  ];
  const FREE_FIXED = ['FORCE_COLOR'];

  assert.deepEqual(
    [...RESERVED_FIXED, ...FREE_FIXED].sort(),
    [...FIXED_ENV_KEYS()].sort(),
    'every fixed key must be classified here; update this test when the list changes'
  );

  for (const key of RESERVED_FIXED) {
    refusesParam({ [key.toLowerCase()]: 'x' });
    refusesParam({ [key]: 'x' });
  }
  for (const key of FREE_FIXED) {
    const env = buildTestEnv({
      params: { [key.toLowerCase()]: 'from-params' },
      fixed: { [key]: 'from-fixed' },
    });
    assert.equal(env[key], 'from-fixed');
  }
});

test('fixed is applied last: wins over baseEnv and over a param at the same key', () => {
  const env = buildTestEnv({
    baseEnv: { FORCE_COLOR: '1', URL: 'base' },
    params: { url: 'param' },
    fixed: { FORCE_COLOR: '0', URL: 'fixed', [`${P}URL`]: 'fixed' },
  });
  assert.equal(env.FORCE_COLOR, '0');
  assert.equal(env.URL, 'fixed');
  assert.equal(env[`${P}URL`], 'fixed');
});

test('fixed object is not mutated', () => {
  const fixed = { FORCE_COLOR: '0' };
  const env = buildTestEnv({ params: { force_color: '1' }, fixed });
  assert.equal(env.FORCE_COLOR, '0');
  assert.deepEqual(fixed, { FORCE_COLOR: '0' });
});

// ── purity and defaults ───────────────────────────────────────────────────────

test('returns a new object; baseEnv and params are not mutated', () => {
  const baseEnv = { KEEP: 'x' };
  const params = { MY_PARAM: 'x' };
  const env = buildTestEnv({ baseEnv, params, fixed: {} });
  assert.notEqual(env, baseEnv);
  assert.deepEqual(baseEnv, { KEEP: 'x' });
  assert.deepEqual(params, { MY_PARAM: 'x' });
  assert.equal(env.KEEP, 'x');
  assert.equal(env[`${P}MY_PARAM`], 'x');
});

test('F8: default call copies process.env without the scrubbed forms', () => {
  const before = new Map(Object.entries(process.env));
  const env = buildTestEnv();
  assert.notEqual(env, process.env);
  assert.equal('NODE_OPTIONS' in env, false);
  assert.equal(
    Object.keys(env).some(k => /^npm_/i.test(k)),
    false
  );

  // process.env is an exotic object: a deepStrictEqual against a plain copy
  // fails even when nothing changed, and assert failure output prints every
  // value, secrets included. Compare by key names only and report names,
  // never values.
  const after = new Map(Object.entries(process.env));
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter(k => !before.has(k) || !after.has(k) || before.get(k) !== after.get(k))
    .sort();
  assert.deepEqual(changed, [], 'process.env changed at these keys (values withheld)');
});
