// @szkrabok/runtime — browser resolution
//
// Pure, injectable functions. No side effects in validateCandidate / resolveChromium.
// Production callers use buildCandidates() to construct the real candidate array.

import { statSync, accessSync, constants } from 'fs';
import { spawnSync } from 'node:child_process';

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validate a single candidate path.
 *
 * Two-level check: null/empty guard → stat (existence + isFile + broken-symlink) → execute bit.
 * One syscall on the hot path (statSync follows symlinks, no separate realpath needed).
 *
 * @param {string|null|undefined} path
 * @returns {{ ok: boolean, reason: string|null }}
 */
export const validateCandidate = (path) => {
  if (path === null || path === undefined) {
    return { ok: false, reason: 'not set' };
  }
  if (path === '') {
    return { ok: false, reason: 'empty path' };
  }

  // statSync follows symlinks. Broken symlink → ENOENT. Too many levels → ELOOP.
  // isFile() distinguishes regular files from dirs/sockets/etc.
  let stat;
  try {
    stat = statSync(path);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: false, reason: 'file not found' };
    }
    if (err.code === 'ELOOP') {
      return { ok: false, reason: 'broken symlink' };
    }
    return { ok: false, reason: `cannot stat path: ${err.code}` };
  }

  if (!stat.isFile()) {
    return { ok: false, reason: 'not a file' };
  }

  try {
    accessSync(path, constants.X_OK);
  } catch {
    return { ok: false, reason: 'not executable' };
  }

  return { ok: true, reason: null };
};

// ── Resolution ─────────────────────────────────────────────────────────────────

/**
 * Find first valid browser from candidate array.
 *
 * Short-circuit: stops at first valid candidate. Does NOT evaluate lower-priority
 * candidates. This is the "find browser" path used by checkBrowser().
 *
 * For full diagnostics (all candidates evaluated), use validateCandidate()
 * directly per entry — this is what `doctor` does.
 *
 * @param {Array<{source: string, path: string|null|undefined}>} candidates
 * @returns {{ found: true, path: string, source: string } | { found: false, candidates: Array<{source: string, path: string|null, ok: boolean, reason: string|null}> }}
 */
export const resolveChromium = (candidates) => {
  // Map once — no double-evaluation, no mutation, no unused vars
  const results = candidates.map(({ source, path }) => {
    const { ok, reason } = validateCandidate(path);
    return { source, path: path ?? null, ok, reason };
  });

  const winner = results.find(r => r.ok);
  if (winner) {
    return { found: true, path: winner.path, source: winner.source };
  }
  return { found: false, candidates: results };
};

// ── Discovery ─────────────────────────────────────────────────────────────────

const SOURCES = ['env', 'config', 'playwright', 'system'];

/**
 * Build candidate array from env, config, and system. Impure — reads env/config.
 * System and playwright entries are null; async probes populate them in callers.
 *
 * @param {{ executablePath?: string|null }} [config]
 * @returns {Array<{source: string, path: string|null}>}
 */
export const buildCandidates = (config = {}) => {
  const envPath = process.env.CHROMIUM_PATH ?? null;
  const cfgPath = config.executablePath ?? null;

  return SOURCES.map(source => {
    switch (source) {
      case 'env':        return { source, path: envPath };
      case 'config':     return { source, path: cfgPath };
      case 'system':     return { source, path: null };
      case 'playwright': return { source, path: null };
      default:           throw new Error(`buildCandidates: unknown source '${source}'`);
    }
  });
};

// ── Async discovery ────────────────────────────────────────────────────────────

/**
 * Test whether a path is a functional browser binary (not a snap wrapper stub).
 *
 * Probe: run `path --version` and check for exit 0 + non-empty stdout.
 * Scope: filters obvious stubs (shell scripts that exit 1, snap wrappers that
 * print nothing). Does NOT guarantee Playwright/CDP compatibility.
 *
 * @param {string} path
 * @returns {boolean}
 */
export const isFunctionalBrowser = (path) => {
  const r = spawnSync(path, ['--version'], {
    timeout: 5000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return r.status === 0 && r.stdout.trim().length > 0;
};

/**
 * Populate null system/playwright candidates via async probes.
 * Returns a new frozen array of frozen entries — does not mutate input.
 *
 * @param {Array<{source: string, path: string|null}>} candidates
 * @returns {Promise<ReadonlyArray<Readonly<{source: string, path: string|null}>>>}
 */
export const populateCandidates = async (candidates) => {
  const out = await Promise.all(candidates.map(async c => {
    let path = c.path;
    if (c.source === 'system' && path === null) {
      try {
        const { Launcher } = await import('chrome-launcher');
        const installs = await Launcher.getInstallations();
        for (const p of installs) {
          if (isFunctionalBrowser(p)) { path = p; break; }
        }
      } catch {
        // chrome-launcher unavailable
      }
    }
    if (c.source === 'playwright' && path === null) {
      try {
        const { chromium } = await import('playwright');
        path = chromium.executablePath();
      } catch {
        // playwright unavailable
      }
    }
    return Object.freeze({ ...c, path });
  }));
  return Object.freeze(out);
};
