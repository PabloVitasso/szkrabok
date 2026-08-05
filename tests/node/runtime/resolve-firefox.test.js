/**
 * Firefox binary resolution tests (resolveFirefox)
 *
 * Run: node --test tests/node/runtime/resolve-firefox.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveFirefox } from '../../../packages/runtime/resolve.js';

let tmpRoot;
let savedEnv;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'szkrabok-firefox-'));
  savedEnv = { INVISIBLE_PLAYWRIGHT_BINARY: process.env.INVISIBLE_PLAYWRIGHT_BINARY };
  delete process.env.INVISIBLE_PLAYWRIGHT_BINARY;
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const makeExecutable = (dir, name = 'firefox') => {
  const p = join(dir, name);
  writeFileSync(p, '#!/bin/sh\necho "Firefox 150.0.1"');
  chmodSync(p, 0o755);
  return p;
};

test('INVISIBLE_PLAYWRIGHT_BINARY env var takes priority over cache', async () => {
  const bin = makeExecutable(tmpRoot);
  process.env.INVISIBLE_PLAYWRIGHT_BINARY = bin;
  const result = await resolveFirefox({ cacheDir: tmpRoot });
  assert.equal(result.found, true);
  assert.equal(result.path, bin);
  assert.equal(result.source, 'env');
});

test('picks lexicographically latest firefox-N dir from cache', async () => {
  const v5 = join(tmpRoot, 'firefox-5');
  const v7 = join(tmpRoot, 'firefox-7');
  mkdirSync(v5); mkdirSync(v7);
  makeExecutable(v5);
  makeExecutable(v7);
  const result = await resolveFirefox({ cacheDir: tmpRoot });
  assert.equal(result.found, true);
  assert.ok(result.path.includes('firefox-7'), `expected firefox-7, got ${result.path}`);
  assert.equal(result.source, 'invisiblePlaywright');
});

test('falls back to system firefox when cache empty', async () => {
  const systemBin = makeExecutable(tmpRoot, 'firefox-system');
  const result = await resolveFirefox({ cacheDir: tmpRoot, which: () => systemBin });
  assert.equal(result.found, true);
  assert.equal(result.path, systemBin);
  assert.equal(result.source, 'system');
});

test('returns not-found with checked paths listed when all miss', async () => {
  const result = await resolveFirefox({ cacheDir: tmpRoot, which: () => null });
  assert.equal(result.found, false);
  assert.ok(Array.isArray(result.checked));
  assert.ok(result.checked.length > 0, 'checked array must list attempted paths');
});

test('env var pointing at non-existent file falls through to cache', async () => {
  process.env.INVISIBLE_PLAYWRIGHT_BINARY = join(tmpRoot, 'does-not-exist');
  const v7 = join(tmpRoot, 'firefox-7');
  mkdirSync(v7);
  makeExecutable(v7);
  const result = await resolveFirefox({ cacheDir: tmpRoot });
  assert.equal(result.found, true);
  assert.equal(result.source, 'invisiblePlaywright');
});

test('config executablePath takes priority 0 above env var', async () => {
  const configBin = makeExecutable(tmpRoot, 'firefox-config');
  const envBin    = makeExecutable(tmpRoot, 'firefox-env');
  process.env.INVISIBLE_PLAYWRIGHT_BINARY = envBin;
  const result = await resolveFirefox({ cacheDir: tmpRoot, executablePath: configBin });
  assert.equal(result.found, true);
  assert.equal(result.path, configBin);
  assert.equal(result.source, 'config');
});

test('config executablePath falls through to cache when path does not exist', async () => {
  const v7 = join(tmpRoot, 'firefox-7');
  mkdirSync(v7);
  makeExecutable(v7);
  const result = await resolveFirefox({
    cacheDir:       tmpRoot,
    executablePath: join(tmpRoot, 'does-not-exist'),
    which:          () => null,
  });
  assert.equal(result.found, true);
  assert.equal(result.source, 'invisiblePlaywright');
});
