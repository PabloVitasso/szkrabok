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
import { initConfig, userConfigDir } from '../../../packages/runtime/config.js';
import {
  _assembleLaunchOptions,
  applySandboxHint,
  sandboxFailureHint,
  SANDBOX_HINT_ANCHOR,
} from '../../../packages/runtime/launch.js';

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

describe('sandbox failure hint', () => {
  // Hosts that restrict unprivileged user namespaces abort with Chromium's own
  // message and no pointer to the opt-out. The hint names the key.
  test('appends the opt-out to Chromium sandbox failures', () => {
    const err = new Error('browserType.launchPersistentContext: Chromium sandboxing failed!');
    const out = applySandboxHint(err);
    assert.match(out.message, /Chromium sandboxing failed!/);
    assert.ok(out.message.includes(SANDBOX_HINT_ANCHOR), 'hint names the config key');
    assert.match(out.message, /--no-sandbox|\[browser\]/);
    assert.equal(out, err, 'same error object, same type and stack');
  });

  test('catches the other two Chromium sandbox texts', () => {
    for (const text of [
      'No usable sandbox!',
      'The SUID sandbox helper binary was found, but is not configured correctly',
    ]) {
      assert.ok(applySandboxHint(new Error(text)).message.includes(SANDBOX_HINT_ANCHOR), text);
    }
  });

  test('leaves unrelated launch errors untouched', () => {
    const err = new Error("Executable doesn't exist at /nope");
    assert.equal(applySandboxHint(err), err);
    assert.equal(err.message, "Executable doesn't exist at /nope");
  });

  test('is idempotent (retries cannot stack the hint)', () => {
    const err = new Error('Chromium sandboxing failed!');
    applySandboxHint(err);
    const once = err.message;
    applySandboxHint(err);
    assert.equal(err.message, once);
  });

  test('the hint names the resolved user config file and the docs section', () => {
    const hint = sandboxFailureHint();
    // Same rule as discovery step 5: XDG on Linux/macOS, %APPDATA% on Windows.
    assert.ok(hint.includes(join(userConfigDir(), 'config.toml')), 'resolved config path');
    assert.match(hint, /docs\/architecture\.md#chromium-sandbox/);
  });

  test('the hint stays platform-neutral outside Linux', () => {
    const hint = sandboxFailureHint();
    assert.ok(hint.includes('[browser]'), 'always says what the section is');
    if (process.platform !== 'linux') {
      assert.ok(!hint.includes('Ubuntu 23.10+'), 'no Linux-only advice elsewhere');
    }
  });
});
