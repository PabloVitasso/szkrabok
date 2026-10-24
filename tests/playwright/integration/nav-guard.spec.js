/**
 * Navigation guard, browser level (hardening proposal D7).
 *
 * Spawns its own server so the flags are explicit:
 *   strict  — no flags: page-sandbox browser_run, private destinations blocked
 *   control — --allow-private-net: the same actions must reach the local
 *             server, proving each strict check detects a real block and not
 *             a broken fixture
 *
 * The decisive signal is the hit count on a local HTTP server, not a failed
 * fetch: Chrome's Private Network Access can refuse public→private
 * subresource requests by itself. Top-level navigations are not subject to
 * that, so the navigation check isolates the guard.
 */

import { test, expect } from 'playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { initConfig, findChromiumPath } from '../../../packages/runtime/config.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVER_PATH = join(REPO_ROOT, 'src/index.js');

initConfig([]);
const EXECUTABLE_PATH = await findChromiumPath();
if (!EXECUTABLE_PATH)
  throw new Error('nav-guard.spec.js: no browser found — run szkrabok doctor install');

// Public page the strict server is allowed to open.
const PUBLIC_URL = 'http://example.com/';

// ── local target server ───────────────────────────────────────────────────────

let target;
let targetPort;
const hits = { http: [], upgrade: [] };

test.beforeAll(async () => {
  target = createServer((req, res) => {
    hits.http.push(req.url);
    res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' });
    res.end('<html><body><p>local target page content for the guard test</p></body></html>');
  });
  target.on('upgrade', (req, socket) => {
    hits.upgrade.push(req.url);
    socket.destroy();
  });
  await new Promise(r => target.listen(0, '127.0.0.1', r));
  targetPort = target.address().port;
});

test.afterAll(async () => {
  await new Promise(r => target.close(r));
});

const resetHits = () => {
  hits.http.length = 0;
  hits.upgrade.length = 0;
};

// ── server under test ─────────────────────────────────────────────────────────

const tmpDirs = [];

test.afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

const spawn = async flags => {
  const dir = mkdtempSync(join(tmpdir(), 'szkrabok-navguard-'));
  tmpDirs.push(dir);
  const cfg = join(dir, 'szkrabok.config.toml');
  writeFileSync(cfg, `[default]\nexecutablePath = ${JSON.stringify(EXECUTABLE_PATH)}\n`);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH, ...flags],
    cwd: dir,
    env: { ...process.env, SZKRABOK_CONFIG: cfg, SZKRABOK_ROOT: undefined },
  });
  const client = new Client({ name: 'nav-guard-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  await new Promise(r => setTimeout(r, 300));

  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    return { isError: !!res.isError, body: JSON.parse(res.content[0].text) };
  };
  const sessions = [];
  const open = async url => {
    const sessionName = `guard-${randomUUID()}`;
    sessions.push(sessionName);
    const res = await call('session_manage', {
      action: 'open',
      sessionName,
      url,
      launchOptions: { headless: true },
    });
    expect(res.isError, JSON.stringify(res.body)).toBe(false);
    return sessionName;
  };
  const run = (sessionName, code) => call('browser_run', { sessionName, code });
  const close = async () => {
    for (const s of sessions)
      await call('session_manage', { action: 'close', sessionName: s }).catch(() => {});
    await client.close().catch(() => {});
  };
  return { call, open, run, close };
};

const settle = () => new Promise(r => setTimeout(r, 1500));

// ── strict posture ────────────────────────────────────────────────────────────

