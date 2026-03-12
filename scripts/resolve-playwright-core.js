import { createRequire } from 'node:module';
import { dirname } from 'node:path';

/**
 * Resolve the installed playwright-core directory starting from a package root.
 * Works with npm, pnpm, yarn, workspaces, and any hoisting depth.
 *
 * Delegates to Node's own module resolution via createRequire — no path heuristics.
 *
 * @param {string} pkgRoot absolute path to a package root
 * @returns {string|null} absolute path to playwright-core or null
 */
export function resolvePlaywrightCore(pkgRoot) {
  try {
    const req = createRequire(pkgRoot + '/');
    return dirname(req.resolve('playwright-core/package.json'));
  } catch {
    return null;
  }
}
