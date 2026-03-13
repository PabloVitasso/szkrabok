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
import { join, resolve, dirname, relative } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
const runCapture = (cmd, opts = {}) =>
  execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });

let tmpDir;

const cleanup = () => {
  if (tmpDir && existsSync(tmpDir)) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
};

process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(1));

console.log('[smoke-test] Packing tarball...');
const packOutput = runCapture('npm pack --json', { env: { ...process.env, npm_config_ignore_scripts: 'true' } });
const packInfo = JSON.parse(packOutput);
const tarball = resolve(root, packInfo[0].filename);
console.log(`[smoke-test] Packed: ${tarball}`);

tmpDir = mkdtempSync(join(tmpdir(), 'szkrabok-smoke-'));
console.log(`[smoke-test] Installing into ${tmpDir}...`);

try {
  execSync(`npm install --ignore-scripts ${tarball}`, {
    cwd: tmpDir,
    stdio: 'inherit',
    env: { ...process.env, SZKRABOK_SKIP_BROWSER_INSTALL: '1' },
  });
} catch (err) {
  console.error('[smoke-test] FAIL: npm install failed');
  process.exit(1);
}

// Now run postinstall scripts manually so we control env
const pkgBin = join(tmpDir, 'node_modules', '.bin', 'szkrabok');
const pkgDir = join(tmpDir, 'node_modules', '@pablovitasso', 'szkrabok');
if (!existsSync(pkgBin)) {
  console.error(`[smoke-test] FAIL: binary not found at ${pkgBin}`);
  process.exit(1);
}

// Apply playwright-core patches via patch-package, then verify.
// Run from tmpDir so patch-package resolves playwright-core at tmpDir/node_modules/playwright-core.
// Use --patch-dir to point at the patches/ folder inside the installed package.
console.log('[smoke-test] Running patch-package...');
const patchResult = spawnSync(
  join(tmpDir, 'node_modules', '.bin', 'patch-package'),
  ['--patch-dir', relative(tmpDir, join(pkgDir, 'patches'))],
  { cwd: tmpDir, stdio: 'inherit' }
);
if (patchResult.status !== 0) {
  console.error('[smoke-test] FAIL: patch-package failed');
  process.exit(1);
}

console.log('[smoke-test] Verifying patches...');
const verifyResult = spawnSync(
  'node',
  [join(pkgDir, 'scripts', 'verify-playwright-patches.js')],
  { cwd: tmpDir, stdio: 'inherit' }
);
if (verifyResult.status !== 0) {
  console.error('[smoke-test] FAIL: verify-playwright-patches.js failed');
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

// doctor
console.log('[smoke-test] Running szkrabok doctor...');
const doctorResult = spawnSync(pkgBin, ['doctor'], {
  cwd: tmpDir,
  stdio: 'inherit',
  env: { ...process.env, SZKRABOK_SKIP_BROWSER_INSTALL: '1' },
});
if (doctorResult.status !== 0) {
  console.error('[smoke-test] FAIL: szkrabok doctor reported failures');
  process.exit(1);
}

// remove the tarball
try { rmSync(tarball); } catch {}

console.log('\n[smoke-test] PASS: package installs and starts correctly.');
