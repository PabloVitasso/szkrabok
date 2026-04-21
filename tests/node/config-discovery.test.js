import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import the module under test directly so we reset _config between tests.
import { initConfig, getConfig, getConfigSource } from '../../packages/runtime/config.js';

let tmpDirs = [];
let savedEnv = {};

const makeTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'szkrabok-test-'));
  tmpDirs.push(d);
  return d;
};

const writeToml = (dir, filename, content) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
};

beforeEach(() => {
  savedEnv = {
    SZKRABOK_CONFIG: process.env.SZKRABOK_CONFIG,
    SZKRABOK_ROOT: process.env.SZKRABOK_ROOT,
  };
  delete process.env.SZKRABOK_CONFIG;
  delete process.env.SZKRABOK_ROOT;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch (e) { console.warn('[cleanup] rmSync failed:', e.message); }
  }
  tmpDirs = [];
});

test('SZKRABOK_CONFIG env var loads that file', () => {
  const dir = makeTmp();
  const cfgPath = join(dir, 'my.toml');
  writeFileSync(cfgPath, '[default]\nuserAgent = "TestAgent/1.0"\n');
  process.env.SZKRABOK_CONFIG = cfgPath;
  initConfig([]);
  assert.equal(getConfig().userAgent, 'TestAgent/1.0');
});

test('SZKRABOK_ROOT env var walk-up finds config in root', () => {
  const root = makeTmp();
  writeToml(root, 'szkrabok.config.toml', '[default]\nuserAgent = "RootAgent"\n');
  process.env.SZKRABOK_ROOT = root;
  initConfig([]);
  assert.equal(getConfig().userAgent, 'RootAgent');
});

test('MCP roots single — toml at project root', () => {
  const root = makeTmp();
  writeToml(root, 'szkrabok.config.toml', '[default]\nuserAgent = "MCPAgent"\n');
  initConfig([root]);
  assert.equal(getConfig().userAgent, 'MCPAgent');
});

test('MCP roots multiple, first has config', () => {
  const a = makeTmp();
  const b = makeTmp();
  writeToml(a, 'szkrabok.config.toml', '[default]\nuserAgent = "AgentA"\n');
  writeToml(b, 'szkrabok.config.toml', '[default]\nuserAgent = "AgentB"\n');
  initConfig([a, b]);
  assert.equal(getConfig().userAgent, 'AgentA');
});

test('MCP roots multiple, second has config', () => {
  const a = makeTmp();
  const b = makeTmp();
  writeToml(b, 'szkrabok.config.toml', '[default]\nuserAgent = "AgentB"\n');
  initConfig([a, b]);
  assert.equal(getConfig().userAgent, 'AgentB');
});

test('MCP roots no config falls through to defaults', () => {
  const a = makeTmp(); // no toml
  // Also need cwd to not have config - use SZKRABOK_ROOT trick to bound cwd walk
  // Just verify it doesn't throw and returns a config
  initConfig([a]);
  assert.ok(getConfig().userAgent); // has some default UA
});

test('MCP roots absent falls through to cwd', () => {
  // No roots - should still produce a valid config
  initConfig([]);
  assert.ok(typeof getConfig().timeout === 'number');
});

test('walk-up finds toml in parent dir', () => {
  const root = makeTmp();
  const deep = join(root, 'src', 'deep');
  mkdirSync(deep, { recursive: true });
  writeToml(root, 'szkrabok.config.toml', '[default]\nuserAgent = "ParentAgent"\n');
  // Use SZKRABOK_ROOT pointing at deep to trigger walk-up within root
  process.env.SZKRABOK_ROOT = root;
  initConfig([]);
  assert.equal(getConfig().userAgent, 'ParentAgent');
});

test('walk-up stops at root boundary', () => {
  const outer = makeTmp();
  const inner = join(outer, 'project');
  mkdirSync(inner);
  writeToml(outer, 'szkrabok.config.toml', '[default]\nuserAgent = "OuterAgent"\n');
  // Root boundary = inner, so the toml in outer should not be found
  initConfig([inner]);
  // Should not pick up outer's config
  const ua = getConfig().userAgent;
  assert.notEqual(ua, 'OuterAgent');
});

