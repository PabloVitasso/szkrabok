#!/usr/bin/env node
/**
 * apply-patches.js — run as part of postinstall to apply playwright-core patches.
 *
 * When @pablovitasso/szkrabok is installed as a dependency, npm runs postinstall
 * with cwd = this package directory (inside node_modules). Calling patch-package
 * without --patch-dir causes it to look for patches/ at the consumer's project root
 * (which has no patches/), so nothing gets patched and verify fails.
 *
 * This script locates the true project root by traversing up from __dirname to find
 * the directory that CONTAINS the node_modules folder — no env-variable dependency,
 * works with npm, yarn, and pnpm. It then runs patch-package from that root with
 * --patch-dir pointing at this package's own patches/ directory.
 */

import { spawnSync } from 'node:child_process';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Walk up from dir until we find a segment named 'node_modules', then return
 * its parent (the project root). If we never find node_modules, the package
 * is being used directly (local dev), so return dir itself.
 */
function findProjectRoot(dir) {
  let current = dir;
  while (true) {
    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
    if (basename(current) === 'node_modules') return parent;
    current = parent;
  }
  return dir; // not inside node_modules — direct/local install
}

const projectRoot = findProjectRoot(pkgDir);
const patchesDir = join(pkgDir, 'patches');
const ppBin = join(projectRoot, 'node_modules', '.bin', 'patch-package');

if (!existsSync(ppBin)) {
  console.error('[apply-patches] patch-package binary not found at', ppBin);
  process.exit(1);
}

const patchDir = relative(projectRoot, patchesDir);
const result = spawnSync(ppBin, ['--patch-dir', patchDir], {
  cwd: projectRoot,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
