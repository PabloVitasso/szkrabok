/**
 * Shared helpers for the claude-docker hardening suite.
 * Spec: docs/features/20261024-claude-docker-hardening-proposal.md
 *
 * The suite is written ahead of the implementation (TDD). Modules that do not
 * exist yet load as a Proxy that fails each test with "not implemented",
 * so one missing module does not hide the other tests in the same file.
 */

import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SERVER_PATH = join(REPO_ROOT, 'src/index.js');

// ── module loading ────────────────────────────────────────────────────────────

/**
 * Import a repo module by repo-relative path. If it cannot be loaded, return a
 * Proxy whose every property access throws, naming the module and the design
 * section that introduces it.
 */
export const load = async (rel, section) => {
  try {
    return await import(pathToFileURL(join(REPO_ROOT, rel)).href);
  } catch (err) {
    return new Proxy(
      {},
      {
        get: (_, prop) => {
          if (prop === 'then') return undefined; // not a thenable
          throw new Error(
            `not implemented: ${rel} (${section}) — export "${String(prop)}"; load error: ${err.message}`
          );
        },
      }
    );
  }
};

// ── temp dirs ─────────────────────────────────────────────────────────────────

export const tmpTracker = () => {
  const dirs = [];
  return {
    // realpath'd so tests compare against the same form confinePath returns
    make: (prefix = 'szk-hard-') => {
      const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
      dirs.push(d);
      return d;
    },
    cleanup: () => {
      for (const d of dirs.splice(0)) {
        try {
          rmSync(d, { recursive: true, force: true });
        } catch (e) {
          console.warn('[cleanup] rmSync failed:', e.message);
        }
      }
    },
  };
};

// ── error shape ───────────────────────────────────────────────────────────────

/** assert.throws matcher for a structured szkrabok error with the given code. */
export const withCode = (code, messagePart) => err => {
  if (err?.code !== code) {
    throw new Error(`expected error code ${code}, got ${err?.code}: ${err?.message}`);
  }
  if (messagePart && !String(err.message).includes(messagePart)) {
    throw new Error(`expected message to include "${messagePart}", got: ${err.message}`);
  }
  return true;
};

// ── MCP server over stdio ─────────────────────────────────────────────────────

/**
 * Spawn src/index.js as an MCP server with the given szkrabok flags.
 * Returns { client, callTool, close }. callTool returns { isError, body }
 * with body = parsed JSON of the first text content.
 */
const ISOLATED_ENV_KEYS = [
  'SZKRABOK_CONFIG',
  'SZKRABOK_ROOT',
  'SZKRABOK_SESSIONS_DIR',
  'NODE_OPTIONS',
];

/** process.env without the keys that would leak the developer's config into the server. */
export const isolatedEnv = (extra = {}) => {
  const env = { ...process.env };
  for (const k of ISOLATED_ENV_KEYS) delete env[k];
  return { ...env, ...extra };
};

export const spawnServer = async ({ flags = [], cwd, env = {}, roots = null } = {}) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH, ...flags],
    cwd,
    env: isolatedEnv(env),
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'szkrabok-hardening-test', version: '1.0.0' },
    { capabilities: roots ? { roots: { listChanged: false } } : {} }
  );

  if (roots) {
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: roots.map(p => ({ uri: `file://${p}`, name: p })),
    }));
  }

  await client.connect(transport);
  // let oninitialized → listRoots → finalizeConfig complete
  await new Promise(r => setTimeout(r, 300));

  const callTool = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content?.[0]?.text ?? 'null';
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    return { isError: !!res.isError, body };
  };

  return {
    client,
    callTool,
    close: async () => {
      await callTool('session_manage', { action: 'list' })
        .then(({ body }) =>
          Promise.all(
            (body.sessions ?? [])
              .filter(s => s.active)
              .map(s => callTool('session_manage', { action: 'close', sessionName: s.id }))
          )
        )
        .catch(() => {});
      await client.close().catch(() => {});
    },
  };
};

/**
 * Start the server expecting it to refuse startup. Resolves with
 * { code, stderr } once the process exits; rejects if it is still running
 * after `timeoutMs`.
 */
export const expectStartupFailure = async ({ flags = [], cwd, timeoutMs = 5000 } = {}) => {
  const { spawn } = await import('node:child_process');
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [SERVER_PATH, ...flags], {
      cwd,
      env: isolatedEnv(),
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', d => (stderr += d));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectP(
        new Error(`server did not refuse startup within ${timeoutMs}ms (flags: ${flags.join(' ')})`)
      );
    }, timeoutMs);
    child.once('exit', code => {
      clearTimeout(timer);
      resolveP({ code, stderr });
    });
  });
};

// ── browser availability ──────────────────────────────────────────────────────

/** Path to a launchable Chromium, or null. Browser-level tests skip on null. */
export const findBrowser = async () => {
  const { initConfig, findChromiumPath } = await import('../../../packages/runtime/config.js');
  initConfig([]);
  return findChromiumPath();
};
