#!/usr/bin/env node
/**
 * apply-patches.js — run as part of postinstall to apply playwright-core patches.
 *
 * Two problems when called from a dependency's postinstall:
 *
 * 1. patch-package without --patch-dir uses the consumer's project root as the
 *    app root and looks for patches/ there — which doesn't exist.
 *
 * 2. Assuming playwright-core is hoisted to the consumer's root node_modules
 *    is wrong when the consumer has a conflicting playwright version: npm then
 *    nests playwright-core@1.58.2 inside this package's own node_modules.
 *
 * Fix: use Node's module resolution (createRequire from pkgDir) to find the
 * playwright-core that will actually be used at runtime, derive targetRoot from
 * its location, and run patch-package from there with --patch-dir pointing at
 * this package's own patches/.
 *
 * Bound: walk up from pkgDir to find the npm install root (the directory that
 * contains the outermost node_modules holding this package). Playwright-core
 * must be within that same root — prevents accidentally patching an unrelated
 * global install. Works for npx, regular installs, and local dev.
 */

import { spawnSync } from 'node:child_process';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const patchesDir = join(pkgDir, 'patches');
const require = createRequire(join(pkgDir, 'package.json'));

// Emit a diagnostic hint whenever we exit with an error — npm surfaces stderr
// on postinstall failure even without --foreground-scripts.
process.on('exit', code => {
  if (code !== 0) {
    process.stderr.write(
      '\n[apply-patches] To see full output during install, rerun with:\n' +
      '  npm install --foreground-scripts\n\n'
    );
  }
});

// ── Determine npm install root ────────────────────────────────────────────────
// Walk up from pkgDir until we leave node_modules. The directory just above the
// outermost node_modules is the root of the npm tree that contains this package.
//   npx:        /home/user/.npm/_npx/<hash>/node_modules/... → /home/user/.npm/_npx/<hash>
//   dependency: sk-skills/node_modules/...                  → sk-skills
//   local dev:  szkrabok/ (not inside node_modules)         → szkrabok

function findNpmRoot(dir) {
  let current = resolve(dir);
  let lastNodeModules = null;
  while (true) {
    if (current.endsWith('/node_modules') || current.includes('/node_modules/')) {
      lastNodeModules = current;
    }
    const parent = dirname(current);
    if (parent === current) break; // filesystem root
    // Once we step out of node_modules territory, stop
    if (lastNodeModules !== null &&
        !parent.includes('/node_modules') &&
        !parent.endsWith('/node_modules')) {
      return parent;
    }
    current = parent;
  }
  return resolve(dir); // not inside node_modules — direct/local install
}

const npmRoot = findNpmRoot(pkgDir);

console.log('[apply-patches] pkgDir  :', pkgDir);
console.log('[apply-patches] npmRoot :', npmRoot);

// ── Find playwright-core ──────────────────────────────────────────────────────

function resolvePlaywrightCore() {
  let pwPkg;
  try {
    pwPkg = require.resolve('playwright-core/package.json');
    console.log('[apply-patches] require.resolve found:', pwPkg);
  } catch {
    console.log('[apply-patches] require.resolve: playwright-core not found from pkgDir');
    return null;
  }

  // Verify the resolved playwright-core is within this npm tree, not some
  // unrelated global install above it.
  if (!resolve(pwPkg).startsWith(npmRoot + '/')) {
    console.log(`[apply-patches] WARNING: ${pwPkg} is outside npm root (${npmRoot})`);
    console.log('[apply-patches] Trying nested fallback:', join(pkgDir, 'node_modules', 'playwright-core'));
    const nested = join(pkgDir, 'node_modules', 'playwright-core', 'package.json');
    if (existsSync(nested)) {
      console.log('[apply-patches] Using nested fallback:', nested);
      return nested;
    }
    console.log('[apply-patches] Nested fallback not found either');
    return null;
  }

  return pwPkg;
}

