/**
 * PC-6 - real browser integration tests
 *
 * Launches a real Chromium-family browser with --remote-debugging-port=0.
 * Verifies DevToolsActivePort is written and the port is live.
 * Parameterised over all detected browser types.
 *
 * Requires at least one Chromium-family browser installed.
 * Individual browser describe blocks are skipped if binary not found.
 *
 * Run: node --test tests/node/runtime/pc-layer6.test.js
 *
 * Replaces: devtools-port.test.js (scaffolded, no PC identifiers)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import net from 'net';
import http from 'node:http';

// ── Helpers ───────────────────────────────────────────────────────────────────

const waitForFile = async (filePath, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await access(filePath); return; } catch { /* file not ready yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for: ${filePath}`);
};

const isPortOpen = (port, host = '127.0.0.1') =>
  new Promise(resolve => {
    const sock = net.createConnection({ port, host });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error',   () => resolve(false));
    sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
  });

const launchHeadlessBrowser = async executablePath => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'szkrabok-pc6-browser-'));
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
    // Retry rm - Chrome may still be releasing file locks after SIGKILL.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(userDataDir, { recursive: true, force: true });
        console.log('PC-6 cleanup step ' + (attempt + 1) + ': rm succeeded');
        return;
      } catch (e) {
        if (e.code !== 'ENOTEMPTY') throw e;
        console.log('PC-6 cleanup step ' + (attempt + 1) + ': ENOTEMPTY, retrying in 200ms...');
        await new Promise(r => setTimeout(r, 200));
      }
    }
    // Last attempt - let it throw if still locked.
    await rm(userDataDir, { recursive: true, force: true });
  };

  return { proc, userDataDir, cleanup };
};

// ── Browser discovery ─────────────────────────────────────────────────────────

// Use Playwright's bundled Chromium - same binary as e2e tests, guaranteed real.
// chrome-launcher is NOT used here: on Ubuntu it detects /usr/bin/chromium-browser
// which is a snap stub that exits immediately (see docs/bugs/bug1-chrome-launcher-problem.md).
const detectBrowsers = async () => {
  try {
    const { chromium } = await import('playwright');
    const { existsSync } = await import('fs');
    const pwPath = chromium.executablePath();
    let playwright;
    if (pwPath && existsSync(pwPath)) {
      playwright = pwPath;
    } else {
      playwright = null;
    }
    return { playwright: playwright };
  } catch {
    return { playwright: null };
  }
};

// ── Shared test body ──────────────────────────────────────────────────────────

const runPortTests = executablePath => {
  test('PC-6.1: Chromium writes DevToolsActivePort after launch', { timeout: 15_000 }, async () => {
    console.log('PC-6.1 step 1: launchHeadlessBrowser');
    const { userDataDir, cleanup } = await launchHeadlessBrowser(executablePath);
    const filePath = join(userDataDir, 'DevToolsActivePort');
    console.log('PC-6.1 step 2: waitForFile("' + filePath + '")');
    try {
      await waitForFile(filePath);
      console.log('PC-6.1 step 2: DevToolsActivePort file found');
    } finally {
      await cleanup();
    }
  });

  test('PC-6.2: readDevToolsPort parses port from live DevToolsActivePort', { timeout: 15_000 }, async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    console.log('PC-6.2 step 1: launchHeadlessBrowser');
    const { userDataDir, cleanup } = await launchHeadlessBrowser(executablePath);
    try {
      const filePath = join(userDataDir, 'DevToolsActivePort');
      console.log('PC-6.2 step 2: waitForFile("' + filePath + '")');
      await waitForFile(filePath);
      console.log('PC-6.2 step 3: readDevToolsPort("' + userDataDir + '")');
      const port = await readDevToolsPort(userDataDir);
      console.log('PC-6.2 step 3 returned port:', port, 'typeof:', typeof port);
      assert.strictEqual(typeof port, 'number');
      assert.ok(port > 0 && port < 65536, `port out of range: ${port}`);
    } finally {
      await cleanup();
    }
  });

  test('PC-6.3: port from DevToolsActivePort accepts TCP connections', { timeout: 15_000 }, async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    console.log('PC-6.3 step 1: launchHeadlessBrowser');
    const { userDataDir, cleanup } = await launchHeadlessBrowser(executablePath);
    try {
      const filePath = join(userDataDir, 'DevToolsActivePort');
      console.log('PC-6.3 step 2: waitForFile');
      await waitForFile(filePath);
      console.log('PC-6.3 step 3: readDevToolsPort');
      const port = await readDevToolsPort(userDataDir);
      console.log('PC-6.3 step 3 returned port:', port);
      console.log('PC-6.3 step 4: isPortOpen(' + port + ')');
      const open = await isPortOpen(port);
      console.log('PC-6.3 step 4 returned:', open);
      assert.ok(open, `CDP port ${port} is not accepting connections`);
    } finally {
      await cleanup();
    }
  });

  test('PC-6.4: GET /json on CDP port returns a valid JSON array', { timeout: 15_000 }, async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    console.log('PC-6.4 step 1: launchHeadlessBrowser');
    const { userDataDir, cleanup } = await launchHeadlessBrowser(executablePath);
    try {
      const filePath = join(userDataDir, 'DevToolsActivePort');
      console.log('PC-6.4 step 2: waitForFile');
      await waitForFile(filePath);
      console.log('PC-6.4 step 3: readDevToolsPort');
      const port = await readDevToolsPort(userDataDir);
      console.log('PC-6.4 step 3 returned port:', port);

      console.log('PC-6.4 step 4: http.get http://127.0.0.1:' + port + '/json');
      const parsed = await new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port, path: '/json' }, res => {
          console.log('PC-6.4 step 4: HTTP statusCode:', res.statusCode);
          console.log('PC-6.4 step 4: Content-Type:', res.headers['content-type']);
          // Accumulate chunks - handles both Content-Length and chunked Transfer-Encoding.
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            console.log('PC-6.4 step 4: body received, length =', body.length);
            console.log('PC-6.4 step 4: body preview =', body.slice(0, 200));
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(new Error(`Invalid JSON from /json: ${e.message}\n${body}`)); }
          });
        }).on('error', reject);
      });

      console.log('PC-6.4 step 5: assert Array.isArray(parsed), got:', Array.isArray(parsed), 'length:', parsed.length);
      assert.ok(Array.isArray(parsed), '/json must return an array');
      console.log('PC-6.4 step 6: assert parsed.length > 0');
      assert.ok(parsed.length > 0, '/json must return at least one target (the about:blank page)');
      for (const target of parsed) {
        console.log('PC-6.4 step 7: checking target id:', target.id, 'type:', target.type, 'ws:', target.webSocketDebuggerUrl);
        assert.ok(typeof target.id === 'string' && target.id.length > 0, 'each target needs a non-empty id');
        assert.ok(typeof target.type === 'string' && target.type.length > 0, 'each target needs a non-empty type');
        assert.ok(
          typeof target.webSocketDebuggerUrl === 'string' &&
          target.webSocketDebuggerUrl.startsWith('ws://'),
          'each target needs a ws:// webSocketDebuggerUrl'
        );
      }
      console.log('PC-6.4 step 7: all targets valid');
    } finally {
      await cleanup();
    }
  });

  test('PC-6.5: two simultaneous launches get different ports', { timeout: 20_000 }, async () => {
    const { readDevToolsPort } = await import('../../../packages/runtime/storage.js');
    console.log('PC-6.5 step 1: launch two browsers concurrently');
    const [a, b] = await Promise.all([
      launchHeadlessBrowser(executablePath),
      launchHeadlessBrowser(executablePath),
    ]);
    try {
      console.log('PC-6.5 step 2: wait for both DevToolsActivePort files');
      await Promise.all([
        waitForFile(join(a.userDataDir, 'DevToolsActivePort')),
        waitForFile(join(b.userDataDir, 'DevToolsActivePort')),
      ]);
      console.log('PC-6.5 step 3: readDevToolsPort for both');
      const portA = await readDevToolsPort(a.userDataDir);
      const portB = await readDevToolsPort(b.userDataDir);
      console.log('PC-6.5 step 3: portA =', portA, 'portB =', portB);
      console.log('PC-6.5 step 4: assert portA !== portB');
      assert.notStrictEqual(portA, portB, 'concurrent launches must receive distinct ports');
    } finally {
      await Promise.allSettled([a.cleanup(), b.cleanup()]);
    }
  });
};

// ── Per-browser describe blocks ───────────────────────────────────────────────

const browsers = await detectBrowsers();

describe('PC-6 DevToolsActivePort — Playwright bundled Chromium', { skip: !browsers.playwright }, () => {
  if (browsers.playwright) runPortTests(browsers.playwright);
});

if (!browsers.playwright) {
  describe('PC-6 DevToolsActivePort — no browser found', () => {
    test('PC-6.0: at least one browser must be found', () => {
      assert.fail('No Playwright Chromium found. Run: npx playwright install chromium');
    });
  });
}