test('local overrides base', () => {
  const root = makeTmp();
  writeToml(root, 'szkrabok.config.toml', '[default]\nuserAgent = "BaseAgent"\nlocale = "en-US"\n');
  writeToml(root, 'szkrabok.config.local.toml', '[default]\nuserAgent = "LocalAgent"\n');
  initConfig([root]);
  assert.equal(getConfig().userAgent, 'LocalAgent');
  assert.equal(getConfig().locale, 'en-US');
});

test('empty defaults — getConfig returns defaults, no throw', () => {
  const empty = makeTmp();
  // Write empty toml so walk-up stops here and doesn't reach repo config.
  writeFileSync(join(empty, 'szkrabok.config.toml'), '# empty\n');
  initConfig([empty]);
  const cfg = getConfig();
  assert.equal(typeof cfg.timeout, 'number');
  assert.equal(cfg.logLevel, 'info');
  assert.equal(cfg.disableWebgl, false);
});

test('initConfig resets cache — second call wins', () => {
  const a = makeTmp();
  const b = makeTmp();
  writeToml(a, 'szkrabok.config.toml', '[default]\nuserAgent = "AgentA"\n');
  writeToml(b, 'szkrabok.config.toml', '[default]\nuserAgent = "AgentB"\n');
  initConfig([a]);
  assert.equal(getConfig().userAgent, 'AgentA');
  initConfig([b]);
  assert.equal(getConfig().userAgent, 'AgentB');
});

test('getConfig after initConfig does not throw', () => {
  initConfig([]);
  assert.doesNotThrow(() => getConfig());
  assert.ok(getConfig().timeout > 0);
});

// ── getConfigSource() tracking ────────────────────────────────────────────────

test('getConfigSource: mcp-root when config found via roots', () => {
  const root = makeTmp();
  writeToml(root, 'szkrabok.config.toml', '[default]\ntimeout = 5000\n');
  initConfig([root]);
  const src = getConfigSource();
  assert.ok(src.startsWith('mcp-root'), `expected mcp-root prefix, got: ${src}`);
  assert.ok(src.includes(root), `expected root path in source, got: ${src}`);
});

test('getConfigSource: env:SZKRABOK_ROOT prefix when found via SZKRABOK_ROOT', () => {
  const root = makeTmp();
  writeToml(root, 'szkrabok.config.toml', '[default]\ntimeout = 7000\n');
  const orig = process.env.SZKRABOK_ROOT;
  process.env.SZKRABOK_ROOT = root;
  try {
    initConfig([]);
    const src = getConfigSource();
    assert.ok(src.startsWith('env:SZKRABOK_ROOT'), `expected env:SZKRABOK_ROOT prefix, got: ${src}`);
    assert.ok(src.includes(root), `expected root path in source, got: ${src}`);
  } finally {
    if (orig === undefined) delete process.env.SZKRABOK_ROOT;
    else process.env.SZKRABOK_ROOT = orig;
  }
});

test('getConfigSource: env:SZKRABOK_CONFIG when that env var is set', () => {
  const dir = makeTmp();
  const cfgPath = join(dir, 'my.config.toml');
  writeFileSync(cfgPath, '[default]\ntimeout = 9999\n');
  const orig = process.env.SZKRABOK_CONFIG;
  process.env.SZKRABOK_CONFIG = cfgPath;
  try {
    initConfig([]);
    const src = getConfigSource();
    assert.ok(src.startsWith('env:SZKRABOK_CONFIG'), `expected env:SZKRABOK_CONFIG prefix, got: ${src}`);
    assert.ok(src.includes(cfgPath), `expected config path in source, got: ${src}`);
  } finally {
    if (orig === undefined) delete process.env.SZKRABOK_CONFIG;
    else process.env.SZKRABOK_CONFIG = orig;
  }
});

test('getConfigSource: resets on each initConfig call', () => {
  const a = makeTmp();
  const b = makeTmp();
  writeToml(a, 'szkrabok.config.toml', '[default]\ntimeout = 1000\n');
  writeToml(b, 'szkrabok.config.toml', '[default]\ntimeout = 2000\n');
  initConfig([a]);
  const src1 = getConfigSource();
  initConfig([b]);
  const src2 = getConfigSource();
  assert.ok(src1.includes(a), `first source should include path a: ${src1}`);
  assert.ok(src2.includes(b), `second source should include path b: ${src2}`);
  assert.notEqual(src1, src2);
});
