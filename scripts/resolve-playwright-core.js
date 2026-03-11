/**
 * Shared utility: find playwright-core root relative to a given package root.
 * Handles npm hoisting — playwright-core may be in an ancestor node_modules dir.
 *
 * @param {string} pkgRoot - absolute path to the package root (dir containing package.json)
 * @param {function} existsSync - fs.existsSync
 * @param {object} path - node:path module (needs join)
 * @returns {string|null} absolute path to playwright-core dir, or null if not found
 */
export function resolvePlaywrightCore(pkgRoot, existsSync, path) {
  // When installed via npm, playwright-core is hoisted to the enclosing node_modules.
  const enclosingNm = pkgRoot.includes('node_modules')
    ? pkgRoot.slice(0, pkgRoot.lastIndexOf('node_modules') + 'node_modules'.length)
    : path.join(pkgRoot, 'node_modules');

  const hoisted = path.join(enclosingNm, 'playwright-core');
  if (existsSync(path.join(hoisted, 'package.json'))) return hoisted;

  // Fallback: own nested node_modules (non-hoisted or dev workspace)
  const own = path.join(pkgRoot, 'node_modules', 'playwright-core');
  if (existsSync(path.join(own, 'package.json'))) return own;

  return null;
}
