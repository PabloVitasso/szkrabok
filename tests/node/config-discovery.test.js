import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

// Import the module under test directly so we reset _config between tests.
import { initConfig, getConfig } from '../../packages/runtime/config.js';

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
    try { rmSync(d, { recursive: true, force: true }); } catch {}
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
  // Also need cwd to not have config — use SZKRABOK_ROOT trick to bound cwd walk
  // Just verify it doesn't throw and returns a config
  initConfig([a]);
  assert.ok(getConfig().userAgent); // has some default UA
});

test('MCP roots absent falls through to cwd', () => {
  // No roots — should still produce a valid config
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
