/**
 * Firefox engine guard tests for MCP tools.
 *
 * Verifies that operations requiring CDP (endpoint lookup, run_test)
 * throw EngineNotSupportedError when the session uses Firefox.
 *
 * Uses pool.add() to inject fake Firefox sessions without a real browser.
 *
 * Run: node --test tests/node/firefox-engine-guard.test.js
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as pool from '../../packages/runtime/pool.js';
import * as storage from '../../packages/runtime/storage.js';
import { initConfig } from '../../packages/runtime/config.js';

// initConfig with empty roots so config is in final phase
initConfig([]);

const { EngineNotSupportedError } = await import('../../packages/runtime/errors.js');
const { endpoint, open, list } = await import('../../src/tools/szkrabok_session.js');
const { run_test } = await import('../../src/tools/szkrabok_browser.js');

// ── helpers ────────────────────────────────────────────────────────────────────

const SESSION_FF = 'ff-guard-test';

const fakePage = () => ({ isClosed: () => false });
const fakeContext = () => ({ _closed: false });

const addFirefoxSession = id => {
  pool.add(
    id,
    fakeContext(),
    fakePage(),
    null, // cdpPort = null for Firefox
    null, // preset
    null, // label
    false,
    null,
    null,
    null,
    null,
    null,
    'firefox'
  );
};

let tmpDir;

afterEach(() => {
  pool.remove(SESSION_FF);
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

// ── endpoint guard ─────────────────────────────────────────────────────────────

test('endpoint() throws EngineNotSupportedError for Firefox session', async () => {
  addFirefoxSession(SESSION_FF);

  await assert.rejects(
    () => endpoint({ sessionName: SESSION_FF }),
    err => {
      assert.ok(
        err instanceof EngineNotSupportedError,
        `expected EngineNotSupportedError, got ${err.constructor.name}: ${err.message}`
      );
      assert.equal(err.code, 'ENGINE_NOT_SUPPORTED');
      assert.equal(err.engine, 'firefox');
      return true;
    }
  );
});

// ── run_test guard ─────────────────────────────────────────────────────────────

test('run_test throws EngineNotSupportedError for Firefox session', async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'szkrabok-ff-guard-'));
  const configPath = join(tmpDir, 'playwright.config.js');
  writeFileSync(configPath, 'export default {};\n');

  addFirefoxSession(SESSION_FF);

  await assert.rejects(
    () => run_test({ sessionName: SESSION_FF, config: configPath }),
    err => {
      assert.ok(
        err instanceof EngineNotSupportedError,
        `expected EngineNotSupportedError, got ${err.constructor.name}: ${err.message}`
      );
      assert.equal(err.code, 'ENGINE_NOT_SUPPORTED');
      assert.equal(err.engine, 'firefox');
      return true;
    }
  );
});

// ── open response ──────────────────────────────────────────────────────────────

test('open() response includes browserEngine: firefox', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'szkrabok-ff-open-'));
  const profile = 'ff-open-resp-test';

  try {
    writeFileSync(join(dir, 'szkrabok.config.toml'), '[browser]\nengine = "firefox"\n');
    initConfig([dir]);

    const fakeCtx = {
      _closed: false,
      pages: () => [{ isClosed: () => false }],
      on: () => {},
      addCookies: async () => {},
      addInitScript: async () => {},
      storageState: async () => ({ cookies: [], origins: [] }),
      close: async () => {},
      browser: () => ({ process: () => null }),
    };

    const result = await open({
      sessionName: profile,
      launchOptions: { _launchImpl: async () => fakeCtx },
    });

    assert.equal(result.success, true);
    assert.equal(
      result.browserEngine,
      'firefox',
      'open response must include browserEngine: firefox'
    );
    assert.equal(result.cdpEndpoint, null, 'cdpEndpoint must be null for Firefox');
  } finally {
    pool.remove(profile);
    rmSync(dir, { recursive: true, force: true });
    initConfig([]);
  }
});

// ── list() response includes browserEngine ─────────────────────────────────────

test('list() includes browserEngine for active template session', async () => {
  const id = 'ff-list-template-test';
  try {
    await storage.ensureProfileDir(id);
    pool.add(
      id,
      fakeContext(),
      fakePage(),
      null,
      null,
      null,
      false,
      null,
      null,
      null,
      null,
      null,
      'firefox'
    );

    const result = await list();
    const entry = result.sessions.find(s => s.id === id);
    assert.ok(entry, `session ${id} must appear in list()`);
    assert.equal(
      entry.browserEngine,
      'firefox',
      'list() must include browserEngine: firefox for template'
    );
  } finally {
    pool.remove(id);
    await storage.deleteSession(id).catch(() => {});
  }
});

test('list() includes browserEngine for active clone session', async () => {
  const id = 'ff-list-clone-test';
  try {
    pool.add(
      id,
      fakeContext(),
      fakePage(),
      null,
      null,
      null,
      true,
      '/tmp/fake-clone-dir',
      'ff-template',
      null,
      null,
      null,
      'firefox'
    );

    const result = await list();
    const entry = result.sessions.find(s => s.id === id);
    assert.ok(entry, `clone ${id} must appear in list()`);
    assert.equal(
      entry.browserEngine,
      'firefox',
      'list() must include browserEngine: firefox for clone'
    );
  } finally {
    pool.remove(id);
  }
});