const pwCorePkg = resolvePlaywrightCore();
if (!pwCorePkg) {
  console.error('[apply-patches] FAIL: playwright-core not found within the npm install tree');
  process.exit(1);
}

// ── Find patch-package ────────────────────────────────────────────────────────

let ppPkg;
try {
  ppPkg = require.resolve('patch-package/package.json');
} catch {
  console.error('[apply-patches] FAIL: patch-package not found');
  process.exit(1);
}

// ── Run patch-package ─────────────────────────────────────────────────────────

const pwCoreDir = dirname(pwCorePkg);      // .../node_modules/playwright-core
const pwNodeModules = dirname(pwCoreDir);  // .../node_modules
const targetRoot = dirname(pwNodeModules); // root for patch-package

const ppDir = dirname(ppPkg);
const ppIndex = join(ppDir, 'index.js');

const pwVersion = JSON.parse(readFileSync(pwCorePkg, 'utf8')).version;

// Build a temp patches dir containing only the patch that matches the installed
// playwright-core version. The patches/ directory may contain historical patches
// for older versions; passing all of them to patch-package causes failures when
// the installed version doesn't match a patch filename.
const matchingPatch = `playwright-core+${pwVersion}.patch`;
const allPatches = existsSync(patchesDir) ? readdirSync(patchesDir) : [];
const versionedPatches = allPatches.filter(f => f === matchingPatch);

let activePatchesDir;
let tempPatchDir = null;

if (versionedPatches.length === 0) {
  // No patch for this version — nothing to apply.
  console.log(`[apply-patches] No patch file for playwright-core@${pwVersion} — skipping.`);
  process.exit(0);
} else if (allPatches.length === versionedPatches.length) {
  // Only one patch file and it matches — use patchesDir directly.
  activePatchesDir = patchesDir;
} else {
  // Multiple patch files present; copy only the matching one to a temp dir to
  // prevent patch-package from attempting to apply mismatched historical patches.
  tempPatchDir = join(patchesDir, '.tmp-apply');
  if (existsSync(tempPatchDir)) rmSync(tempPatchDir, { recursive: true });
  mkdirSync(tempPatchDir);
  copyFileSync(join(patchesDir, matchingPatch), join(tempPatchDir, matchingPatch));
  console.log(`[apply-patches] Multiple patch files found; using only ${matchingPatch}`);
  activePatchesDir = tempPatchDir;
}

const patchDir = relative(targetRoot, activePatchesDir);

console.log('[apply-patches] playwright-core:', pwCoreDir, `(v${pwVersion})`);
console.log('[apply-patches] targetRoot     :', targetRoot);
console.log('[apply-patches] patchDir       :', patchDir);
console.log('[apply-patches] patch-package  :', ppIndex);

// patch-package's getAppRootPath walks up from cwd looking for a package.json.
// In an npx temp dir targetRoot has no package.json — write a minimal stub so
// it doesn't throw, then remove it afterwards.
const targetPkgJson = join(targetRoot, 'package.json');
const wroteTempPkg = !existsSync(targetPkgJson);
if (wroteTempPkg) {
  console.log('[apply-patches] targetRoot has no package.json — writing temp stub so patch-package can find its app root');
  writeFileSync(targetPkgJson, '{"name":"__patch-package-tmp__","version":"0.0.0","private":true}\n');
} else {
  console.log('[apply-patches] targetRoot package.json exists — no stub needed');
}

const result = spawnSync(process.execPath, [ppIndex, '--patch-dir', patchDir], {
  cwd: targetRoot,
  stdio: 'inherit',
});

if (wroteTempPkg) {
  try {
    unlinkSync(targetPkgJson);
    console.log('[apply-patches] temp stub removed');
  } catch (e) {
    console.log('[apply-patches] WARNING: could not remove temp stub:', e.message);
  }
}

if (tempPatchDir) {
  try {
    rmSync(tempPatchDir, { recursive: true });
  } catch {
    // best-effort cleanup
  }
}

process.exit(result.status ?? 1);
