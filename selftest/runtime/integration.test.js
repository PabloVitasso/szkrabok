/**
 * Phase 5.2 — Runtime integration tests.
 *
 * Launches a real browser (headless). Requires Playwright Chromium installed.
 *
 * Run:
 *   HEADLESS=true node --test selftest/runtime/integration.test.js
 *
 * Tests:
 * - Cookie set in run #1 is present in run #2 (state persistence)
 * - Profile directory path is identical between runs
 * - state.json reflects cookie changes after close
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const PROFILE = 'integration-test-profile';
const TEST_COOKIE = { name: 'szkrabok_test', value: 'persistence_ok', domain: 'example.com', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' };

let tmpSessionsDir;

before(async () => {
  tmpSessionsDir = await mkdtemp(join(tmpdir(), 'szkrabok-integration-'));
  process.env.SZKRABOK_SESSIONS_DIR = tmpSessionsDir;
  process.env.HEADLESS = 'true';
});

after(async () => {
  delete process.env.SZKRABOK_SESSIONS_DIR;
  delete process.env.HEADLESS;
  await rm(tmpSessionsDir, { recursive: true }).catch(() => {});
});

describe('session persistence across launch/close cycles', () => {
  test('run 1: launch, add cookie, close', { timeout: 30_000 }, async () => {
    const { launch } = await import('../../packages/runtime/index.js');

    const handle = await launch({ profile: PROFILE, reuse: false });

    try {
      // Navigate so we have a real origin for cookies
      await handle.context.pages()[0].goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await handle.context.addCookies([TEST_COOKIE]);

      const state = await handle.context.storageState();
      const found = state.cookies.find(c => c.name === TEST_COOKIE.name);
      assert.ok(found, 'Cookie was set in context');
    } finally {
      await handle.close();
    }
  });

  test('run 2: relaunch same profile, cookie is restored', { timeout: 30_000 }, async () => {
    const { launch } = await import('../../packages/runtime/index.js');
    const storage = await import('../../packages/runtime/storage.js');

    // Verify state.json was written by run 1
    const savedState = await storage.loadState(PROFILE);
    assert.ok(savedState, 'state.json written after run 1 close');
    const savedCookie = savedState.cookies?.find(c => c.name === TEST_COOKIE.name);
    assert.ok(savedCookie, 'Cookie present in state.json');

    const handle = await launch({ profile: PROFILE, reuse: false });

    try {
      // Navigate to establish origin
      await handle.context.pages()[0].goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 20_000 });

      const state = await handle.context.storageState();
      const restored = state.cookies.find(c => c.name === TEST_COOKIE.name);
      assert.ok(restored, 'Cookie restored in run 2');
      assert.strictEqual(restored.value, TEST_COOKIE.value);
    } finally {
      await handle.close();
    }
  });

  test('profile directory path is identical between runs', async () => {
    const storage = await import('../../packages/runtime/storage.js');
    const dir1 = storage.getUserDataDir(PROFILE);
    const dir2 = storage.getUserDataDir(PROFILE);
    assert.strictEqual(dir1, dir2);
  });
});
