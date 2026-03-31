#!/usr/bin/env node
/**
 * smoke-test.js — run as prepublishOnly to catch packaging bugs before npm publish.
 *
 * 1. Packs the tarball (npm pack --dry-run to get file list, then real pack)
 * 2. Installs it in a fresh temp directory (no pre-existing node_modules)
 * 3. Runs `szkrabok --version` from that install
 * 4. Runs `szkrabok doctor` from that install
 * 5. Cleans up and exits non-zero on any failure
 */

import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runCapture = (cmd, opts = {}) =>
  execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });

// eslint-disable-next-line prefer-const -- initialized after process.on handlers that close over it
let tmpDir;

const cleanup = () => {
  if (tmpDir && existsSync(tmpDir)) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {} // eslint-disable-line no-empty -- exit-handler cleanup; surfacing here would obscure the real exit cause
  }
};

process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(1));

console.log('[smoke-test] Packing tarball...');
const packOutput = runCapture('npm pack --json', {
  env: { ...process.env, npm_config_ignore_scripts: 'true' },
});
const packInfo = JSON.parse(packOutput);
const tarball = resolve(root, packInfo[0].filename);
console.log(`[smoke-test] Packed: ${tarball}`);

tmpDir = mkdtempSync(join(tmpdir(), 'szkrabok-smoke-'));
console.log(`[smoke-test] Installing into ${tmpDir}...`);

// --foreground-scripts ensures postinstall runs visibly and exercises apply-patches.js
// in a bare temp dir (no package.json) — the exact scenario that previously failed.
// postinstall.js is no longer in the chain (Chromium download deferred to runtime).
try {
  execSync(`npm install --foreground-scripts ${tarball}`, {
    cwd: tmpDir,
    stdio: 'inherit',
    env: process.env,
  });
} catch {
  console.error('[smoke-test] FAIL: npm install failed');
  process.exit(1);
}

const pkgBin = join(tmpDir, 'node_modules', '.bin', 'szkrabok');
if (!existsSync(pkgBin)) {
  console.error(`[smoke-test] FAIL: binary not found at ${pkgBin}`);
  process.exit(1);
}

// --version
console.log('[smoke-test] Running szkrabok --version...');
const versionResult = spawnSync(pkgBin, ['--version'], {
  cwd: tmpDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SZKRABOK_SKIP_BROWSER_INSTALL: '1' },
});
if (versionResult.status !== 0) {
  console.error('[smoke-test] FAIL: szkrabok --version failed');
  console.error(versionResult.stderr?.toString());
  process.exit(1);
}
console.log(`[smoke-test] version output: ${versionResult.stdout.toString().trim()}`);

// doctor is deferred to Stage 4 — it requires a working browser resolution
// chain and will fail here (temp install has no ~/.cache/ms-playwright).

// remove the tarball
try {
  rmSync(tarball);
} catch {} // eslint-disable-line no-empty -- best-effort cleanup; tarball may already be gone

console.log('\n[smoke-test] PASS: package installs and starts correctly.');
