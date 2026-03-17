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
 * this package's own patches/. INIT_CWD (set by npm/yarn/pnpm) bounds the
 * search so a global install above the consumer project is never used.
 */

import { spawnSync } from 'node:child_process';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const patchesDir = join(pkgDir, 'patches');
const require = createRequire(join(pkgDir, 'package.json'));

// INIT_CWD is set by npm, yarn, and pnpm to the directory where `install` was
// invoked (the consumer project root). Use it to bound the resolution so we
// never accidentally patch a global install above the consumer project.
const consumerRoot = process.env.INIT_CWD
  ?? process.env.npm_config_local_prefix
  ?? null;

console.log('[apply-patches] pkgDir     :', pkgDir);
console.log('[apply-patches] consumerRoot:', consumerRoot ?? '(not set — using require.resolve without bounds)');

// ── Find playwright-core ──────────────────────────────────────────────────────

function resolvePlaywrightCore() {
  // Primary: let Node resolve it from this package's perspective.
  let pwPkg;
  try {
    pwPkg = require.resolve('playwright-core/package.json');
    console.log('[apply-patches] require.resolve found:', pwPkg);
  } catch {
    console.log('[apply-patches] require.resolve: not found from pkgDir');
    return null;
  }

  // If we have a consumer root, verify the resolved path is within it.
  if (consumerRoot) {
    const bound = resolve(consumerRoot) + '/';
    if (!resolve(pwPkg).startsWith(bound)) {
      console.log(`[apply-patches] WARNING: resolved path is outside consumer root (${consumerRoot})`);
      console.log('[apply-patches] Trying nested fallback:', join(pkgDir, 'node_modules', 'playwright-core'));
      const nested = join(pkgDir, 'node_modules', 'playwright-core', 'package.json');
      if (existsSync(nested)) {
        console.log('[apply-patches] Using nested fallback:', nested);
        return nested;
      }
      console.log('[apply-patches] Nested fallback not found either');
      return null;
    }
  }

  return pwPkg;
}

const pwCorePkg = resolvePlaywrightCore();
if (!pwCorePkg) {
  console.error('[apply-patches] FAIL: playwright-core not found in the current project');
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

// targetRoot = directory that directly contains the node_modules that holds
// playwright-core. patch-package must run from here.
const pwCoreDir = dirname(pwCorePkg);      // .../node_modules/playwright-core
const pwNodeModules = dirname(pwCoreDir);  // .../node_modules
const targetRoot = dirname(pwNodeModules); // root for patch-package

const ppDir = dirname(ppPkg);
const ppIndex = join(ppDir, 'index.js');   // patch-package CLI entry point

const pwVersion = JSON.parse(readFileSync(pwCorePkg, 'utf8')).version;
const patchDir = relative(targetRoot, patchesDir);

console.log('[apply-patches] playwright-core:', pwCoreDir, `(v${pwVersion})`);
console.log('[apply-patches] targetRoot     :', targetRoot);
console.log('[apply-patches] patchDir       :', patchDir);
console.log('[apply-patches] patch-package  :', ppIndex);

const result = spawnSync(process.execPath, [ppIndex, '--patch-dir', patchDir], {
  cwd: targetRoot,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
