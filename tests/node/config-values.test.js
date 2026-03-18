import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initConfig, getConfig, resolvePreset, getPresets } from '../../packages/runtime/config.js';

let tmpDirs = [];
let savedEnv = {};

const makeTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'szkrabok-vals-'));
  tmpDirs.push(d);
  return d;
};

beforeEach(() => {
  savedEnv = { SZKRABOK_CONFIG: process.env.SZKRABOK_CONFIG, SZKRABOK_ROOT: process.env.SZKRABOK_ROOT };
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

// Isolate from repo config: write an empty toml so discovery stops at this dir.
const isolated = (fn) => {
  const dir = makeTmp();
  writeFileSync(join(dir, 'szkrabok.config.toml'), '# empty\n');
  initConfig([dir]);
  return fn();
};

const withTmpToml = (content, fn) => {
  const dir = makeTmp();
  writeFileSync(join(dir, 'szkrabok.config.toml'), content);
  initConfig([dir]);
  return fn();
};

test('defaults when toml is empty', () => {
  isolated(() => {
  const cfg = getConfig();
  assert.equal(cfg.timeout, 30000);
  assert.equal(cfg.logLevel, 'info');
  assert.equal(cfg.disableWebgl, false);
  assert.ok(cfg.userAgent.includes('Mozilla'));
  assert.deepEqual(cfg.viewport, { width: 1280, height: 800 });
  assert.equal(cfg.locale, 'en-US');
  assert.equal(cfg.timezone, 'America/New_York');
  assert.equal(cfg.stealthEnabled, true);
  });
});

test('TOML values map to config fields', () => {
  withTmpToml(`
[default]
timeout = 60000
log_level = "debug"
disable_webgl = true
userAgent = "CustomBot/2"
locale = "fr-FR"
timezone = "Europe/Paris"
`, () => {
    const cfg = getConfig();
    assert.equal(cfg.timeout, 60000);
    assert.equal(cfg.logLevel, 'debug');
    assert.equal(cfg.disableWebgl, true);
    assert.equal(cfg.userAgent, 'CustomBot/2');
    assert.equal(cfg.locale, 'fr-FR');
    assert.equal(cfg.timezone, 'Europe/Paris');
  });
});

test('resolvePreset returns chromium-honest for default', () => {
  isolated(() => {
    const p = resolvePreset('default');
    assert.equal(p.preset, 'chromium-honest');
  });
});

test('resolvePreset returns named preset from toml', () => {
  withTmpToml(`
[default]
userAgent = "BaseUA"

[preset.mobile]
userAgent = "MobileUA"
locale = "en-GB"
`, () => {
    const p = resolvePreset('mobile');
    assert.equal(p.preset, 'mobile');
    assert.equal(p.userAgent, 'MobileUA');
    assert.equal(p.locale, 'en-GB');
  });
});

test('resolvePreset falls back to base for unknown name', () => {
  withTmpToml('[default]\nuserAgent = "BaseUA"\n', () => {
    const p = resolvePreset('nonexistent');
    assert.equal(p.preset, 'chromium-honest');
  });
});

test('getPresets returns array of preset names', () => {
  withTmpToml(`
[preset.mobile]
userAgent = "MobileUA"
[preset.desktop]
userAgent = "DesktopUA"
`, () => {
    const names = getPresets();
    assert.ok(names.includes('mobile'));
    assert.ok(names.includes('desktop'));
  });
});

test('stealth defaults are present', () => {
  isolated(() => {
  const cfg = getConfig();
  assert.ok(cfg.stealth['user-agent-override']);
  assert.ok(cfg.stealth['navigator.vendor']);
  assert.ok(cfg.stealth['webgl.vendor']);
  });
});
