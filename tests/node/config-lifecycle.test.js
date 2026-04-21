// Tests for the provisional→final config lifecycle introduced in the determinism refactor.
// Covers: phase transitions, getConfig guards, error classes, explicitConfigPath, getConfigMeta.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  _resetConfigForTesting,
  initConfig,
  initConfigProvisional,
  finalizeConfig,
  getConfig,
  getConfigMeta,
  resolvePreset,
  getPresets,
} from '../../packages/runtime/config.js';
import { ConfigNotInitializedError, ConfigNotFinalError } from '../../packages/runtime/errors.js';

let tmpDirs = [];
let savedEnv = {};

const makeTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'szkrabok-lc-'));
  tmpDirs.push(d);
  return d;
};

const writeToml = (dir, filename, content) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
};

beforeEach(() => {
  _resetConfigForTesting();
  savedEnv = {
    SZKRABOK_CONFIG: process.env.SZKRABOK_CONFIG,
    SZKRABOK_ROOT: process.env.SZKRABOK_ROOT,
  };
  delete process.env.SZKRABOK_CONFIG;
  delete process.env.SZKRABOK_ROOT;
  for (const d of tmpDirs) {
    // eslint-disable-next-line no-empty
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ── Error classes ──────────────────────────────────────────────────────────────

test('ConfigNotInitializedError has correct code and name', () => {
  const e = new ConfigNotInitializedError();
  assert.equal(e.code, 'CONFIG_NOT_INITIALIZED');
  assert.equal(e.name, 'ConfigNotInitializedError');
  assert.ok(e instanceof Error);
});

test('ConfigNotFinalError has correct code and name', () => {
  const e = new ConfigNotFinalError();
  assert.equal(e.code, 'CONFIG_NOT_FINAL');
  assert.equal(e.name, 'ConfigNotFinalError');
  assert.ok(e instanceof Error);
});

// ── Uninitialized guards ───────────────────────────────────────────────────────

test('getConfig throws ConfigNotInitializedError before any init', () => {
  assert.throws(() => getConfig(), err => err instanceof ConfigNotInitializedError);
});

test('resolvePreset throws ConfigNotInitializedError before any init', () => {
  assert.throws(() => resolvePreset('default'), err => err instanceof ConfigNotInitializedError);
});

test('getPresets throws ConfigNotInitializedError before any init', () => {
  assert.throws(() => getPresets(), err => err instanceof ConfigNotInitializedError);
});

// ── Provisional phase ──────────────────────────────────────────────────────────

test('initConfigProvisional sets phase to provisional', () => {
  initConfigProvisional();
  const meta = getConfigMeta();
  assert.equal(meta.phase, 'provisional');
});

test('getConfig throws ConfigNotFinalError when provisional', () => {
  initConfigProvisional();
  assert.throws(() => getConfig(), err => err instanceof ConfigNotFinalError);
});

test('getConfig({ allowProvisional: true }) works during provisional phase', () => {
  initConfigProvisional();
  const cfg = getConfig({ allowProvisional: true });
  assert.equal(typeof cfg.headless, 'boolean');
  assert.equal(typeof cfg.timeout, 'number');
});

test('resolvePreset works during provisional phase', () => {
  initConfigProvisional();
  const p = resolvePreset('default');
  assert.equal(typeof p.label, 'string');
});

// ── Finalize phase ─────────────────────────────────────────────────────────────

test('finalizeConfig promotes phase to final', () => {
  initConfigProvisional();
  finalizeConfig([]);
  assert.equal(getConfigMeta().phase, 'final');
});

test('getConfig works without flag after finalizeConfig', () => {
  initConfigProvisional();
  finalizeConfig([]);
  const cfg = getConfig();
  assert.equal(typeof cfg.headless, 'boolean');
});

test('finalizeConfig with roots picks up root config', () => {
  const root = makeTmp();
  writeToml(root, 'szkrabok.config.toml', '[default]\nuserAgent = "FinalAgent"\n');
  initConfigProvisional();
  finalizeConfig([root]);
  assert.equal(getConfig().userAgent, 'FinalAgent');
});

test('finalizeConfig updates configMeta previousSource', () => {
  initConfigProvisional();
  const provisionalSource = getConfigMeta().source;
  finalizeConfig([]);
  const meta = getConfigMeta();
  assert.equal(meta.previousSource, provisionalSource);
  assert.equal(meta.phase, 'final');
});

// ── initConfig compat ──────────────────────────────────────────────────────────

test('initConfig sets phase to final directly', () => {
  initConfig([]);
  assert.equal(getConfigMeta().phase, 'final');
});

test('initConfig second call updates previousSource', () => {
  const a = makeTmp();
  const b = makeTmp();
  writeToml(a, 'szkrabok.config.toml', '[default]\nuserAgent = "AgentA"\n');
  writeToml(b, 'szkrabok.config.toml', '[default]\nuserAgent = "AgentB"\n');
  initConfig([a]);
  const srcA = getConfigMeta().source;
  initConfig([b]);
  const meta = getConfigMeta();
  assert.equal(meta.previousSource, srcA);
  assert.ok(meta.source.includes(b));
});

// ── explicitConfigPath ─────────────────────────────────────────────────────────

test('initConfigProvisional: explicitConfigPath takes priority over SZKRABOK_CONFIG env', () => {
  const dir = makeTmp();
  const explicit = join(dir, 'explicit.toml');
  const envFile = join(dir, 'env.toml');
  writeFileSync(explicit, '[default]\nuserAgent = "ExplicitAgent"\n');
  writeFileSync(envFile, '[default]\nuserAgent = "EnvAgent"\n');
  process.env.SZKRABOK_CONFIG = envFile;
  initConfigProvisional({ explicitConfigPath: explicit });
  const cfg = getConfig({ allowProvisional: true });
  assert.equal(cfg.userAgent, 'ExplicitAgent');
  delete process.env.SZKRABOK_CONFIG;
});

test('finalizeConfig: explicitConfigPath takes priority over roots', () => {
  const dir = makeTmp();
  const root = makeTmp();
  const explicit = join(dir, 'explicit.toml');
  writeFileSync(explicit, '[default]\nuserAgent = "ExplicitFinal"\n');
  writeToml(root, 'szkrabok.config.toml', '[default]\nuserAgent = "RootAgent"\n');
  initConfigProvisional();
  finalizeConfig([root], { explicitConfigPath: explicit });
  assert.equal(getConfig().userAgent, 'ExplicitFinal');
});

// ── Config object immutability ─────────────────────────────────────────────────

test('config object returned by getConfig is frozen', () => {
  initConfig([]);
  const cfg = getConfig();
  assert.ok(Object.isFrozen(cfg));
});

test('initConfigProvisional produces a frozen config object', () => {
  initConfigProvisional();
  const cfg = getConfig({ allowProvisional: true });
  assert.ok(Object.isFrozen(cfg));
});

// ── cwd bounded (§2) ──────────────────────────────────────────────────────────

test('cwd step does not walk up to parent directories', () => {
  const parent = makeTmp();
  const child = join(parent, 'subdir');
  mkdirSync(child, { recursive: true });
  writeToml(parent, 'szkrabok.config.toml', '[default]\nuserAgent = "ParentAgent"\n');

  const origCwd = process.cwd();
  process.chdir(child);
  try {
    initConfig([]);
    // parent toml must NOT be found via the cwd step (unbounded walk-up removed)
    assert.notEqual(getConfig().userAgent, 'ParentAgent');
  } finally {
    process.chdir(origCwd);
  }
});

test('cwd step finds toml in exactly cwd, not a parent', () => {
  const dir = makeTmp();
  writeToml(dir, 'szkrabok.config.toml', '[default]\nuserAgent = "CwdAgent"\n');

  const origCwd = process.cwd();
  process.chdir(dir);
  try {
    initConfig([]);
    assert.equal(getConfig().userAgent, 'CwdAgent');
  } finally {
    process.chdir(origCwd);
  }
});
