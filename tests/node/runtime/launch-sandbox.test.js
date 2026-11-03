/**
 * Q2 (claude-docker audit 20261031): chromiumSandbox at the launch
 * boundary. Playwright adds --no-sandbox unless chromiumSandbox is
 * true; szkrabok now defaults it on — a renderer exploit on the
 * host must not get the user's rights. A container deployment turns
 * it off via [browser] chromium_sandbox = false: the container is
 * the sandbox.
 *
 * Run: node --test tests/node/runtime/launch-sandbox.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initConfig } from '../../../packages/runtime/config.js';
import { _assembleLaunchOptions } from '../../../packages/runtime/launch.js';

let tmpDirs = [];
let savedEnv = {};

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
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  tmpDirs = [];
});

const withToml = (content, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'szkrabok-q2-'));
  tmpDirs.push(dir);
  writeFileSync(join(dir, 'szkrabok.config.toml'), content);
  initConfig([dir]);
  return fn();
};

describe('chromiumSandbox at the launch boundary', () => {
  test('defaults to true (the Q2 fix)', () => {
    withToml('# empty\n', () => {
      const opts = _assembleLaunchOptions({ browserEngine: 'chromium' });
      assert.equal(opts.chromiumSandbox, true);
    });
  });

  test('an explicit false wins (a container is its own sandbox)', () => {
    withToml('# empty\n', () => {
      const opts = _assembleLaunchOptions({ chromiumSandbox: false });
      assert.equal(opts.chromiumSandbox, false);
    });
  });

  test('[browser] chromium_sandbox = false turns it off', () => {
    withToml('[browser]\nchromium_sandbox = false\n', () => {
      const opts = _assembleLaunchOptions({});
      assert.equal(opts.chromiumSandbox, false);
    });
  });

  test('Firefox drops the Chromium-only option', () => {
    withToml('# empty\n', () => {
      const opts = _assembleLaunchOptions({ browserEngine: 'firefox', chromiumSandbox: true });
      assert.equal(opts.chromiumSandbox, undefined);
    });
  });
});
