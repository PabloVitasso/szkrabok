/**
 * DevToolsActivePort integration tests.
 *
 * Launches a real browser (headless) with --remote-debugging-port=0.
 * Verifies Chromium writes DevToolsActivePort and that the port is live.
 * Runs against every browser type detected on the system.
 *
 * Run: node --test tests/node/runtime/devtools-port.test.js
 *
 * Requires at least one Chromium-family browser installed.
 * Tests for a given browser type are skipped if not found.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import net from 'net';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Poll until a file appears, or throw on timeout.
 */
const waitForFile = async (filePath, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await access(filePath); return; } catch { /* file not ready yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for: ${filePath}`);
};

/**
 * Attempt a TCP connection. Returns true if port is accepting.
 */
const isPortOpen = (port, host = '127.0.0.1') =>
  new Promise(resolve => {
    const sock = net.createConnection({ port, host });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
  });

/**
 * Launch a browser with --remote-debugging-port=0 and return { proc, userDataDir, cleanup }.
 * cleanup() kills the process and removes the temp dir.
 */
const launchHeadlessBrowser = async executablePath => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'szkrabok-devtools-test-'));

  const proc = spawn(executablePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
  ], { stdio: 'ignore', detached: false });

  const cleanup = async () => {
    try { proc.kill('SIGKILL'); } catch { /* process already gone */ }
    await rm(userDataDir, { recursive: true, force: true });
  };

  return { proc, userDataDir, cleanup };
};

// ── Browser discovery ─────────────────────────────────────────────────────────

/**
 * Find all installed Chromium-family browsers.
 * Returns { chrome: string|null, chromium: string|null }
 *
 * chrome   — any path containing "google-chrome" or "google/chrome"
 * chromium — any path containing "chromium"
 */
const detectBrowsers = async () => {
  try {
    const { Launcher } = await import('chrome-launcher');
    const all = await Launcher.getInstallations();

    let chrome;
    const chromeMatch = all.find(p => /google.chrome|google\/chrome/i.test(p));
    if (chromeMatch) {
      chrome = chromeMatch;
    } else {
      chrome = null;
    }
    let chromium;
    const chromiumMatch = all.find(p => /chromium/i.test(p));
    if (chromiumMatch) {
      chromium = chromiumMatch;
    } else {
      chromium = null;
    }
    return { chrome: chrome, chromium: chromium };
  } catch {
    return { chrome: null, chromium: null };
  }
};

// ── Shared test body ──────────────────────────────────────────────────────────

/**
 * Run all DevToolsActivePort assertions against a given executable.
 * Called once per browser type inside its own describe block.
 */
const runPortTests = executablePath => {
  test('Chromium writes DevToolsActivePort after launch', { timeout: 15_000 }, async () => {
    const { userDataDir, cleanup } = await launchHeadlessBrowser(executablePath);

    try {
      await waitForFile(join(userDataDir, 'DevToolsActivePort'));
    } finally {
      await cleanup();
    }
  });

  test('readDevToolsPort parses port from file', { timeout: 15_000 }, async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    const { userDataDir, cleanup } = await launchHeadlessBrowser(executablePath);

    try {
      await waitForFile(join(userDataDir, 'DevToolsActivePort'));
      const port = await readDevToolsPort(userDataDir);

      assert.strictEqual(typeof port, 'number');
      assert.ok(port > 0 && port < 65536, `port out of range: ${port}`);
    } finally {
      await cleanup();
    }
  });

  test('port from DevToolsActivePort is actually listening', { timeout: 15_000 }, async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    const { userDataDir, cleanup } = await launchHeadlessBrowser(executablePath);

    try {
      await waitForFile(join(userDataDir, 'DevToolsActivePort'));
      const port = await readDevToolsPort(userDataDir);

      const open = await isPortOpen(port);
      assert.ok(open, `CDP port ${port} is not accepting connections`);
    } finally {
      await cleanup();
    }
  });

  test('CDP /json responds with valid JSON array', { timeout: 15_000 }, async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    const { userDataDir, cleanup } = await launchHeadlessBrowser(executablePath);

    try {
      await waitForFile(join(userDataDir, 'DevToolsActivePort'));
      const port = await readDevToolsPort(userDataDir);

      // Minimal HTTP fetch — avoid importing undici or node-fetch just for this.
      const body = await new Promise((resolve, reject) => {
        const req = net.createConnection({ port, host: '127.0.0.1' });
        let buf = '';
        req.once('connect', () => {
          req.write('GET /json HTTP/1.0\r\nHost: localhost\r\n\r\n');
        });
        req.on('data', d => { buf += d; });
        req.once('end', () => resolve(buf));
        req.once('error', reject);
        req.setTimeout(5000, () => reject(new Error('timeout')));
      });

      // HTTP response must contain a JSON body starting after the blank line.
      const bodyStart = body.indexOf('\r\n\r\n');
      assert.ok(bodyStart !== -1, 'HTTP response has no header/body separator');
      const json = body.slice(bodyStart + 4).trim();
      const parsed = JSON.parse(json);
      assert.ok(Array.isArray(parsed), '/json must return an array');
    } finally {
      await cleanup();
    }
  });

  test('two simultaneous launches get different ports', { timeout: 20_000 }, async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');

    const [a, b] = await Promise.all([
      launchHeadlessBrowser(executablePath),
      launchHeadlessBrowser(executablePath),
    ]);

    try {
      await Promise.all([
        waitForFile(join(a.userDataDir, 'DevToolsActivePort')),
        waitForFile(join(b.userDataDir, 'DevToolsActivePort')),
      ]);

      const portA = await readDevToolsPort(a.userDataDir);
      const portB = await readDevToolsPort(b.userDataDir);

      assert.notStrictEqual(portA, portB, 'concurrent launches must receive distinct ports');
    } finally {
      await Promise.allSettled([a.cleanup(), b.cleanup()]);
    }
  });
};

// ── Per-browser describe blocks ───────────────────────────────────────────────

const browsers = await detectBrowsers();

describe('DevToolsActivePort — standard Chrome', { skip: !browsers.chrome }, () => {
  runPortTests(browsers.chrome);
});

describe('DevToolsActivePort — Chromium / ungoogled', { skip: !browsers.chromium }, () => {
  runPortTests(browsers.chromium);
});

// Fallback: if chrome-launcher found neither, try Playwright bundled binary.
if (!browsers.chrome && !browsers.chromium) {
  describe('DevToolsActivePort — Playwright bundled Chromium', async () => {
    let playwrightPath = null;

    try {
      const { chromium } = await import('playwright');
      const p = chromium.executablePath();
      const { existsSync } = await import('fs');
      if (p && existsSync(p)) playwrightPath = p;
    } catch { /* executablePath check failed — use default */ }

    test('at least one browser must be found to run port tests', {
      skip: !!playwrightPath,
    }, () => {
      assert.fail('No Chromium-family browser found. Install one to run these tests.');
    });

    if (playwrightPath) runPortTests(playwrightPath);
  });
}
