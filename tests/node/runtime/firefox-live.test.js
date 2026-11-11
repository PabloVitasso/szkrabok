/**
 * Live browser integration tests — all engines.
 *
 * Launches real browser processes (headless). Each engine describe block is
 * skipped when the required binary is absent.
 *
 * Shared lifecycle tests (launch / navigate / close) run for every engine via
 * runLifecycleTests(). Engine-specific tests follow each shared block.
 *
 * Run: node --test tests/node/runtime/firefox-live.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir, homedir } from 'os';
import { createRequire } from 'module';

import { initConfig } from '../../../packages/runtime/config.js';
import { launch, checkBrowser, _resetGcForTesting } from '../../../packages/runtime/launch.js';
import { closeSession, getSession } from '../../../packages/runtime/sessions.js';
import { resolveFirefox } from '../../../packages/runtime/resolve.js';
import { EngineNotSupportedError } from '../../../packages/runtime/errors.js';
import { endpoint } from '../../../src/tools/szkrabok_session.js';

// ── binary locations ──────────────────────────────────────────────────────────
// System Firefox (/usr/bin/firefox) is excluded: on this system the kernel
// denies the usernamespace clone Playwright needs (CLONE_NEWPID EPERM).
// Chromium: walk cache for latest installed version (see resolve.js fallback).

const PW_CHROMIUM = join(homedir(), '.cache/ms-playwright/chromium-1254/chrome-linux64/chrome');
const PW_FIREFOX = join(homedir(), '.cache/ms-playwright/firefox-1572/firefox/firefox');
// invisible_playwright >=0.5.0 names cache dirs firefox-<N>_<version>_<build>
// instead of the old bare firefox-<N> — pinned to the currently fetched build.
// resolveFirefox() (see resolve.js) is the code path that must stay generic;
// this constant is deliberately pinned for reproducible test binaries.
const INV_FIREFOX = join(
  homedir(),
  '.cache/invisible-playwright/firefox-18_151.0_20260724001829/firefox'
);

const SKIP_PW_CHROME = !existsSync(PW_CHROMIUM);
const SKIP_PW = !existsSync(PW_FIREFOX);
// ── invisible_playwright engine seal ─────────────────────────────────────────
// The patched engine declares the playwright range it speaks in its seal:
// `invisible_core/seal.json` → "playwright": { "min", "max" }. The current
// series (invisible_core 61.62.0, engine firefox-61 / Firefox 159.0, build
// 20261110161904) declares max 1.61.0, while playwright-core 1.65.0 sends
// `Browser.setDownloadOptions.legacyInterceptor` — a field no engine in that
// range knows. The launch then dies with "Found property … legacyInterceptor -
// false which is not described in this scheme".
// Check with: python -m invisible_playwright version  (prints engine + seal)
// Raise MAX_SEALED_PLAYWRIGHT when upstream's seal admits a newer playwright,
// or force-run with SZKRABOK_RUN_INV_TESTS=1 after a `fetch`.
const MAX_SEALED_PLAYWRIGHT = '1.61.0';
const require = createRequire(import.meta.url);
const pwCoreDir = dirname(require.resolve('playwright-core/package.json'));
const pwCoreVersion = JSON.parse(readFileSync(join(pwCoreDir, 'package.json'), 'utf8')).version;
const semverGt = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
};
const INV_ENGINE_TOO_OLD =
  semverGt(pwCoreVersion, MAX_SEALED_PLAYWRIGHT) && !process.env.SZKRABOK_RUN_INV_TESTS;

const SKIP_INV = !existsSync(INV_FIREFOX);

// ── helpers ───────────────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'szkrabok-live-'));
  _resetGcForTesting();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  initConfig([]); // reset to chromium defaults
});

const withBrowserConfig = (engine, executablePath) => {
  // chromium_sandbox = false: tests exercise the launch plumbing,
  // not the sandbox. The bundled binaries ship no SUID sandbox
  // helper, and hosts that restrict unprivileged user namespaces
  // (Ubuntu 23.10+) abort a sandboxed launch. The default (on) is
  // covered by launch-sandbox.test.js. Firefox ignores the key.
  writeFileSync(
    join(tmpDir, 'szkrabok.config.toml'),
    [
      '[browser]',
      `engine = "${engine}"`,
      `executable_path = "${executablePath}"`,
      'chromium_sandbox = false',
    ].join('\n')
  );
  initConfig([tmpDir]);
};

// ── shared lifecycle tests ────────────────────────────────────────────────────
//
// Called inside each browser describe block. Avoids duplicating the same
// launch / navigate / close assertions for every engine.

const runLifecycleTests = ({ engine, hasCdp }) => {
  test('launch() opens a browser session', async () => {
    const profile = `live-launch-${engine}-${Date.now()}`;
    try {
      await launch({ profile, headless: true });
      const session = getSession(profile);
      assert.equal(session.browserEngine, engine);
      assert.equal(session.cdpPort, hasCdp ? session.cdpPort : null);
      if (hasCdp) assert.ok(session.cdpPort > 0, 'Chromium must have a CDP port');
      assert.ok(session.page, 'session must have a page');
    } finally {
      await closeSession(profile).catch(() => {});
    }
  });

  test('can navigate to about:blank', async () => {
    const profile = `live-nav-${engine}-${Date.now()}`;
    try {
      await launch({ profile, headless: true });
      const session = getSession(profile);
      await session.page.goto('about:blank');
      const url = await session.page.evaluate(() => document.location.href);
      assert.equal(url, 'about:blank');
    } finally {
      await closeSession(profile).catch(() => {});
    }
  });

  test('closeSession() closes cleanly', async () => {
    const profile = `live-close-${engine}-${Date.now()}`;
    await launch({ profile, headless: true });
    const result = await closeSession(profile);
    assert.equal(result.success, true);
    assert.throws(() => getSession(profile), /SESSION_NOT_FOUND|not found/i);
  });

  if (!hasCdp) {
    test('endpoint() throws EngineNotSupportedError', async () => {
      const profile = `live-endpoint-${engine}-${Date.now()}`;
      try {
        await launch({ profile, headless: true });
        await assert.rejects(
          () => endpoint({ sessionName: profile }),
          err => {
            assert.ok(err instanceof EngineNotSupportedError);
            assert.equal(err.code, 'ENGINE_NOT_SUPPORTED');
            return true;
          }
        );
      } finally {
        await closeSession(profile).catch(() => {});
      }
    });
  }
};

// ── Playwright bundled Chromium ───────────────────────────────────────────────

describe(
  'Playwright bundled Chromium (chromium-1254)',
  { timeout: 30_000, skip: SKIP_PW_CHROME },
  () => {
    beforeEach(() => withBrowserConfig('chromium', PW_CHROMIUM));

    test('checkBrowser() resolves the configured executable_path', async () => {
      const path = await checkBrowser();
      assert.equal(path, PW_CHROMIUM);
    });

    runLifecycleTests({ engine: 'chromium', hasCdp: true });
  }
);

// ── Playwright bundled Firefox ────────────────────────────────────────────────

describe(
  'Playwright bundled Firefox (firefox-1572, stock)',
  { timeout: 30_000, skip: SKIP_PW },
  () => {
    beforeEach(() => withBrowserConfig('firefox', PW_FIREFOX));

    test('checkBrowser() resolves the configured executable_path', async () => {
      const path = await checkBrowser();
      assert.equal(path, PW_FIREFOX);
    });

    runLifecycleTests({ engine: 'firefox', hasCdp: false });

    test('navigator.webdriver is true (stock Playwright Firefox, automation visible)', async () => {
      const profile = `live-baseline-wd-${Date.now()}`;
      try {
        await launch({ profile, headless: true });
        const session = getSession(profile);
        const webdriver = await session.page.evaluate(() => navigator.webdriver);
        assert.equal(
          webdriver,
          true,
          `stock Playwright Firefox must expose webdriver=true (got: ${webdriver})`
        );
      } finally {
        await closeSession(profile).catch(() => {});
      }
    });
  }
);

// ── invisible_playwright patched Firefox ──────────────────────────────────────

describe(
  'invisible_playwright patched Firefox (Firefox 151.0)',
  {
    timeout: 30_000,
    skip: SKIP_INV
      ? 'invisible_playwright binary not in cache'
      : INV_ENGINE_TOO_OLD
        ? `engine sealed to playwright <= ${MAX_SEALED_PLAYWRIGHT} (installed ${pwCoreVersion})`
        : false,
  },
  () => {
    beforeEach(() => withBrowserConfig('firefox', INV_FIREFOX));

    runLifecycleTests({ engine: 'firefox', hasCdp: false });

    test('navigator.webdriver is not true — patch suppresses automation flag', async () => {
      const profile = `live-inv-wd-${Date.now()}`;
      // invisible_playwright patches the binary so the flag is suppressed to false
      // (Playwright's own protocol prevents full removal to undefined, but false
      // is far less detectable than true for bot fingerprinting checks).
      try {
        await launch({ profile, headless: true });
        const session = getSession(profile);
        // session.page may be at about:newtab which has a CSP blocking eval.
        // Open a fresh page (about:blank has no CSP) to read navigator.webdriver.
        const page = await session.context.newPage();
        try {
          const webdriver = await page.evaluate(() => navigator.webdriver);
          assert.notEqual(
            webdriver,
            true,
            `navigator.webdriver must not be true for invisible_playwright Firefox (got: ${webdriver})`
          );
        } finally {
          await page.close().catch(() => {});
        }
      } finally {
        await closeSession(profile).catch(() => {});
      }
    });

    test('auto-detect: launch() uses invisible_playwright binary without explicit executable_path', async () => {
      // Config only sets engine, no executable_path — resolveFirefox should find cache
      writeFileSync(join(tmpDir, 'szkrabok.config.toml'), '[browser]\nengine = "firefox"\n');
      initConfig([tmpDir]);
      const profile = `live-inv-autodetect-${Date.now()}`;
      try {
        await launch({ profile, headless: true });
        const session = getSession(profile);
        assert.equal(session.browserEngine, 'firefox');
      } finally {
        await closeSession(profile).catch(() => {});
      }
    });
  }
);

// ── auto-detection ────────────────────────────────────────────────────────────

test(
  'resolveFirefox() auto-detects invisible_playwright binary from cache',
  { skip: SKIP_INV },
  async () => {
    const result = await resolveFirefox();
    assert.equal(result.found, true, `expected found=true, got: ${JSON.stringify(result)}`);
    assert.ok(
      result.path.includes('invisible-playwright'),
      `expected invisible-playwright path, got: ${result.path}`
    );
    assert.equal(result.source, 'invisiblePlaywright');
  }
);