test.describe('nav guard — strict (no flags)', () => {
  test.describe.configure({ mode: 'serial' });
  let s;
  test.beforeAll(async () => {
    s = await spawn([]);
  });
  test.afterAll(async () => {
    await s.close();
  });

  test('page-initiated navigation to 127.0.0.1 never reaches the server', async () => {
    const name = await s.open(PUBLIC_URL);
    resetHits();
    await s.run(name, `() => { location.href = 'http://127.0.0.1:${targetPort}/nav'; return 1; }`);
    await settle();
    expect(hits.http).toEqual([]);
    const { body } = await s.run(name, '() => location.href');
    expect(String(body.result ?? '')).not.toContain(`127.0.0.1:${targetPort}`);
  });

  test('fetch and WebSocket to 127.0.0.1 never reach the server', async () => {
    const name = await s.open(PUBLIC_URL);
    resetHits();
    const fetchRes = await s.run(
      name,
      `() => fetch('http://127.0.0.1:${targetPort}/fetch').then(r => r.status).catch(() => 'blocked')`
    );
    const wsRes = await s.run(
      name,
      `() => new Promise(r => { const w = new WebSocket('ws://127.0.0.1:${targetPort}/ws');
         w.onopen = () => r('open'); w.onerror = () => r('blocked'); w.onclose = () => r('blocked');
         setTimeout(() => r('timeout'), 5000); })`
    );
    expect(fetchRes.body.result).toBe('blocked');
    expect(wsRes.body.result).not.toBe('open');
    expect(hits.http).toEqual([]);
    expect(hits.upgrade).toEqual([]);
  });

  test('page-initiated file: navigation never exposes the file', async () => {
    const name = await s.open(PUBLIC_URL);
    await s.run(name, `() => { location.href = 'file:///etc/hostname'; return 1; }`);
    await settle();
    const { body } = await s.run(name, '() => location.href');
    expect(String(body.result ?? '')).not.toMatch(/^file:/);
    const scrape = await s.call('browser_scrape', { sessionName: name });
    expect(JSON.stringify(scrape.body)).not.toContain('file:///etc/hostname');
  });

  test('Node-form code is refused in the page sandbox with a hint', async () => {
    const name = await s.open(PUBLIC_URL);
    const res = await s.run(name, '(page) => page.title()');
    expect(res.isError).toBe(true);
    expect(res.body.hint).toContain('--allow-node-code');
  });

  test('page-sandbox code runs in the page', async () => {
    const name = await s.open(PUBLIC_URL);
    const res = await s.run(name, '() => document.title');
    expect(res.isError, JSON.stringify(res.body)).toBe(false);
    expect(res.body.result).toBe('Example Domain');
  });
});

// ── positive control ──────────────────────────────────────────────────────────

test.describe('nav guard — control (--allow-private-net)', () => {
  test.describe.configure({ mode: 'serial' });
  let s;
  test.beforeAll(async () => {
    s = await spawn(['--allow-private-net']);
  });
  test.afterAll(async () => {
    await s.close();
  });

  test('the same navigation reaches the server', async () => {
    const name = await s.open(PUBLIC_URL);
    resetHits();
    await s.run(name, `() => { location.href = 'http://127.0.0.1:${targetPort}/nav'; return 1; }`);
    await settle();
    expect(hits.http).toContain('/nav');
  });

  test('same-origin fetch and WebSocket reach the server', async () => {
    const name = await s.open(`http://127.0.0.1:${targetPort}/start`);
    resetHits();
    await s.run(name, `() => fetch('/fetch').then(r => r.status)`);
    await s.run(
      name,
      `() => new Promise(r => { const w = new WebSocket('ws://127.0.0.1:${targetPort}/ws');
         w.onopen = w.onerror = w.onclose = () => r(1); setTimeout(() => r(0), 5000); })`
    );
    expect(hits.http).toContain('/fetch');
    expect(hits.upgrade).toContain('/ws');
  });

  test('scrape works on a private page when allowed', async () => {
    const name = await s.open(`http://127.0.0.1:${targetPort}/page`);
    const res = await s.call('browser_scrape', { sessionName: name });
    expect(res.isError, JSON.stringify(res.body)).toBe(false);
    expect(res.body.llmFriendly).toContain('local target page content');
  });

  test('the scheme block still applies', async () => {
    const res = await s.call('session_manage', {
      action: 'open',
      sessionName: `guard-${randomUUID()}`,
      url: 'file:///etc/hostname',
    });
    expect(res.body.code).toBe('URL_BLOCKED');
  });
});
