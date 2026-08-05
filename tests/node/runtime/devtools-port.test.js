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
import { access } from 'fs/promises';
import { join } from 'path';
import net from 'net';
import { resolveTestBrowser, launchHeadlessBrowser } from './helpers.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Poll until a file appears, or throw on timeout.
 */
const waitForFile = async (filePath, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      /* file not ready yet */
    }
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
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
    sock.setTimeout(3000, () => {
      sock.destroy();
      resolve(false);
    });
  });

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

      // Use fetch() - do NOT use a raw net.createConnection with HTTP/1.0 or HTTP/1.1.
      // Verified manually (nc + Node net module):
      //   - HTTP/1.0: Playwright Chromium CDP server returns empty response (not supported).
      //   - HTTP/1.1 + Connection: close: server sends the full response (Content-Length present,
      //     data arrives in one chunk) but IGNORES Connection: close and never closes the socket,
      //     so the 'end' event never fires - raw TCP reads time out without a usable result.
      // fetch() handles HTTP/1.1 keep-alive correctly: reads Content-Length, returns the body,
      // and does not depend on the server closing the connection.
      const resp = await fetch(`http://127.0.0.1:${port}/json`);
      const parsed = await resp.json();
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

// ── Browser detection via szkrabok's own resolution pipeline ─────────────────

const browserPath = await resolveTestBrowser();

describe('DevToolsActivePort', { skip: !browserPath }, () => {
  runPortTests(browserPath);
});

if (!browserPath) {
  describe('DevToolsActivePort — no browser found', () => {
    test('at least one browser must be found to run port tests', () => {
      assert.fail('No browser found. Set CHROMIUM_PATH or run: npx playwright install chromium');
    });
  });
}
